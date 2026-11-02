from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True)
class ReachabilityEdge:
    source:str
    target:str
    max_consequence_usd_minor:int
    risk_adding:bool=True

class AuthorityReachability:
    def __init__(self, edges): self.edges=tuple(edges)
    def reachable(self,start:str,depth:int=8):
        best={start:0}; frontier=[start]
        for _ in range(depth):
            nxt=[]
            for n in frontier:
                for e in self.edges:
                    if e.source!=n: continue
                    val=best[n]+e.max_consequence_usd_minor
                    if val>best.get(e.target,-1): best[e.target]=val; nxt.append(e.target)
            if not nxt: break
            frontier=nxt
        return best
    def mrec(self,start:str,depth:int=8):
        r=self.reachable(start,depth); return max(r.values()) if r else 0
    def min_cut_single_edges(self,start:str,protected:str):
        # Reference analyzer: return edges that individually disconnect all paths.
        if protected not in self.reachable(start): return []
        out=[]
        for i,e in enumerate(self.edges):
            reduced=self.edges[:i]+self.edges[i+1:]
            if protected not in AuthorityReachability(reduced).reachable(start): out.append(e)
        return out
