from __future__ import annotations
from dataclasses import dataclass, replace
from enum import Enum
from typing import FrozenSet, Tuple


class ObligationState(str, Enum):
    RECOGNIZED = 'RECOGNIZED'
    BILATERALLY_COMMITTED = 'BILATERALLY_COMMITTED'
    EXECUTED = 'EXECUTED'
    SETTLED = 'SETTLED'
    FINAL = 'FINAL'
    DISPUTED = 'DISPUTED'


@dataclass(frozen=True)
class BilateralObligation:
    obligation_id: str
    creditor_domain: str
    debtor_domain: str
    resource: str
    amount_minor: int
    authority_id: str
    operation_id: str
    state: ObligationState = ObligationState.RECOGNIZED
    evidence_refs: FrozenSet[str] = frozenset()


def transition_obligation(ob: BilateralObligation, target: ObligationState, *, evidence_ref: str | None = None) -> Tuple[BilateralObligation, str]:
    if ob.state == ObligationState.FINAL:
        return ob, 'FINAL_OBLIGATION_IMMUTABLE'
    if target == ObligationState.DISPUTED:
        refs = ob.evidence_refs | (frozenset({evidence_ref}) if evidence_ref else frozenset())
        return replace(ob, state=target, evidence_refs=refs), 'OK'
    order = {
        ObligationState.RECOGNIZED: 0,
        ObligationState.BILATERALLY_COMMITTED: 1,
        ObligationState.EXECUTED: 2,
        ObligationState.SETTLED: 3,
        ObligationState.FINAL: 4,
    }
    if ob.state == ObligationState.DISPUTED:
        return ob, 'DISPUTE_REQUIRES_RECONCILIATION'
    if target not in order or order[target] != order[ob.state] + 1:
        return ob, 'INVALID_OBLIGATION_TRANSITION'
    refs = ob.evidence_refs | (frozenset({evidence_ref}) if evidence_ref else frozenset())
    return replace(ob, state=target, evidence_refs=refs), 'OK'
