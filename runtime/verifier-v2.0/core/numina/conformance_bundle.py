from __future__ import annotations
from dataclasses import dataclass
from .canonical import digest
from .cbor import encode
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

@dataclass(frozen=True)
class ConformanceBundle:
    implementation_id:str
    build_digest:str
    constitution_digest:str
    semantic_registry_digest:str
    test_vector_digest:str
    passing_tests:int
    failing_tests:int
    authority_vm_digest:str
    issued_sequence:int

    @property
    def bundle_digest(self)->str: return digest(self)

@dataclass(frozen=True)
class SignedConformanceBundle:
    bundle:ConformanceBundle
    signer_id:str
    signature_hex:str


def sign_conformance_bundle(bundle:ConformanceBundle,signer_id:str,sk:Ed25519PrivateKey)->SignedConformanceBundle:
    return SignedConformanceBundle(bundle,signer_id,sk.sign(encode(bundle)).hex())


def verify_conformance_bundle(signed:SignedConformanceBundle,pk:Ed25519PublicKey,*,required_constitution_digest:str,min_passing_tests:int=1):
    try: pk.verify(bytes.fromhex(signed.signature_hex),encode(signed.bundle))
    except (InvalidSignature,ValueError): return False,'INVALID_CONFORMANCE_SIGNATURE'
    b=signed.bundle
    if b.constitution_digest != required_constitution_digest: return False,'CONSTITUTION_MISMATCH'
    if b.failing_tests != 0 or b.passing_tests < min_passing_tests: return False,'CONFORMANCE_UNHEALTHY'
    return True,'CONFORMANCE_BUNDLE_VALID'
