from __future__ import annotations
from dataclasses import dataclass
from heapq import heappush, heappop
from typing import FrozenSet, Iterable, Tuple

@dataclass(frozen=True)
class AuthorityRouteEdge:
    source: str
    target: str
    accepted_classes: FrozenSet[str]
    max_consequence_usd_minor: int
    cost: int = 1
    transitive: bool = False

@dataclass(frozen=True)
class AuthorityRoute:
    nodes: Tuple[str,...]
    total_cost: int
    limiting_consequence_usd_minor: int


def resolve_authority_route(edges: Iterable[AuthorityRouteEdge], *, source: str, target: str, authority_class: str, consequence_usd_minor: int, allow_multihop: bool=False):
    graph={}
    for e in edges: graph.setdefault(e.source,[]).append(e)
    pq=[(0,source,(source,),10**30)]
    best={}
    while pq:
        cost,node,path,limit=heappop(pq)
        if best.get(node,10**30) <= cost: continue
        best[node]=cost
        if node==target: return AuthorityRoute(path,cost,limit)
        for e in graph.get(node,[]):
            if authority_class not in e.accepted_classes or consequence_usd_minor > e.max_consequence_usd_minor: continue
            if len(path)>1 and not (allow_multihop and e.transitive): continue
            heappush(pq,(cost+e.cost,e.target,path+(e.target,),min(limit,e.max_consequence_usd_minor)))
    return None
