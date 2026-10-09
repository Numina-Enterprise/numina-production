from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Tuple
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature
from .canonical import canonical_bytes, digest

@dataclass(frozen=True)
class RecognitionProfile:
    profile_id: str
    accepted_issuers: tuple[str, ...]
    accepted_constitutions: tuple[str, ...]
    accepted_rails: tuple[str, ...]
    max_status_age_seq: int = 32

@dataclass(frozen=True)
class EAC:
    authorization_id: str
    operation_id: str
    principal_id: str
    agent_id: str
    mandate_id: str
    asset: str
    side: str
    rail: str
    max_quantity_wei: int
    max_price_usd_minor_per_eth: int
    max_notional_usd_minor: int
    nonce: str
    dependency_root: str
    pre_state_digest: str
    constitution_digest: str
    issuer_id: str
    issued_sequence: int
    valid_until_sequence: int

@dataclass(frozen=True)
class SignedEAC:
    credential: EAC
    signature_hex: str


def generate_keypair() -> Tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    sk = Ed25519PrivateKey.generate(); return sk, sk.public_key()


def sign(eac: EAC, private_key: Ed25519PrivateKey) -> SignedEAC:
    return SignedEAC(eac, private_key.sign(canonical_bytes(eac)).hex())


def verify(signed: SignedEAC, public_key: Ed25519PublicKey, profile: RecognitionProfile, current_sequence: int, consumed_nonces: set[str]) -> tuple[bool, str]:
    e = signed.credential
    if e.issuer_id not in profile.accepted_issuers: return False, "UNRECOGNIZED_ISSUER"
    if e.constitution_digest not in profile.accepted_constitutions: return False, "UNRECOGNIZED_CONSTITUTION"
    if e.rail not in profile.accepted_rails: return False, "UNRECOGNIZED_RAIL"
    if current_sequence > e.valid_until_sequence: return False, "EXPIRED"
    if current_sequence - e.issued_sequence > profile.max_status_age_seq: return False, "REVALIDATION_REQUIRED"
    if e.nonce in consumed_nonces: return False, "NONCE_ALREADY_CONSUMED"
    try: public_key.verify(bytes.fromhex(signed.signature_hex), canonical_bytes(e))
    except (InvalidSignature, ValueError): return False, "INVALID_SIGNATURE"
    return True, "VALID_FOR_COMMIT"


def dependency_root(deps) -> str: return digest(deps)
