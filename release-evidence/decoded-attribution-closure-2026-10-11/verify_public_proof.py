"""Verify the exact signed decoded-attribution packet; does not rerun Lean."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
import json
import re
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

root = Path(__file__).resolve().parent
public = (root / 'operational-ed25519-public.raw32').read_bytes()
if len(public) != 32 or sha256(public).hexdigest() != 'b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f':
    raise ValueError('Established operational public pin differs')
checksum = (root / 'SHA256SUMS').read_bytes()
rows = []
for line in checksum.decode('ascii').splitlines(keepends=True):
    match = re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9_.\-/]+)\n', line)
    if not match:
        raise ValueError('Malformed literal checksum line')
    digest, name = match.groups()
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or str(path) != name:
        raise ValueError('Unsafe checksum path')
    rows.append((digest, name))
names = {name for _, name in rows}
if len(names) != len(rows):
    raise ValueError('Duplicate checksum entry')
for digest, name in rows:
    if sha256((root / name).read_bytes()).hexdigest() != digest:
        raise ValueError('Frozen proof input differs')
key = Ed25519PublicKey.from_public_bytes(public)
targets = sorted(name for name in names if name.endswith(('.json', '.md', '.py', '.lean')))
targets += ['SHA256SUMS', 'verify_public_proof.py']
allowed = names | {'SHA256SUMS', 'operational-ed25519-public.raw32', 'verify_public_proof.py'}
for name in targets:
    message = (root / name).read_bytes()
    signature_name = 'signatures/' + name + '.ed25519.sig64'
    signature = (root / signature_name).read_bytes()
    if len(signature) != 64 or not message:
        raise ValueError('Malformed signature/message')
    key.verify(signature, message)
    for s, m in [(signature, bytes([message[0] ^ 1]) + message[1:]), (bytes([signature[0] ^ 1]) + signature[1:], message)]:
        try:
            key.verify(s, m)
        except InvalidSignature:
            continue
        raise ValueError('Altered bytes were accepted')
    allowed.add(signature_name)
for path in root.rglob('*'):
    if path.is_symlink() or not (path.is_file() or path.is_dir()):
        raise ValueError('Nonregular delivery object')
actual = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file()}
if actual != allowed:
    raise ValueError('Missing or unlisted delivery file')
print(json.dumps({'status': 'EXACT_SIGNED_PROOF_PACKET_PASS', 'signatures_verified': len(targets), 'tamper_rejections': 2 * len(targets), 'new_bounded_theorems': 12, 'whole_protocol_correctness_established': False, 'limit': 'Authenticates retained bytes; compiler and semantic review are separately recorded.'}))
