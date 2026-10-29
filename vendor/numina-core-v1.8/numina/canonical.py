from __future__ import annotations
import json
from hashlib import sha256
from dataclasses import asdict, is_dataclass
from enum import Enum


def normalize(v):
    if is_dataclass(v): return normalize(asdict(v))
    if isinstance(v, Enum): return v.value
    if isinstance(v, dict): return {str(k): normalize(v[k]) for k in sorted(v)}
    if isinstance(v, (list, tuple)): return [normalize(x) for x in v]
    if isinstance(v, set): return sorted(normalize(x) for x in v)
    return v


def canonical_bytes(v) -> bytes:
    return json.dumps(normalize(v), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(v) -> str:
    return sha256(canonical_bytes(v)).hexdigest()
