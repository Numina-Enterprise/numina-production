from __future__ import annotations
from dataclasses import dataclass
from typing import FrozenSet, Iterable
from .canonical import digest

@dataclass(frozen=True)
class EndpointAdvertisement:
    endpoint_id: str
    domain_id: str
    uri: str
    constitution_digests: FrozenSet[str]
    authority_classes: FrozenSet[str]
    issuer_ids: FrozenSet[str]
    max_consequence_usd_minor: int
    max_status_age_ms: int
    route_epoch: int

    @property
    def advertisement_digest(self) -> str:
        return digest(self)

    def compatible(self, *, constitution_digest: str, authority_class: str, issuer_id: str,
                   consequence_usd_minor: int, status_age_ms: int) -> bool:
        return (
            constitution_digest in self.constitution_digests
            and authority_class in self.authority_classes
            and issuer_id in self.issuer_ids
            and 0 <= consequence_usd_minor <= self.max_consequence_usd_minor
            and 0 <= status_age_ms <= self.max_status_age_ms
        )


def discover_endpoint(advertisements: Iterable[EndpointAdvertisement], **requirements) -> EndpointAdvertisement | None:
    candidates = [a for a in advertisements if a.compatible(**requirements)]
    if not candidates:
        return None
    # Deterministic preference: smallest sufficient consequence envelope, then endpoint id.
    return sorted(candidates, key=lambda a: (a.max_consequence_usd_minor, a.endpoint_id))[0]
