from __future__ import annotations
from dataclasses import dataclass
from .canonical import digest

@dataclass(frozen=True)
class ReplayRecoveryProof:
    initial_state_digest: str
    terminal_state_digest: str
    event_count: int
    event_chain_root: str
    constitution_digest: str
    build_digest: str

    @property
    def proof_digest(self)->str: return digest(self)


def build_replay_recovery_proof(*, event_store, initial_state_digest:str, terminal_state_digest:str,
                                constitution_digest:str, build_digest:str)->ReplayRecoveryProof:
    if not event_store.verify_chain(initial_state_digest): raise RuntimeError('EVENT_CHAIN_INVALID')
    rows=event_store.rows()
    chain_root=digest([(r[0],r[6]) for r in rows])
    if rows and rows[-1][5] != terminal_state_digest: raise RuntimeError('TERMINAL_STATE_MISMATCH')
    if not rows and terminal_state_digest != initial_state_digest: raise RuntimeError('TERMINAL_STATE_MISMATCH')
    return ReplayRecoveryProof(initial_state_digest,terminal_state_digest,len(rows),chain_root,constitution_digest,build_digest)


def verify_replay_recovery_proof(proof:ReplayRecoveryProof, *, expected_constitution_digest:str, expected_build_digest:str|None=None):
    if proof.constitution_digest != expected_constitution_digest: return False,'CONSTITUTION_MISMATCH'
    if expected_build_digest and proof.build_digest != expected_build_digest: return False,'BUILD_MISMATCH'
    if proof.event_count < 0: return False,'INVALID_EVENT_COUNT'
    return True,'RECOVERY_PROOF_VALID'
