#!/usr/bin/env python3
"""
Sign the raw 32-byte manifest root with pure Ed25519 and compare to the stored signature.

Usage (run by the key holder, on their own machine):
  python sign_root.py provenance-manifest.json skott34.pem
"""
import json
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

manifest_path, key_path = sys.argv[1], sys.argv[2]
m = json.load(open(manifest_path, encoding="utf-8"))
key = serialization.load_pem_private_key(open(key_path, "rb").read(), password=None)
if not isinstance(key, Ed25519PrivateKey):
    sys.exit("not an Ed25519 private key")

pub_pem = key.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
root = bytes.fromhex(m["manifestSha256"])
sig = key.sign(root).hex()

signer = next((s for s in m["multiSignature"]["signers"]
               if s["publicKeyPem"].strip() == pub_pem.strip()), None)
print("signature over raw root:", sig)
if signer is None:
    print("RESULT: this private key matches NO public key in the manifest")
elif signer["signatureHex"] == sig:
    print(f"RESULT: matches stored signature for {signer['keyId']}")
else:
    print(f"RESULT: key matches {signer['keyId']}, but stored signatureHex differs "
          "-> replace it with the value above")
