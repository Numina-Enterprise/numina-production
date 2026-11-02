from __future__ import annotations
from dataclasses import dataclass
from typing import Iterable, FrozenSet
from .reachability import AuthorityReachability, ReachabilityEdge

@dataclass(frozen=True)
class DomainExposure:
    domain_id: str
    mrec_usd_minor: int
    shared_dependencies: FrozenSet[str]


def systemic_mrec(exposures: Iterable[DomainExposure]) -> int:
    # Conservative bound: sum; no correlation discount without proof.
    return sum(max(0,e.mrec_usd_minor) for e in exposures)


def correlated_dependency_concentration(exposures: Iterable[DomainExposure]):
    ex=tuple(exposures); total=sum(e.mrec_usd_minor for e in ex) or 1
    deps={}
    for e in ex:
        for d in e.shared_dependencies: deps[d]=deps.get(d,0)+e.mrec_usd_minor
    return {d:v/total for d,v in deps.items()}


def composition_emergence(individual_edges, composed_edges, start, depth=8):
    individual=AuthorityReachability(individual_edges).mrec(start,depth)
    composed=AuthorityReachability(composed_edges).mrec(start,depth)
    return {'individual_mrec':individual,'composed_mrec':composed,'emergent_delta':max(0,composed-individual)}
