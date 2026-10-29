from __future__ import annotations
from dataclasses import dataclass
from .canonical import digest
from .cbor import encode
from .vm import AuthorityProgram
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

@dataclass(frozen=True)
class ProofCarryingProgram:
    program: AuthorityProgram
    semantic_source_digest: str
    compiler_digest: str
    reachable_authority_digest: str
    approval_digest: str
    signature_hex: str

    @property
    def unsigned_payload(self):
        return {
            'program': self.program,
            'semantic_source_digest': self.semantic_source_digest,
            'compiler_digest': self.compiler_digest,
            'reachable_authority_digest': self.reachable_authority_digest,
            'approval_digest': self.approval_digest,
        }

    @property
    def artifact_digest(self)->str:
        return digest(self.unsigned_payload)


def sign_program(program:AuthorityProgram, *, semantic_source_digest:str, compiler_digest:str,
                 reachable_authority_digest:str, approval_digest:str, sk:Ed25519PrivateKey)->ProofCarryingProgram:
    payload={
        'program':program,
        'semantic_source_digest':semantic_source_digest,
        'compiler_digest':compiler_digest,
        'reachable_authority_digest':reachable_authority_digest,
        'approval_digest':approval_digest,
    }
    sig=sk.sign(encode(payload)).hex()
    return ProofCarryingProgram(program,semantic_source_digest,compiler_digest,reachable_authority_digest,approval_digest,sig)


def verify_program(p:ProofCarryingProgram, pk:Ed25519PublicKey, expected_constitution_digest:str,
                   expected_compiler_digest:str|None=None):
    if p.program.constitution_digest != expected_constitution_digest:
        return False,'CONSTITUTION_MISMATCH'
    if expected_compiler_digest is not None and p.compiler_digest != expected_compiler_digest:
        return False,'COMPILER_MISMATCH'
    try:
        pk.verify(bytes.fromhex(p.signature_hex), encode(p.unsigned_payload))
    except (InvalidSignature,ValueError):
        return False,'INVALID_PROGRAM_SIGNATURE'
    return True,'VALID_PROGRAM'
