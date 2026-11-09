#!/usr/bin/env python3
"""Verify existing NUMINA Ed25519 authority signature, never access private keys."""
import argparse, hashlib, json, pathlib
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

KEY_ID='skott34-ed25519'
FINGERPRINT='46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce'
PREFIX=b'numina-manifest-v1\x00'

def verify(manifest_bytes, signature, public_pem):
    key=serialization.load_pem_public_key(public_pem)
    if not isinstance(key,Ed25519PublicKey): raise ValueError('expected Ed25519 public key')
    der=key.public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
    fp=hashlib.sha256(der).hexdigest()
    if fp!=FINGERPRINT: raise ValueError('authority SPKI fingerprint mismatch')
    # Caller must supply already-canonical RFC 8785 bytes; no reserialization here.
    key.verify(signature,PREFIX+manifest_bytes)
    return {'key_id':KEY_ID,'spki_sha256':fp,'manifest_sha256':hashlib.sha256(manifest_bytes).hexdigest(),'result':'PASS','canonicalization':'external_RFC8785_required','domain_prefix':'numina-manifest-v1\\0'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--canonical-bytes',required=True);p.add_argument('--signature',required=True,help='raw 64-byte Ed25519 signature');p.add_argument('--public-key',required=True,help='existing Ed25519 PEM public key');p.add_argument('--out',required=True);a=p.parse_args()
    try:
        result=verify(pathlib.Path(a.canonical_bytes).read_bytes(),pathlib.Path(a.signature).read_bytes(),pathlib.Path(a.public_key).read_bytes())
    except Exception as e:
        result={'key_id':KEY_ID,'result':'FAIL','reason':type(e).__name__}
    pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(result['result']);raise SystemExit(0 if result['result']=='PASS' else 1)
