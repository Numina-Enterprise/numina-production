from __future__ import annotations
from dataclasses import dataclass
from typing import Iterable
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature
from .canonical import digest
from .cbor import encode

@dataclass(frozen=True)
class ConstitutionalCheckpoint:
    domain_id: str
    sequence: int
    state_digest: str
    event_root: str
    constitution_digest: str
    previous_checkpoint_digest: str
    signer_id: str

    @property
    def checkpoint_digest(self) -> str:
        return digest(self)

@dataclass(frozen=True)
class SignedCheckpoint:
    checkpoint: ConstitutionalCheckpoint
    signature_hex: str

@dataclass(frozen=True)
class CheckpointQuorumProof:
    domain_id: str
    sequence: int
    state_digest: str
    event_root: str
    constitution_digest: str
    previous_checkpoint_digest: str
    signer_ids: tuple[str, ...]
    signatures_digest: str

    @property
    def proof_digest(self) -> str:
        return digest(self)


def sign_checkpoint(cp: ConstitutionalCheckpoint, sk: Ed25519PrivateKey) -> SignedCheckpoint:
    return SignedCheckpoint(cp, sk.sign(encode(cp)).hex())


def verify_checkpoint(s: SignedCheckpoint, pk: Ed25519PublicKey, *, highest_sequence: int = -1,
                      expected_previous: str | None = None, required_constitution: str | None = None):
    try:
        pk.verify(bytes.fromhex(s.signature_hex), encode(s.checkpoint))
    except (InvalidSignature, ValueError):
        return False, 'INVALID_CHECKPOINT_SIGNATURE'
    cp = s.checkpoint
    if cp.sequence < highest_sequence:
        return False, 'CHECKPOINT_ROLLBACK'
    if expected_previous is not None and cp.previous_checkpoint_digest != expected_previous:
        return False, 'CHECKPOINT_CHAIN_BREAK'
    if required_constitution is not None and cp.constitution_digest != required_constitution:
        return False, 'CHECKPOINT_CONSTITUTION_MISMATCH'
    return True, 'CHECKPOINT_VALID'


def verify_checkpoint_quorum(checkpoints: Iterable[SignedCheckpoint], public_keys: dict[str, Ed25519PublicKey], *,
                             required: int, allowed_signers: set[str], highest_by_signer: dict[str, int] | None = None,
                             required_constitution: str | None = None):
    if required <= 0:
        return False, 'INVALID_CHECKPOINT_QUORUM', None
    highest_by_signer = highest_by_signer or {}
    valid: list[SignedCheckpoint] = []
    for signed in checkpoints:
        sid = signed.checkpoint.signer_id
        if sid not in allowed_signers or sid not in public_keys:
            continue
        ok, _ = verify_checkpoint(signed, public_keys[sid], highest_sequence=highest_by_signer.get(sid, -1),
                                  required_constitution=required_constitution)
        if ok:
            valid.append(signed)
    groups: dict[tuple, list[SignedCheckpoint]] = {}
    for s in valid:
        c=s.checkpoint
        key=(c.domain_id,c.sequence,c.state_digest,c.event_root,c.constitution_digest,c.previous_checkpoint_digest)
        groups.setdefault(key,[]).append(s)
    if not groups:
        return False, 'INSUFFICIENT_CHECKPOINT_QUORUM', None
    key, chosen = max(groups.items(), key=lambda kv: (len({x.checkpoint.signer_id for x in kv[1]}), kv[0]))
    unique={x.checkpoint.signer_id:x for x in chosen}
    if len(unique) < required:
        return False, 'NO_COMMON_CHECKPOINT_ROOT', None
    selected=[unique[k] for k in sorted(unique)[:required]]
    proof=CheckpointQuorumProof(key[0],key[1],key[2],key[3],key[4],key[5],tuple(x.checkpoint.signer_id for x in selected),
                                digest(sorted((x.checkpoint.signer_id,x.signature_hex) for x in selected)))
    return True, 'CHECKPOINT_QUORUM_VALID', proof
