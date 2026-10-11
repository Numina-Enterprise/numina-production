"""Check frozen report identities and optional operational signatures; not a proof checker."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
import json

root = Path(__file__).resolve().parent
inventory_path = root / 'inventory.json'
inventory = json.loads(inventory_path.read_bytes())
PUBLIC_SHA = 'b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f'
if inventory['operational_public_key_sha256'] != PUBLIC_SHA:
    raise ValueError('Inventory substitutes the established operational public pin')
expected = set()
for entry in inventory['files']:
    relative = PurePosixPath(entry['path'])
    if relative.is_absolute() or '..' in relative.parts or str(relative) != entry['path']:
        raise ValueError('Unsafe inventory path')
    if entry['path'] in expected:
        raise ValueError('Duplicate inventory path')
    expected.add(entry['path'])
    p = root / entry['path']
    if p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(root):
        raise ValueError('Missing or substituted artifact')
    b = p.read_bytes()
    if len(b) != entry['bytes'] or sha256(b).hexdigest() != entry['sha256']:
        raise ValueError('Artifact differs from frozen review')
checksum_text = ''.join(x['sha256'] + '  ' + x['path'] + '\n' for x in inventory['files'])
checksum_text += sha256(inventory_path.read_bytes()).hexdigest() + '  inventory.json\n'
if (root / 'SHA256SUMS').read_bytes() != checksum_text.encode('ascii'):
    raise ValueError('Literal checksum list differs')
assessment = json.loads((root / 'assessment.json').read_bytes())
if assessment['whole_protocol_correctness_established'] is not False:
    raise ValueError('Unsupported whole-protocol success claim')
signatures = root / 'signatures'
signature_count = 0
allowed = expected | {'inventory.json', 'SHA256SUMS'}
raw = (root / 'operational-ed25519-public.raw32').read_bytes()
if len(raw) != 32 or sha256(raw).hexdigest() != PUBLIC_SHA:
    raise ValueError('Operational public pin differs')
if signatures.exists():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.exceptions import InvalidSignature
    key = Ed25519PublicKey.from_public_bytes(raw)
    targets = [x['path'] for x in inventory['files'] if x['path'].endswith(('.json','.md','.py','.lean','.log'))]
    targets += ['inventory.json', 'SHA256SUMS']
    if (root / 'operational-signing-receipt.json').exists():
        targets += ['operational-signing-receipt.json']
        allowed.add('operational-signing-receipt.json')
    for name in targets:
        data = (root / name).read_bytes()
        sig = (signatures / (name + '.ed25519.sig64')).read_bytes()
        allowed.add('signatures/' + name + '.ed25519.sig64')
        if len(sig) != 64 or not data:
            raise ValueError('Malformed direct signature')
        key.verify(sig, data)
        for s, m in [(sig, bytes([data[0] ^ 1]) + data[1:]), (bytes([sig[0] ^ 1]) + sig[1:], data)]:
            try:
                key.verify(s, m)
            except InvalidSignature:
                continue
            raise ValueError('Tamper accepted')
        signature_count += 1
for p in root.rglob('*'):
    if p.is_symlink() or (not p.is_dir() and not p.is_file()):
        raise ValueError('Nonregular object in delivery')
actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
if actual != allowed:
    raise ValueError('Missing or unlisted delivery file')
print(json.dumps({'status':'INTEGRITY_PASS_WITH_PROTOCOL_BLOCKERS', 'inventoried_files':len(expected),
                  'operational_signatures_verified':signature_count, 'tamper_rejections':2*signature_count,
                  'whole_protocol_correctness_established':False,
                  'limitation':'Checks retained identities and signatures; does not rerun Lean or certify report assertions.'}))
