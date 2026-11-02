from __future__ import annotations
from dataclasses import dataclass
from .canonical import digest
from .shards import AuthorityShard

@dataclass(frozen=True)
class ShardMigrationProof:
    source_shard_id:str
    source_fencing_epoch:int
    destination_shard_id:str
    capacity_usd_minor:int
    source_release_digest:str
    destination_fencing_epoch:int

    @property
    def proof_digest(self)->str: return digest(self)


def migrate_clear_shard(*, allocator, source_id:str, destination_id:str)->tuple[AuthorityShard,ShardMigrationProof]:
    source=allocator.shards[source_id]
    release=source.release_proof()  # refuses occupied authority
    capacity=source.capacity_usd_minor
    source.recall()
    allocator.assert_conservation()
    dest=allocator.allocate(destination_id,capacity)
    proof=ShardMigrationProof(source_id,source.fencing_epoch,destination_id,capacity,digest(release),dest.fencing_epoch)
    allocator.assert_conservation()
    return dest,proof
