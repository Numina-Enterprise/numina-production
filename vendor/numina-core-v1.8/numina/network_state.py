from __future__ import annotations
from dataclasses import dataclass
from typing import FrozenSet, Iterable


@dataclass(frozen=True)
class NetworkAuthorityNode:
    node_id: str
    live_authority_usd_minor: int
    committed_usd_minor: int = 0
    uncertain_usd_minor: int = 0
    dependencies: FrozenSet[str] = frozenset()


@dataclass(frozen=True)
class NetworkAuthorityEdge:
    source: str
    target: str
    max_consequence_usd_minor: int


def continuous_network_reachability(nodes: Iterable[NetworkAuthorityNode], edges: Iterable[NetworkAuthorityEdge], start: str, depth: int = 16):
    ns = {n.node_id: n for n in nodes}
    graph = {}
    for e in edges:
        graph.setdefault(e.source, []).append(e)
    if start not in ns:
        return {'reachable_nodes': frozenset(), 'mrec_usd_minor': 0, 'occupied_usd_minor': 0}
    q = [(start, 0)]
    seen = set()
    edge_mrec = 0
    occupied = 0
    while q:
        node, d = q.pop(0)
        if node in seen or d > depth:
            continue
        seen.add(node)
        n = ns[node]
        occupied += max(0, n.committed_usd_minor) + max(0, n.uncertain_usd_minor)
        for e in graph.get(node, []):
            edge_mrec += max(0, e.max_consequence_usd_minor)
            if e.target not in seen:
                q.append((e.target, d + 1))
    # Conservative: current live start capacity plus all reachable edge consequence.
    mrec = max(0, ns[start].live_authority_usd_minor) + edge_mrec
    return {'reachable_nodes': frozenset(seen), 'mrec_usd_minor': mrec, 'occupied_usd_minor': occupied}
