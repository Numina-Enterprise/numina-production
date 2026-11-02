from __future__ import annotations
from dataclasses import dataclass
from .canonical import digest

@dataclass(frozen=True)
class DependencyClosure:
    authority_epoch:int
    mandate_epoch:int
    policy_epoch:int
    risk_epoch:int
    runtime_epoch:int
    position_epoch:int
    valuation_epoch:int
    rail_epoch:int
    reservation_epoch:int

    @property
    def root(self)->str:
        return digest(self)

    def dominates_or_equals(self, other:'DependencyClosure')->bool:
        return all(a>=b for a,b in zip(self.as_tuple(),other.as_tuple()))

    def as_tuple(self):
        return (self.authority_epoch,self.mandate_epoch,self.policy_epoch,self.risk_epoch,
                self.runtime_epoch,self.position_epoch,self.valuation_epoch,self.rail_epoch,self.reservation_epoch)
