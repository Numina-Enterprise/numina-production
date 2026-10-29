from __future__ import annotations
from dataclasses import dataclass
from enum import Enum

class MeshHealth(str, Enum):
    NORMAL = 'NORMAL'
    DEGRADED = 'DEGRADED'
    DISPUTED = 'DISPUTED'
    RECOVERY_VERIFYING = 'RECOVERY_VERIFYING'

@dataclass(frozen=True)
class MeshHealthState:
    domain_id: str
    state: MeshHealth
    contraction_bps: int = 10_000
    reason: str = 'OK'

    def __post_init__(self):
        if not 0 <= self.contraction_bps <= 10_000:
            raise ValueError('contraction_bps out of range')
        if self.state in (MeshHealth.DISPUTED, MeshHealth.RECOVERY_VERIFYING) and self.contraction_bps != 0:
            raise ValueError('disputed/recovery-verifying domains must stop new risk-adding authority')

    def effective_limit(self, nominal_usd_minor: int, *, risk_adding: bool = True) -> int:
        nominal = max(0, nominal_usd_minor)
        if not risk_adding:
            return nominal
        return nominal * self.contraction_bps // 10_000
