from __future__ import annotations
from dataclasses import dataclass
from .canonical import digest

FINAL_STATES={'FINAL'}
ORDER={'BILATERALLY_COMMITTED':0,'EXECUTED':1,'SETTLED':2,'FINAL':3}

@dataclass(frozen=True)
class PeerObligationView:
    peer_id: str
    obligation_id: str
    operation_id: str
    amount_minor: int
    resource: str
    state: str
    evidence_root: str
    sequence: int

    @property
    def view_digest(self): return digest(self)

@dataclass(frozen=True)
class PeerReconciliationProof:
    obligation_id: str
    operation_id: str
    left_peer: str
    right_peer: str
    agreed_state: str
    amount_minor: int
    resource: str
    evidence_roots: tuple[str, ...]
    left_view_digest: str
    right_view_digest: str

    @property
    def proof_digest(self): return digest(self)


def reconcile_peer_views(a: PeerObligationView, b: PeerObligationView):
    if a.obligation_id != b.obligation_id or a.operation_id != b.operation_id:
        return False,'OBLIGATION_IDENTITY_MISMATCH',None
    if a.amount_minor != b.amount_minor or a.resource != b.resource:
        return False,'OBLIGATION_ECONOMIC_MISMATCH',None
    if a.state == 'DISPUTED' or b.state == 'DISPUTED':
        return False,'PEER_OBLIGATION_DISPUTED',None
    if a.state not in ORDER or b.state not in ORDER:
        return False,'UNKNOWN_OBLIGATION_STATE',None
    # Recognition never advances beyond the least-confirmed peer state.
    agreed = min((a.state,b.state), key=lambda s: ORDER[s])
    proof=PeerReconciliationProof(a.obligation_id,a.operation_id,a.peer_id,b.peer_id,agreed,a.amount_minor,a.resource,
                                  tuple(sorted({a.evidence_root,b.evidence_root})),a.view_digest,b.view_digest)
    return True,'PEER_RECONCILED',proof
