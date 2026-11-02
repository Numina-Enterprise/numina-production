from __future__ import annotations
from dataclasses import dataclass
from .shards import ShardAllocator, AuthorityShard

@dataclass(frozen=True)
class HandoffProof:
    shard_id:str
    from_epoch:int
    to_epoch:int
    capacity_usd_minor:int

class ShardHandoff:
    @staticmethod
    def transfer(allocator:ShardAllocator, shard_id:str, target_id:str):
        old=allocator.shards[shard_id]
        if old.reserved_usd_minor or old.committed_usd_minor or old.uncertain_usd_minor: raise RuntimeError('SHARD_NOT_CLEAR')
        cap=old.capacity_usd_minor; from_epoch=old.fencing_epoch
        old.recall()
        # replace old live capacity with target only after old is fenced.
        target=AuthorityShard(target_id,cap,fencing_epoch=from_epoch+1,live=True)
        allocator.shards[target_id]=target
        allocator.assert_conservation()
        return target,HandoffProof(shard_id,from_epoch,target.fencing_epoch,cap)
