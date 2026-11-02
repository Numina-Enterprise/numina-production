"""V2.0 frozen-verification shim (compatibility only).

The v1.8 frozen verification no longer applies to V2.0: v1.8 was unfrozen by
owner direction, merged, and then V2.0 was frozen again under its own manifest.
Use scripts/verify-manifest.py (package root) for V2.0 verification.
This module reads the V2.0 frozen manifest and checks the files it lists.
"""
from __future__ import annotations
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # package root: numina-core-v2.0/
FROZEN_MANIFEST = ROOT / "FROZEN-CORE-V2.0.sha256"


@dataclass(frozen=True)
class FrozenVerification:
    valid: bool
    manifest_root: str
    checked: int
    failures: tuple


def _entries():
    out = []
    if not FROZEN_MANIFEST.exists():
        return out
    for raw in FROZEN_MANIFEST.read_text().splitlines():
        if not raw.strip():
            continue
        expected, path = raw.split(None, 1)
        out.append((path.strip(), expected))
    return out


def frozen_manifest_root() -> str:
    canonical = "\n".join(f"{h} {p}" for p, h in sorted(_entries())).encode()
    return sha256(canonical).hexdigest()


def verify_frozen_core() -> FrozenVerification:
    failures = []
    entries = _entries()
    for rel, expected in entries:
        p = ROOT / rel
        if not p.exists():
            failures.append(f"MISSING:{rel}")
            continue
        actual = sha256(p.read_bytes()).hexdigest()
        if actual != expected:
            failures.append(f"HASH_MISMATCH:{rel}:{actual}")
    return FrozenVerification(not failures, frozen_manifest_root(), len(entries), tuple(failures))
