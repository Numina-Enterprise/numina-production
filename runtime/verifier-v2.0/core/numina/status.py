from __future__ import annotations
from dataclasses import dataclass
from .canonical import digest
from .cbor import encode
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

STATUSES={'CURRENT','CONTRACTED','REVOKED','DISPUTED','RECOVERY_VERIFYING'}

@dataclass(frozen=True)
class StatusWitness:
    authority_domain_id:str
    constitutional_sequence:int
    dependency_closure_root:str
    status:str
    previous_status_root:str
    valid_until_sequence:int
    witness_id:str

    def __post_init__(self):
        if self.status not in STATUSES: raise ValueError('invalid status')
        if self.constitutional_sequence < 0 or self.valid_until_sequence < self.constitutional_sequence: raise ValueError('invalid sequence')

    @property
    def status_root(self)->str: return digest(self)

@dataclass(frozen=True)
class SignedStatusWitness:
    witness:StatusWitness
    signature_hex:str

def sign_witness(w:StatusWitness, sk:Ed25519PrivateKey)->SignedStatusWitness:
    return SignedStatusWitness(w, sk.sign(encode(w)).hex())

def verify_witness(s:SignedStatusWitness, pk:Ed25519PublicKey, current_sequence:int, highest_seen:int=-1, expected_prev:str|None=None):
    w=s.witness
    try: pk.verify(bytes.fromhex(s.signature_hex), encode(w))
    except (InvalidSignature,ValueError): return False,'INVALID_WITNESS_SIGNATURE'
    if w.constitutional_sequence < highest_seen: return False,'WITNESS_ROLLBACK'
    if current_sequence > w.valid_until_sequence: return False,'STALE_STATUS'
    if expected_prev is not None and w.previous_status_root != expected_prev: return False,'WITNESS_CHAIN_BREAK'
    if w.status in {'REVOKED','DISPUTED','RECOVERY_VERIFYING'}: return False,w.status
    return True,'CURRENT' if w.status=='CURRENT' else 'CONTRACTED'
