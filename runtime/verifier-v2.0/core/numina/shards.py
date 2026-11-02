from __future__ import annotations
from dataclasses import dataclass

@dataclass
class AuthorityShard:
    shard_id: str
    capacity_usd_minor: int
    fencing_epoch: int = 1
    live: bool = True
    reserved_usd_minor: int = 0
    committed_usd_minor: int = 0
    uncertain_usd_minor: int = 0
    def available(self): return max(0,self.capacity_usd_minor-self.reserved_usd_minor-self.committed_usd_minor-self.uncertain_usd_minor)
    def assert_fence(self, epoch:int):
        if not self.live or epoch != self.fencing_epoch: raise RuntimeError("STALE_FENCE")
    def reserve(self, amount:int, epoch:int):
        self.assert_fence(epoch)
        if amount < 0 or amount > self.available(): raise RuntimeError("INSUFFICIENT_SHARD_AUTHORITY")
        self.reserved_usd_minor += amount
    def recall(self):
        self.live=False; self.fencing_epoch += 1
    def release_proof(self):
        if self.reserved_usd_minor or self.committed_usd_minor or self.uncertain_usd_minor: raise RuntimeError("SHARD_NOT_CLEAR")
        return {"shard_id":self.shard_id,"released_capacity_usd_minor":self.capacity_usd_minor,"fencing_epoch":self.fencing_epoch}

class ShardAllocator:
    def __init__(self,parent_capacity_usd_minor:int): self.parent=parent_capacity_usd_minor; self.shards={}
    def allocate(self,shard_id:str,amount:int):
        if amount<0 or sum(x.capacity_usd_minor for x in self.shards.values() if x.live)+amount>self.parent: raise RuntimeError("C1_SHARD_NON_CREATION")
        s=AuthorityShard(shard_id,amount); self.shards[shard_id]=s; return s
    def assert_conservation(self):
        if sum(x.capacity_usd_minor for x in self.shards.values() if x.live)>self.parent: raise RuntimeError("C1_SHARD_NON_CREATION")
