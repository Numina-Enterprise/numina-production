from __future__ import annotations
import base64, json, os
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey,Ed25519PublicKey
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import InvalidSignature


def canonical_bytes(v: dict) -> bytes:
    return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()

@dataclass
class SigningIdentity:
    private_key: Ed25519PrivateKey

    @property
    def public_key_bytes(self)->bytes:
        return self.private_key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)
    @property
    def public_key_b64(self)->str:
        return base64.b64encode(self.public_key_bytes).decode()
    @property
    def key_id(self)->str:
        return sha256(self.public_key_bytes).hexdigest()[:24]
    def sign(self,payload:dict,artifact_type:str)->dict:
        body={"artifact_type":artifact_type,"key_id":self.key_id,"payload":payload}
        sig=self.private_key.sign(canonical_bytes(body))
        return {**body,"algorithm":"Ed25519","public_key":self.public_key_b64,"signature":base64.b64encode(sig).decode()}


def verify_envelope(envelope:dict, *, expected_public_key_b64:str|None=None, expected_type:str|None=None)->bool:
    try:
        if envelope.get("algorithm")!="Ed25519": return False
        if expected_type and envelope.get("artifact_type")!=expected_type: return False
        pub_b64=envelope["public_key"]
        if expected_public_key_b64 and pub_b64!=expected_public_key_b64: return False
        raw=base64.b64decode(pub_b64)
        if sha256(raw).hexdigest()[:24] != envelope.get("key_id"): return False
        body={"artifact_type":envelope["artifact_type"],"key_id":envelope["key_id"],"payload":envelope["payload"]}
        Ed25519PublicKey.from_public_bytes(raw).verify(base64.b64decode(envelope["signature"]),canonical_bytes(body))
        return True
    except (KeyError,ValueError,InvalidSignature):
        return False


def load_identity(path:Path|None, *, allow_ephemeral:bool)->SigningIdentity:
    if path is None:
        if not allow_ephemeral: raise RuntimeError("signing key required")
        return SigningIdentity(Ed25519PrivateKey.generate())
    if path.exists():
        key=serialization.load_pem_private_key(path.read_bytes(),password=None)
        if not isinstance(key,Ed25519PrivateKey): raise RuntimeError("signing key must be Ed25519")
        return SigningIdentity(key)
    if not allow_ephemeral:
        raise RuntimeError(f"signing key file does not exist: {path}")
    path.parent.mkdir(parents=True,exist_ok=True)
    key=Ed25519PrivateKey.generate()
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    try: os.chmod(path,0o600)
    except OSError: pass
    return SigningIdentity(key)
