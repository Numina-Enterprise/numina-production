#!/usr/bin/env python3
"""Verify V2.0 against FROZEN-CORE-V2.0.sha256. Stdlib only, no network.

Usage: python3 scripts/verify-manifest.py
Exit 0 = all listed files match, no listed file missing.
Exit 1 = mismatch / missing / unexpected manifest problem.
Note: sign-and-bind/ is intentionally NOT in the frozen manifest (see
sign-and-bind/README-SIGN-AND-BIND.md); its own hashes are in that package.
"""
import hashlib, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "FROZEN-CORE-V2.0.sha256"

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    if not MANIFEST.exists():
        print("FAIL: frozen manifest missing:", MANIFEST)
        return 1
    failures = []
    checked = 0
    for raw in MANIFEST.read_text().splitlines():
        if not raw.strip():
            continue
        expected, rel = raw.split(None, 1)
        rel = rel.strip()
        p = ROOT / rel
        checked += 1
        if not p.exists():
            failures.append(f"MISSING: {rel}")
        elif sha(p) != expected:
            failures.append(f"HASH_MISMATCH: {rel}")
    print(f"checked={checked} failures={len(failures)}")
    for f in failures:
        print(" ", f)
    if failures:
        print("FAIL")
        return 1
    print("PASS: V2.0 frozen manifest matches")
    return 0

if __name__ == "__main__":
    sys.exit(main())
