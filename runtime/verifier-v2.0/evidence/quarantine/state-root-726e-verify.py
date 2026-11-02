#!/usr/bin/env python3
"""
Independent checker for the pasted state-root claim, 2026-10-23.

Claim under check (pasted JSON, UNVERIFIED, quarantined):
  clusterStateRootSha256 = manifestSha256
      = 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd
  Documents (pasted):
    docs/Numina-Evidence-Integration-Gates-2026-10-11.md  7421 bytes
        sha256 2fa0d8271f14327a9754adddf76bdcfd91a7d6de5b1addcbdb52675b32c5cc89
    docs/Numina-Security.md                             10407 bytes
        sha256 6af93453d6373e0a165180a0a9af6962d3075d6d34b5b5d6eee1e14b4431b018
    docs/NUSD-Conversion-Contracts.md                    7694 bytes
        sha256 9cc698d11fe9c7e49a39596f0c4123a4c72691926bea55837a718230627b9150
  Signers (pasted, format-plausible, UNVERIFIED):
    skott34-ed25519 (authority)
        raw pubkey c6aa5b8cc4f38142d578dabf5b4b5d5354733ca9a4ba5742d94e030c8e60eb22
        sig 2605a41daec24eff961ff4cb6894117175f75289aff190141aecb13aec7adbf732ab0dcfd8d41ef63b740e8a6e4d1e14e9f2a8646ddccd901e1c55c75d7ace08
    numina-guardian-ed25519 (guardian)
        raw pubkey 854ae99ccb1c9bf55cee9fbb93a7807310d3d20554710d5d84a920689d8154d8
        sig 7163074f4b728d547083a1049cb5b662db4037766d4de5df0d07d049b23925ebae015a4625f3c2e259301d6ed1f2487045430f66b10071f78ef4b796bf49db0c

This script does NOT guess the signed message. Signature verification requires
an explicit --message file. Without it, signatures are reported UNVERIFIABLE,
never PASS. That is the correct result for the pasted JSON, which names no
signed message, no canonical signing bytes, and no payload specification.

Usage:
  python3 state-root-726e-verify.py --self-test
  python3 state-root-726e-verify.py --doc1 FILE --doc2 FILE --doc3 FILE [--manifest FILE] [--message FILE]

Exit code: 0 only if every supplied check passes AND signatures verify.
Any FAIL or UNVERIFIABLE makes the exit code non-zero.
No cryptography / PyNaCl dependency: pure-Python RFC 8032 verification.
"""
import argparse
import base64
import hashlib
import sys

EXPECTED_ROOT = "726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd"
EXPECTED_DOCS = [
    ("docs/Numina-Evidence-Integration-Gates-2026-10-11.md", 7421,
     "2fa0d8271f14327a9754adddf76bdcfd91a7d6de5b1addcbdb52675b32c5cc89"),
    ("docs/Numina-Security.md", 10407,
     "6af93453d6373e0a165180a0a9af6962d3075d6d34b5b5d6eee1e14b4431b018"),
    ("docs/NUSD-Conversion-Contracts.md", 7694,
     "9cc698d11fe9c7e49a39596f0c4123a4c72691926bea55837a718230627b9150"),
]
SIGNERS = [
    ("skott34-ed25519", "authority",
     "c6aa5b8cc4f38142d578dabf5b4b5d5354733ca9a4ba5742d94e030c8e60eb22",
     "2605a41daec24eff961ff4cb6894117175f75289aff190141aecb13aec7adbf732ab0dcfd8d41ef63b740e8a6e4d1e14e9f2a8646ddccd901e1c55c75d7ace08"),
    ("numina-guardian-ed25519", "guardian",
     "854ae99ccb1c9bf55cee9fbb93a7807310d3d20554710d5d84a920689d8154d8",
     "7163074f4b728d547083a1049cb5b662db4037766d4de5df0d07d049b23925ebae015a4625f3c2e259301d6ed1f2487045430f66b10071f78ef4b796bf49db0c"),
]

# --- RFC 8032 Ed25519, pure Python ---
_q = 2 ** 255 - 19
_d = (-121665 * pow(121666, _q - 2, _q)) % _q
_I = pow(2, (_q - 1) // 4, _q)
_L = 2 ** 252 + 27742317777372353535851937790883648493


def _xrecover(y):
    xx = (y * y - 1) * pow(_d * y * y + 1, _q - 2, _q) % _q
    x = pow(xx, (_q + 3) // 8, _q)
    if (x * x - xx) % _q != 0:
        x = (x * _I) % _q
    if x % 2 != 0:
        x = _q - x
    return x


_By = (4 * pow(5, _q - 2, _q)) % _q
_Bx = _xrecover(_By)
_B = (_Bx % _q, _By % _q)


def _edwards(P, Q):
    x1, y1 = P
    x2, y2 = Q
    denom = pow(1 + _d * x1 * x2 * y1 * y2, _q - 2, _q)
    x3 = (x1 * y2 + x2 * y1) * denom % _q
    denom2 = pow(1 - _d * x1 * x2 * y1 * y2, _q - 2, _q)
    y3 = (y1 * y2 + x1 * x2) * denom2 % _q
    return (x3, y3)


def _scalarmult(P, e):
    if e == 0:
        return (0, 1)
    Q = _scalarmult(P, e // 2)
    Q = _edwards(Q, Q)
    if e & 1:
        Q = _edwards(Q, P)
    return Q


def _decode_point(s):
    y = int.from_bytes(s, "little") & ((1 << 255) - 1)
    sign = (s[31] >> 7) & 1
    x = _xrecover(y)
    if x % 2 != sign:
        x = _q - x
    return (x, y)


def _hint(R_enc, A_enc, msg):
    h = hashlib.sha512(R_enc + A_enc + msg).digest()
    return int.from_bytes(h, "little")


def ed25519_verify(pubkey32, msg, sig64):
    """Return True iff sig64 is a valid Ed25519 signature of msg under pubkey32."""
    if len(pubkey32) != 32 or len(sig64) != 64:
        return False
    R_enc, S_enc = sig64[:32], sig64[32:]
    S = int.from_bytes(S_enc, "little")
    if S >= _L:
        return False
    try:
        R = _decode_point(R_enc)
        A = _decode_point(pubkey32)
    except Exception:
        return False
    h = _hint(R_enc, pubkey32, msg)
    left = _scalarmult(_B, S)
    right = _edwards(R, _scalarmult(A, h))
    return left == right


def _sha256_file(path):
    h = hashlib.sha256()
    n = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
            n += len(chunk)
    return n, h.hexdigest()


def self_test():
    # RFC 8032 test vector 1: empty message.
    pub = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
    sig = bytes.fromhex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
    ok = ed25519_verify(pub, b"", sig)
    bad = ed25519_verify(pub, b"x", sig)
    print(f"self-test: valid vector verifies = {ok} (expected True)")
    print(f"self-test: tampered message rejects = {not bad} (expected True)")
    return ok and not bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--doc1")
    ap.add_argument("--doc2")
    ap.add_argument("--doc3")
    ap.add_argument("--manifest")
    ap.add_argument("--message", help="Exact signed-message bytes file. Required for signature verification; no message is guessed.")
    args = ap.parse_args()

    if args.self_test:
        return 0 if self_test() else 1

    overall = True
    docs = [args.doc1, args.doc2, args.doc3]
    for (name, exp_size, exp_hash), path in zip(EXPECTED_DOCS, docs):
        if not path:
            print(f"DOC MISSING: {name} — no file supplied, expected {exp_size} bytes, sha256 {exp_hash}")
            overall = False
            continue
        try:
            size, digest = _sha256_file(path)
        except OSError as e:
            print(f"DOC ERROR: {name} ({path}): {e}")
            overall = False
            continue
        status = "PASS" if (size == exp_size and digest == exp_hash) else "FAIL"
        if status == "FAIL":
            overall = False
        print(f"DOC {status}: {name}\n  supplied: {path}, {size} bytes, sha256 {digest}\n  expected: {exp_size} bytes, sha256 {exp_hash}")

    if args.manifest:
        try:
            size, digest = _sha256_file(args.manifest)
            status = "PASS" if digest == EXPECTED_ROOT else "FAIL"
            if status == "FAIL":
                overall = False
            print(f"MANIFEST {status}: {args.manifest}, {size} bytes, sha256 {digest}\n  expected root: {EXPECTED_ROOT}")
        except OSError as e:
            print(f"MANIFEST ERROR: {e}")
            overall = False
    else:
        print(f"MANIFEST MISSING: no manifest file supplied; claimed root {EXPECTED_ROOT} is UNVERIFIED")
        overall = False

    if not args.message:
        print("SIGNATURES UNVERIFIABLE: no --message file supplied. The pasted JSON names no signed message, so no signature can be verified from it. Supply the exact signed bytes to check.")
        overall = False
    else:
        try:
            msg = open(args.message, "rb").read()
        except OSError as e:
            print(f"MESSAGE ERROR: {e}")
            return 1
        print(f"MESSAGE: {args.message}, {len(msg)} bytes, sha256 {hashlib.sha256(msg).hexdigest()}")
        for key_id, role, pub_hex, sig_hex in SIGNERS:
            ok = ed25519_verify(bytes.fromhex(pub_hex), msg, bytes.fromhex(sig_hex))
            # Negative control: flipped message must reject.
            neg = ed25519_verify(bytes.fromhex(pub_hex), msg + b"\x00", bytes.fromhex(sig_hex))
            status = "PASS" if (ok and not neg) else "FAIL"
            if status == "FAIL":
                overall = False
            print(f"SIGNATURE {status}: {key_id} ({role}) verifies={ok}, negative-control-rejects={not neg}")

    print(f"OVERALL: {'PASS' if overall else 'FAIL / UNVERIFIED'}")
    return 0 if overall else 1


if __name__ == "__main__":
    sys.exit(main())
