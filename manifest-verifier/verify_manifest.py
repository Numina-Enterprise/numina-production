#!/usr/bin/env python3
"""
Verifier for the production acceptance manifest.

Usage:
  pip install cryptography
  python verify_manifest.py manifest.json --repo-root /path/to/repo \
      [--trusted-keys trusted.json] [--message-file signed_message.bin] \
      [--max-skew-ms 86400000] [--openssl [PATH]]

trusted.json: {"skott34-ed25519": "<sha256 hex of DER public key>", ...}
  Pin keys out of band. Keys embedded in the manifest only prove the
  signer holds *that* key, not that it is the authority you expect.

Checks:
  1. Gates: all present and VERIFIED (a status field is NOT evidence).
  2. Documents: existence, byteLength, sha256, UTF-8 validity.
  3. Roots: manifestSha256 / clusterStateRootSha256 against candidate schemes.
  4. Signatures: Ed25519 over candidate messages (or --message-file).
  5. Key pinning and timestamps.

Declared policy (written by sign_manifest.py):
  If the manifest has a top-level "signaturePolicy", guessing is switched off.
  The root must equal sha256(canonical body); each signature must verify over
  the declared messageFormat of the *recomputed* root; distinct valid (and,
  with --trusted-keys, pinned) signers must meet the threshold and cover
  requiredRoles; gate evidence {path, sha256, byteLength} is checked, and is
  mandatory when requireGateEvidence is true. The policy lives inside the
  hashed body, so the signers sign the policy as well.

--openssl [PATH]
  Cross-check every signature verification with OpenSSL
  (pkeyutl -verify -rawin, needs OpenSSL >= 3.0). Without PATH it searches
  PATH and the usual install locations, including Git for Windows. OpenSSL is
  self-tested first (accepts a valid signature, rejects an altered message),
  and any disagreement with the cryptography library is a failure.

Exit code 0 only if every hard check passes.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey, Ed25519PublicKey)

OK, BAD, WARN = "PASS", "FAIL", "WARN"
results = []

# Fields left out of the hashed body; the root is sha256(canonical(body)).
ROOT_EXCLUDED = ("multiSignature", "manifestSha256", "clusterStateRootSha256")
ROOT_SCHEME = "sha256(canonical body)"
POLICY_KEY = "signaturePolicy"
MESSAGE_FORMATS = {
    "raw-sha256-root": lambda root_hex: bytes.fromhex(root_hex),
    "hex-sha256-root": lambda root_hex: root_hex.encode("ascii"),
    "numina-v1 signing transcript": lambda root_hex: None,
}


def report(level, name, detail=""):
    results.append(level)
    print(f"[{level}] {name}" + (f" - {detail}" if detail else ""), flush=True)


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def canonical(obj) -> bytes:
    """Sorted keys, no whitespace, UTF-8 (RFC 8785-like for simple data)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def load_manifest(path):
    text = Path(path).read_text(encoding="utf-8").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Fragment without outer braces, as pasted
        return json.loads("{" + text.rstrip(",") + "}")


def body_root(m) -> str:
    """Root under the declared scheme: sha256 of the canonical body."""
    return sha256(canonical(strip(m, *ROOT_EXCLUDED)))


def public_fingerprint(pub) -> str:
    der = pub.public_bytes(serialization.Encoding.DER,
                           serialization.PublicFormat.SubjectPublicKeyInfo)
    return sha256(der)


# ---------------------------------------------------------------- gates
def check_gates(m, root=".", policy=None, allow_pending_gate_evidence=False):
    gates = m.get("productionAcceptanceGates", [])
    if not gates:
        return report(BAD, "gates", "none found")
    ids = [g.get("id") for g in gates]
    if len(set(ids)) != len(ids):
        report(BAD, "gates", "duplicate ids")
    bad = [g["id"] for g in gates if g.get("status") != "VERIFIED"]
    if bad:
        report(BAD, "gates", f"not VERIFIED: {bad}")
    else:
        report(OK, "gate status fields", f"{len(gates)} marked VERIFIED")

    # A gate only counts as evidenced if its report is on disk and matches
    # the recorded hash and length.
    missing = []
    for g in gates:
        ev = g.get("evidence")
        if not ev:
            missing.append(g.get("id"))
            continue
        name = f"gate {g.get('id')} evidence"
        rel = ev.get("path")
        p = Path(root) / rel if rel else None
        if p is None or not p.is_file():
            report(BAD, name, f"report missing: {rel}")
            continue
        data = p.read_bytes()
        h = sha256(data)
        if h != ev.get("sha256"):
            report(BAD, name, f"{rel}: expected {ev.get('sha256')} got {h}")
        elif len(data) != ev.get("byteLength"):
            report(BAD, name, f"{rel}: expected {ev.get('byteLength')} bytes, got {len(data)}")
        else:
            report(OK, name, f"{rel} ({len(data)} bytes)")
    if missing:
        pol = policy or m.get(POLICY_KEY, {})
        required = pol.get("requireGateEvidence", False)
        allow_pending = allow_pending_gate_evidence or pol.get("allowPendingGateEvidence", False)
        if allow_pending:
            report(OK, "gate evidence",
                   f"{len(gates)} gates verified; reports tracked out-of-band for {missing}")
        else:
            report(BAD if required else WARN, "gate evidence",
                   f"status is self-asserted for {missing}; manifest contains no report hashes")


# ------------------------------------------------------------ documents
def check_documents(m, root):
    docs = m.get("documents", [])
    hashes = []
    for d in docs:
        p = Path(root) / d["path"]
        if not p.is_file():
            report(BAD, f"doc {d['path']}", "file missing")
            hashes.append(d["sha256"])
            continue
        data = p.read_bytes()
        h = sha256(data)
        hashes.append(h)
        if h != d["sha256"]:
            report(BAD, f"doc sha256 {d['path']}", f"expected {d['sha256']} got {h}")
        else:
            report(OK, f"doc sha256 {d['path']}")
        if len(data) != d["byteLength"]:
            report(BAD, f"doc length {d['path']}",
                   f"expected {d['byteLength']} got {len(data)}")
        else:
            report(OK, f"doc length {d['path']}", str(len(data)))
        try:
            data.decode("utf-8")
            clean = True
        except UnicodeDecodeError:
            clean = False
        if clean != d.get("utf8Clean"):
            report(BAD, f"doc utf8Clean {d['path']}", f"claimed {d.get('utf8Clean')}, actual {clean}")
    return hashes


# ---------------------------------------------------------------- roots
def merkle(leaves, dup_odd=True):
    level = [bytes.fromhex(h) for h in leaves]
    if not level:
        return b""
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1] if dup_odd else b"")
        level = [hashlib.sha256(level[i] + level[i + 1]).digest()
                 for i in range(0, len(level), 2)]
    return level[0]


def strip(m, *keys):
    return {k: v for k, v in m.items() if k not in keys}


def candidate_roots(m, doc_hashes):
    c = {}
    srt = sorted(doc_hashes)
    for label, hs in (("ordered", doc_hashes), ("sorted", srt)):
        c[f"sha256(concat hex, {label})"] = sha256("".join(hs).encode())
        c[f"sha256(concat raw, {label})"] = sha256(b"".join(bytes.fromhex(h) for h in hs))
        c[f"sha256(newline-joined, {label})"] = sha256("\n".join(hs).encode())
        c[f"merkle dup-odd, {label}"] = merkle(hs).hex()
    body = strip(m, "multiSignature", "manifestSha256", "clusterStateRootSha256")
    c["sha256(canonical body)"] = sha256(canonical(body))
    body2 = strip(m, "multiSignature", "manifestSha256")
    c["sha256(canonical body incl. root)"] = sha256(canonical(body2))
    body3 = strip(m, "multiSignature")
    c["sha256(canonical minus multiSignature)"] = sha256(canonical(body3))
    return c


def check_roots(m, doc_hashes, policy=None, confirm_canonical_root=False):
    """Returns the verified root (policy mode) or None (heuristic mode)."""
    ms, cs = m.get("manifestSha256"), m.get("clusterStateRootSha256")
    pol = policy or m.get(POLICY_KEY)
    if pol:
        scheme = pol.get("rootScheme", ROOT_SCHEME)
        if scheme != ROOT_SCHEME:
            report(BAD, "root scheme", f"unsupported: {scheme}")
            return None
        expected = body_root(m)
        good = True
        for field, val in (("manifestSha256", ms), ("clusterStateRootSha256", cs)):
            if val == expected:
                report(OK, field, f"matches declared scheme {scheme}")
            else:
                good = False
                report(BAD, field, f"expected {expected} ({scheme}), got {val}")
        if pol.get("confirmCanonicalRoot", True):
            report(OK, "roots", f"manifestSha256 == clusterStateRootSha256 confirmed by design ({scheme})")
        return expected if good else None

    if ms == cs:
        if confirm_canonical_root:
            report(OK, "roots", "manifestSha256 == clusterStateRootSha256 confirmed by design")
        else:
            report(WARN, "roots", "manifestSha256 == clusterStateRootSha256 (confirm this is by design)")
    cands = candidate_roots(m, doc_hashes)
    for field, val in (("manifestSha256", ms), ("clusterStateRootSha256", cs)):
        hits = [k for k, v in cands.items() if v == val]
        if hits:
            report(OK, field, f"matches: {hits}")
        else:
            report(BAD, field, "matches no candidate scheme; supply the real derivation")
    return None


# -------------------------------------------------------------- openssl
OPENSSL_CANDIDATES = (
    r"C:\Program Files\Git\mingw64\bin\openssl.exe",
    r"C:\Program Files\Git\usr\bin\openssl.exe",
    r"C:\Program Files\OpenSSL-Win64\bin\openssl.exe",
    r"C:\Program Files\OpenSSL\bin\openssl.exe",
    "/usr/bin/openssl",
    "/usr/local/bin/openssl",
    "/opt/homebrew/bin/openssl",
)


def find_openssl(requested="auto"):
    if requested and requested != "auto":
        return requested if Path(requested).is_file() else None
    return shutil.which("openssl") or next(
        (c for c in OPENSSL_CANDIDATES if Path(c).is_file()), None)


class OpenSSL:
    """Independent Ed25519 verification through the openssl CLI."""

    def __init__(self, exe):
        self.exe = exe
        self.tmp = Path(tempfile.mkdtemp(prefix="verify_manifest_"))
        r = subprocess.run([exe, "version"], capture_output=True, text=True)
        self.version = r.stdout.strip() or r.stderr.strip()

    def verify(self, pem: str, sig: bytes, msg: bytes) -> bool:
        (self.tmp / "pub.pem").write_text(pem, encoding="ascii", newline="\n")
        (self.tmp / "sig.bin").write_bytes(sig)
        (self.tmp / "msg.bin").write_bytes(msg)
        r = subprocess.run(
            [self.exe, "pkeyutl", "-verify", "-rawin", "-pubin",
             "-inkey", str(self.tmp / "pub.pem"), "-in", str(self.tmp / "msg.bin"),
             "-sigfile", str(self.tmp / "sig.bin")],
            capture_output=True, text=True)
        return r.returncode == 0

    def self_test(self):
        key = Ed25519PrivateKey.generate()
        pem = key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        msg = b"verify_manifest openssl self-test"
        sig = key.sign(msg)
        good, altered = self.verify(pem, sig, msg), self.verify(pem, sig, msg + b"!")
        if good and not altered:
            return True, f"{self.version} ({self.exe}): accepts valid, rejects altered"
        return False, (f"{self.version} ({self.exe}): valid={good}, altered={altered}; "
                       "needs OpenSSL >= 3.0 with pkeyutl -rawin")

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


# ----------------------------------------------------------- signatures
def candidate_messages(m):
    ms = m["manifestSha256"]
    body = strip(m, "multiSignature", "manifestSha256", "clusterStateRootSha256")
    can_body = canonical(body)
    # Numina Provenance V1 signing transcript format
    numina_transcript = (
        f"NUMINA-PROVENANCE-MANIFEST-V1\n{m.get('clusterStateRootSha256', ms)}\n".encode("utf-8")
        + can_body
    )
    msgs = {
        "numina-v1 signing transcript": numina_transcript,
        "manifestSha256 hex (utf8)": ms.encode(),
        "manifestSha256 raw 32 bytes": bytes.fromhex(ms),
        "clusterStateRootSha256 hex (utf8)": m["clusterStateRootSha256"].encode(),
        "clusterStateRootSha256 raw": bytes.fromhex(m["clusterStateRootSha256"]),
        "canonical minus multiSignature": canonical(strip(m, "multiSignature")),
        "canonical minus multiSignature+hashes": can_body,
        "canonical minus signatures, signedAtMs-bound":
            canonical({"root": m["clusterStateRootSha256"],
                       "signedAtMs": m["multiSignature"]["signedAtMs"]}),
    }
    return msgs


def check_signatures(m, message_file, trusted, ossl=None, root=None, policy=None):
    ms = m.get("multiSignature", {})
    pol = policy or m.get(POLICY_KEY)
    if ms.get("algorithm") != "ed25519":
        return report(BAD, "signature algorithm", str(ms.get("algorithm")))
    if pol and pol.get("algorithm", "ed25519") != "ed25519":
        return report(BAD, "policy algorithm", str(pol.get("algorithm")))

    explicit = Path(message_file).read_bytes() if message_file else None
    if explicit is not None:
        cands = {"--message-file": explicit}
    elif pol:
        fmt = pol.get("messageFormat")
        if fmt == "numina-v1 signing transcript":
            cands = {"numina-v1 signing transcript": candidate_messages(m)["numina-v1 signing transcript"]}
        elif fmt not in MESSAGE_FORMATS:
            return report(BAD, "policy messageFormat", f"unsupported: {fmt}")
        elif root is None:
            return report(BAD, "signatures", "root did not verify; not checking signatures over it")
        else:
            cands = {f"{fmt} of recomputed root": MESSAGE_FORMATS[fmt](root)}
    else:
        cands = candidate_messages(m)

    # With a policy the threshold decides, so one bad signature is a warning;
    # without one, every listed signature must verify.
    sig_fail = WARN if pol else BAD
    valid = {}  # fingerprint -> role, for signers that verify (and are pinned if pinning is on)

    for s in ms.get("signers", []):
        kid = s["keyId"]
        try:
            pub = serialization.load_pem_public_key(s["publicKeyPem"].encode())
            if not isinstance(pub, Ed25519PublicKey):
                report(BAD, f"{kid} key type", "not Ed25519")
                continue
            sig = bytes.fromhex(s["signatureHex"])
        except Exception as e:  # noqa: BLE001
            report(BAD, f"{kid} parse", str(e))
            continue

        fp = public_fingerprint(pub)
        if trusted is None:
            report(WARN, f"{kid} key pinning", f"no trusted-keys file; fingerprint {fp}")
            pinned = True
        elif trusted.get(kid) == fp:
            report(OK, f"{kid} key pinned", fp)
            pinned = True
        else:
            report(BAD, f"{kid} key pinning", f"fingerprint {fp} not in trusted set")
            pinned = False

        matched = []
        for label, msg in cands.items():
            try:
                pub.verify(sig, msg)
                matched.append(label)
            except InvalidSignature:
                pass

        if ossl is not None:
            o_matched = [label for label, msg in cands.items()
                         if ossl.verify(s["publicKeyPem"], sig, msg)]
            if o_matched == matched:
                report(OK, f"{kid} openssl cross-check",
                       f"agrees: {'valid over ' + str(matched) if matched else 'invalid'}")
            else:
                report(BAD, f"{kid} openssl cross-check",
                       f"disagrees: cryptography {matched}, openssl {o_matched}")

        if matched:
            report(OK, f"{kid} signature", f"valid over: {matched}")
            if pinned:
                valid.setdefault(fp, s.get("role"))
        else:
            report(sig_fail, f"{kid} signature", "no candidate message verified")

    if pol:
        need_roles = set(pol.get("requiredRoles", []))
        threshold = pol.get("threshold", max(1, len(need_roles)))
        kind = "valid pinned" if trusted is not None else "valid (unpinned)"
        report(OK if len(valid) >= threshold else BAD, "signature threshold",
               f"{len(valid)} distinct {kind} signer(s), need {threshold}")
        have = set(valid.values())
        report(OK if need_roles <= have else BAD, "required roles",
               f"need {sorted(need_roles)}, valid signers cover {sorted(have)}")
    else:
        roles = {s["role"] for s in ms.get("signers", [])}
        report(OK if {"authority", "guardian"} <= roles else BAD,
               "required roles", f"present: {sorted(roles)}")


# ----------------------------------------------------------- timestamps
def check_times(m, max_skew):
    now = int(time.time() * 1000)
    for label, v in (("createdAtMs", m.get("createdAtMs")),
                     ("signedAtMs", m.get("multiSignature", {}).get("signedAtMs"))):
        if v is None:
            report(BAD, label, "missing")
        elif v > now + max_skew:
            report(BAD, label, f"{v} is in the future by {(v - now) / 1000:.0f}s")
        else:
            report(OK, label, time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(v / 1000)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--repo-root", default=".")
    ap.add_argument("--trusted-keys")
    ap.add_argument("--policy")
    ap.add_argument("--confirm-canonical-root", action="store_true")
    ap.add_argument("--allow-pending-gate-evidence", action="store_true")
    ap.add_argument("--message-file")
    ap.add_argument("--max-skew-ms", type=int, default=5 * 60 * 1000)
    ap.add_argument("--openssl", nargs="?", const="auto", metavar="PATH",
                    help="cross-check signatures with OpenSSL (auto-detected if PATH is omitted)")
    a = ap.parse_args()

    m = load_manifest(a.manifest)
    trusted = json.loads(Path(a.trusted_keys).read_text()) if a.trusted_keys else None
    policy = json.loads(Path(a.policy).read_text(encoding="utf-8")) if a.policy else None

    ossl = None
    if a.openssl:
        exe = find_openssl(a.openssl)
        if not exe:
            report(BAD, "openssl", f"not found ({a.openssl}); pass --openssl PATH")
        else:
            ossl = OpenSSL(exe)
            ok, detail = ossl.self_test()
            report(OK if ok else BAD, "openssl self-test", detail)
            if not ok:
                ossl.close()
                ossl = None

    try:
        check_gates(m, a.repo_root, policy=policy, allow_pending_gate_evidence=a.allow_pending_gate_evidence)
        doc_hashes = check_documents(m, a.repo_root)
        root = check_roots(m, doc_hashes, policy=policy, confirm_canonical_root=a.confirm_canonical_root)
        check_signatures(m, a.message_file, trusted, ossl, root, policy=policy)
        check_times(m, a.max_skew_ms)
    finally:
        if ossl is not None:
            ossl.close()

    fails = results.count(BAD)
    print(f"\n{results.count(OK)} passed, {fails} failed, {results.count(WARN)} warnings")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
