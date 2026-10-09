from __future__ import annotations
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FROZEN_MANIFEST=ROOT/"FROZEN-CORE-v1.8.sha256"

@dataclass(frozen=True)
class FrozenVerification:
    valid: bool
    manifest_root: str
    checked: int
    failures: tuple[str, ...]


def _entries():
    out=[]
    for raw in FROZEN_MANIFEST.read_text().splitlines():
        if not raw.strip():
            continue
        expected,path=raw.split(None,1)
        path=path.strip()
        if path.startswith("./"):
            path=path[2:]
        out.append((path,expected))
    return out


def frozen_manifest_root() -> str:
    canonical="\n".join(f"{h} {p}" for p,h in sorted(_entries())).encode()
    return sha256(canonical).hexdigest()


def verify_frozen_core() -> FrozenVerification:
    failures=[]
    entries=_entries()
    for rel,expected in entries:
        p=ROOT/rel
        if not p.exists():
            failures.append(f"MISSING:{rel}")
            continue
        actual=sha256(p.read_bytes()).hexdigest()
        if actual != expected:
            failures.append(f"HASH_MISMATCH:{rel}:{actual}")
    return FrozenVerification(not failures,frozen_manifest_root(),len(entries),tuple(failures))
