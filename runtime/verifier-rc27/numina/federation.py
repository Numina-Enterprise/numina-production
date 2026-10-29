from __future__ import annotations
from dataclasses import dataclass
from typing import FrozenSet, Tuple

@dataclass(frozen=True)
class SovereignDomain:
    domain_id: str
    constitution_digest: str
    recognized_issuers: FrozenSet[str]
    authority_classes: FrozenSet[str]
    jurisdiction: str

@dataclass(frozen=True)
class RecognitionBridge:
    bridge_id: str
    source_domain: str
    destination_domain: str
    accepted_issuers: FrozenSet[str]
    accepted_authority_classes: FrozenSet[str]
    max_consequence_usd_minor: int
    max_hops: int = 1

    def recognizes(self, *, issuer: str, authority_class: str, consequence_usd_minor: int) -> bool:
        return (
            issuer in self.accepted_issuers
            and authority_class in self.accepted_authority_classes
            and 0 <= consequence_usd_minor <= self.max_consequence_usd_minor
        )


def bridge_intersection(source: SovereignDomain, dest: SovereignDomain, bridge: RecognitionBridge):
    if bridge.source_domain != source.domain_id or bridge.destination_domain != dest.domain_id:
        raise ValueError('BRIDGE_DOMAIN_MISMATCH')
    issuers = source.recognized_issuers & dest.recognized_issuers & bridge.accepted_issuers
    classes = source.authority_classes & dest.authority_classes & bridge.accepted_authority_classes
    return issuers, classes
