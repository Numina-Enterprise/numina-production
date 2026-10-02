from __future__ import annotations
from dataclasses import dataclass
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature
from .canonical import digest
from .cbor import encode

@dataclass(frozen=True)
class LiveNetworkState:
    network_id: str
    sequence: int
    constitution_digest: str
    checkpoint_quorum_digest: str
    witness_quorum_digest: str
    route_state_root: str
    obligation_root: str
    conformance_root: str
    aggregate_mrec_usd_minor: int
    aggregate_uncertain_usd_minor: int
    valid_until_sequence: int
    previous_attestation_digest: str
    attestor_id: str

    @property
    def state_digest(self): return digest(self)

@dataclass(frozen=True)
class SignedNetworkAttestation:
    state: LiveNetworkState
    signature_hex: str


def sign_network_attestation(s: LiveNetworkState, sk: Ed25519PrivateKey):
    return SignedNetworkAttestation(s, sk.sign(encode(s)).hex())


def verify_network_attestation(s: SignedNetworkAttestation, pk: Ed25519PublicKey, *, current_sequence: int,
                               highest_seen_sequence: int = -1, required_constitution: str | None = None,
                               expected_previous: str | None = None):
    try: pk.verify(bytes.fromhex(s.signature_hex),encode(s.state))
    except (InvalidSignature,ValueError): return False,'INVALID_NETWORK_ATTESTATION_SIGNATURE'
    x=s.state
    if x.sequence < highest_seen_sequence: return False,'NETWORK_ATTESTATION_ROLLBACK'
    if current_sequence > x.valid_until_sequence: return False,'STALE_NETWORK_ATTESTATION'
    if required_constitution is not None and x.constitution_digest != required_constitution: return False,'NETWORK_CONSTITUTION_MISMATCH'
    if expected_previous is not None and x.previous_attestation_digest != expected_previous: return False,'NETWORK_ATTESTATION_CHAIN_BREAK'
    if x.aggregate_mrec_usd_minor < 0 or x.aggregate_uncertain_usd_minor < 0: return False,'INVALID_NETWORK_AGGREGATE'
    return True,'NETWORK_ATTESTATION_VALID'
