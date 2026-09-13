from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True)
class AuthorityRouteFence:
    route_id: str
    source_domain: str
    destination_domain: str
    epoch: int
    active: bool = True


def validate_route_epoch(fence: AuthorityRouteFence, presented_epoch: int) -> tuple[bool, str]:
    if not fence.active:
        return False, 'ROUTE_FENCED'
    if presented_epoch != fence.epoch:
        return False, 'STALE_ROUTE_EPOCH'
    return True, 'OK'
