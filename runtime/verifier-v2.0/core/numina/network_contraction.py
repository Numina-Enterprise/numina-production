from __future__ import annotations
from dataclasses import dataclass
from typing import Iterable
from .mesh_health import MeshHealth, MeshHealthState

@dataclass(frozen=True)
class ContractionEdge:
    source_domain: str
    target_domain: str
    propagation_bps: int = 10_000
    def __post_init__(self):
        if not 0 <= self.propagation_bps <= 10_000: raise ValueError('propagation_bps')


def propagate_contraction(states: Iterable[MeshHealthState], edges: Iterable[ContractionEdge]):
    out={s.domain_id:s for s in states}
    graph={}
    for e in edges: graph.setdefault(e.source_domain,[]).append(e)
    changed=True
    while changed:
        changed=False
        for src, es in graph.items():
            if src not in out: continue
            s=out[src]
            for e in es:
                if e.target_domain not in out: continue
                t=out[e.target_domain]
                inherited = 10_000 - ((10_000-s.contraction_bps)*e.propagation_bps//10_000)
                new_bps=min(t.contraction_bps,inherited)
                new_state=t.state
                if new_bps==0 and t.state==MeshHealth.NORMAL: new_state=MeshHealth.DEGRADED
                if new_bps < t.contraction_bps:
                    out[e.target_domain]=MeshHealthState(t.domain_id,new_state,new_bps,f'UPSTREAM:{src}')
                    changed=True
    return out
