from __future__ import annotations
from dataclasses import dataclass
from typing import FrozenSet


@dataclass(frozen=True)
class AuthorityPeeringPolicy:
    peer_a: str
    peer_b: str
    accepted_constitutions: FrozenSet[str]
    accepted_authority_classes: FrozenSet[str]
    accepted_issuers: FrozenSet[str]
    max_open_obligations_usd_minor: int
    max_status_age_ms: int

    def recognizes(self, *, constitution_digest: str, authority_class: str, issuer: str,
                   open_obligations_usd_minor: int, status_age_ms: int) -> bool:
        return (
            constitution_digest in self.accepted_constitutions
            and authority_class in self.accepted_authority_classes
            and issuer in self.accepted_issuers
            and 0 <= open_obligations_usd_minor <= self.max_open_obligations_usd_minor
            and 0 <= status_age_ms <= self.max_status_age_ms
        )
