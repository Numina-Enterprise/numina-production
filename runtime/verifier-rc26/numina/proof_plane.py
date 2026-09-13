from __future__ import annotations
from dataclasses import dataclass
from collections import Counter
from typing import Iterable
from .canonical import digest
from .status import SignedStatusWitness, verify_witness

def status_statement_root(sw: SignedStatusWitness) -> str:
    w=sw.witness
    return digest({
        'authority_domain_id': w.authority_domain_id,
        'constitutional_sequence': w.constitutional_sequence,
        'dependency_closure_root': w.dependency_closure_root,
        'status': w.status,
        'previous_status_root': w.previous_status_root,
        'valid_until_sequence': w.valid_until_sequence,
    })

@dataclass(frozen=True)
class WitnessQuorumPolicy:
    required: int
    allowed_witness_ids: tuple[str, ...]
    require_independent_ids: bool = True

@dataclass(frozen=True)
class QuorumStatusProof:
    authority_domain_id: str
    constitutional_sequence: int
    dependency_closure_root: str
    status_root: str
    witness_ids: tuple[str, ...]
    signatures_digest: str

    @property
    def proof_digest(self) -> str:
        return digest(self)

@dataclass(frozen=True)
class EquivocationProof:
    authority_domain_id: str
    constitutional_sequence: int
    left_status_root: str
    right_status_root: str
    left_witness_id: str
    right_witness_id: str

    @property
    def proof_digest(self) -> str:
        return digest(self)


def detect_equivocation(witnesses: Iterable[SignedStatusWitness]) -> EquivocationProof | None:
    seen: dict[tuple[str,int], SignedStatusWitness] = {}
    for signed in witnesses:
        w=signed.witness
        k=(w.authority_domain_id,w.constitutional_sequence)
        prior=seen.get(k)
        prior_root=status_statement_root(prior) if prior else None
        current_root=status_statement_root(signed)
        if prior and prior_root != current_root:
            return EquivocationProof(w.authority_domain_id,w.constitutional_sequence,
                                     prior_root,current_root,
                                     prior.witness.witness_id,w.witness_id)
        seen[k]=signed
    return None


def verify_witness_quorum(*, signed_witnesses: Iterable[SignedStatusWitness], public_keys: dict[str, object],
                          policy: WitnessQuorumPolicy, current_sequence: int,
                          highest_seen_by_witness: dict[str,int] | None = None) -> tuple[bool,str,QuorumStatusProof|EquivocationProof|None]:
    ws=list(signed_witnesses)
    eq=detect_equivocation(ws)
    if eq: return False,'EQUIVOCATION',eq
    if policy.required <= 0: return False,'INVALID_QUORUM_POLICY',None
    allowed=set(policy.allowed_witness_ids)
    highest_seen_by_witness=highest_seen_by_witness or {}
    valid=[]
    for sw in ws:
        wid=sw.witness.witness_id
        if wid not in allowed or wid not in public_keys: continue
        ok,reason=verify_witness(sw,public_keys[wid],current_sequence,highest_seen_by_witness.get(wid,-1))
        if not ok: continue
        valid.append(sw)
    if policy.require_independent_ids and len({x.witness.witness_id for x in valid}) != len(valid):
        return False,'DUPLICATE_WITNESS_ID',None
    if len(valid) < policy.required: return False,'INSUFFICIENT_WITNESS_QUORUM',None
    # Quorum must attest the same domain, sequence, dependency root and status root.
    key_counts=Counter((x.witness.authority_domain_id,x.witness.constitutional_sequence,
                        x.witness.dependency_closure_root,status_statement_root(x)) for x in valid)
    key,count=key_counts.most_common(1)[0]
    if count < policy.required: return False,'NO_COMMON_WITNESS_ROOT',None
    chosen=[x for x in valid if (x.witness.authority_domain_id,x.witness.constitutional_sequence,
                                 x.witness.dependency_closure_root,status_statement_root(x))==key][:policy.required]
    sig_digest=digest(sorted((x.witness.witness_id,x.signature_hex) for x in chosen))
    proof=QuorumStatusProof(key[0],key[1],key[2],key[3],tuple(sorted(x.witness.witness_id for x in chosen)),sig_digest)
    return True,'QUORUM_CURRENT',proof
