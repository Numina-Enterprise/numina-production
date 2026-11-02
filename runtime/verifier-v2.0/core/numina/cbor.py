from __future__ import annotations
from dataclasses import asdict, is_dataclass
from enum import Enum

# Minimal deterministic CBOR (RFC 8949 canonical ordering subset) for the
# authority objects used by this reference runtime. Supports None/bool/int,
# bytes/str, arrays/tuples, maps, dataclasses, enums. Floats are prohibited.

def _norm(v):
    if is_dataclass(v): return _norm(asdict(v))
    if isinstance(v, Enum): return _norm(v.value)
    if isinstance(v, tuple): return [_norm(x) for x in v]
    if isinstance(v, list): return [_norm(x) for x in v]
    if isinstance(v, set): return sorted((_norm(x) for x in v), key=lambda x: encode(x))
    if isinstance(v, dict): return {_norm(k): _norm(val) for k,val in v.items()}
    if isinstance(v, float): raise TypeError('floats are constitutionally prohibited')
    return v

def _head(major:int, n:int)->bytes:
    if n < 0: raise ValueError(n)
    if n < 24: return bytes([(major<<5)|n])
    if n < 256: return bytes([(major<<5)|24, n])
    if n < 65536: return bytes([(major<<5)|25]) + n.to_bytes(2,'big')
    if n < 2**32: return bytes([(major<<5)|26]) + n.to_bytes(4,'big')
    if n < 2**64: return bytes([(major<<5)|27]) + n.to_bytes(8,'big')
    raise OverflowError('integer too large for reference CBOR profile')

def encode(v)->bytes:
    v=_norm(v)
    if v is None: return b'\xf6'
    if v is False: return b'\xf4'
    if v is True: return b'\xf5'
    if isinstance(v,int):
        return _head(0,v) if v>=0 else _head(1,-1-v)
    if isinstance(v,bytes): return _head(2,len(v))+v
    if isinstance(v,str):
        b=v.encode('utf-8'); return _head(3,len(b))+b
    if isinstance(v,list): return _head(4,len(v))+b''.join(encode(x) for x in v)
    if isinstance(v,dict):
        pairs=[(encode(k), encode(val)) for k,val in v.items()]
        pairs.sort(key=lambda kv:(len(kv[0]),kv[0]))
        return _head(5,len(pairs))+b''.join(k+val for k,val in pairs)
    raise TypeError(f'unsupported CBOR type: {type(v)!r}')
