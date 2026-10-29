#!/usr/bin/env python3
"""Freeze the new public migration follow-up and completed ZIP commitment."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import zlib

ROOT = Path('/workspace/numina-production')
OUT = ROOT / 'outputs/v162-signed-delivery-2026-10-11'
STAGE = OUT / 'signed-supplement'
PIN = 'b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f'
PRIMARY_REQUEST = '47cf7ef6c7bf10f22228ccc3843bab35acc22b042ee9e38da03d310af11d7874'
PRIMARY_INVENTORY = '398c552bc9b3471caf14936c640235195f5f49776be624b4694a75518c058f83'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')

def main():
    STAGE.mkdir()
    targets = {}
    def add(name, data):
        assert name not in targets
        path = STAGE / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        targets[name] = data
    for source, name in [
        ('/workspace/scratch/numina-salesforce-migration-integration-health-2026-10-11.json', 'salesforce-migration-integration-health.json'),
        ('/workspace/scratch/numina-v162-frozen-stage-blue-review.json', 'frozen-stage-blue-review.json'),
        (str(OUT / 'primary-package-verification.json'), 'primary-package-verification.json'),
        (str(ROOT / 'scripts/verify-exact-numina-delivery.py'), 'tools/verify-exact-numina-delivery.py'),
        ('/workspace/scratch/verify-numina-v162-delivery.py', 'tools/verify-numina-v162-delivery.py'),
        ('/workspace/scratch/verify-numina-v162-completed-wrapper.py', 'tools/verify-numina-v162-completed-wrapper.py'),
        (__file__, 'tools/build-v162-signing-supplement.py'),
    ]:
        add(name, Path(source).read_bytes())
    assert sha(targets['salesforce-migration-integration-health.json']) == 'e048e7d168f115ff4c343cf0c4f9762df7d81c5d732701e0c44d41e5be8315d7'
    assert sha(targets['tools/verify-numina-v162-completed-wrapper.py']) == '855df6e0db577af08d3b4ed79c2ad7dcecc704c578f5a75635e71d80408a1146'
    archive = OUT / 'numina-v162-signed-package.zip'
    raw = archive.read_bytes()
    assert len(raw) == 41776034 and sha(raw) == '676e16a1a90f6927d805516c88d7a767c132ee19af1ffcc83cbc9f1eb61fc99c'
    commitment = {'schema': 'numina.v162-package-commitment.v1', 'package': {'path': 'package/numina-v162-signed-package.zip', 'bytes': len(raw), 'sha256': sha(raw)}, 'primary_request_sha256': PRIMARY_REQUEST, 'primary_inventory_sha256': PRIMARY_INVENTORY}
    add('package-commitment.json', encode(commitment))
    add('package.sha256', (sha(raw) + '  package/numina-v162-signed-package.zip\n').encode())
    add('operational-ed25519-public.raw32', bytes.fromhex('f29ec679836c6889ef87d41b842bfd2236004c1a6d84d4bac0814cae45a90c28'))
    add('README.md', b'# Numina completed delivery supplement\n\nThis new operational signing event directly signs the exact completed primary ZIP checksum and SHA-256 commitment, its positive cloud verification report, the frozen-stage review, public verification programs, and the Salesforce migration follow-up. The primary ZIP remains unchanged. Both signing receipts retain distinct dates and independent request/inventory pins. The container preserves the original primary package structure inside package/numina-v162-signed-package.zip.\n\nSalesforce-confirmed successful migration and a fully available org are recorded as reported facts. The disabled workspace connector describes this workspace access; it does not establish migration failure or org unavailability. Authenticated integration health remains unobserved.\n\nThe directly signed package-commitment.json binds the exact primary ZIP through SHA-256; the ZIP itself is not directly signed as binary bytes. All raw64 signature sidecars are exact full-file pure Ed25519 signatures over their identified documents, including package.sha256. No private key or private journal is included.\n\nThe final signed manuscript is unchanged. Complete journal recovery, actual Salesforce activation, whole-protocol correctness and ISE acceptance remain separate unestablished findings. No broad test or mutation campaign was performed.\n')
    rows = [{'path': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in sorted(targets.items())]
    inventory = encode({'schema': 'numina.exact-delivery-inventory.v1', 'public_key_sha256': PIN, 'files': rows})
    pin = sha(inventory)
    add('inventory.json', inventory)
    add('SHA256SUMS', (''.join(row['sha256']+'  '+row['path']+'\n' for row in rows)+pin+'  inventory.json\n').encode())
    request = {'schema': 'numina.exact-delivery-signing-request.v1', 'purpose': 'Separate operational signature event over the completed version 162 primary ZIP checksum/commitment and public verification/migration follow-up; no change to earlier signed bytes.', 'public_key_sha256': PIN, 'inventory_sha256': pin, 'whole_protocol_correctness_established': False, 'independent_stream_acceptance_established': False, 'targets': [{'path': name, 'bytes': len(data), 'sha256': sha(data), 'message_base64': base64.b64encode(data).decode('ascii')} for name, data in sorted(targets.items())]}
    raw = encode(request)
    (STAGE / 'request.json').write_bytes(raw)
    spec = importlib.util.spec_from_file_location('public_schema', ROOT / 'scripts/sign-exact-numina-delivery.py')
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.read_public_request(STAGE, sha(raw), pin)
    transport = base64.b64encode(zlib.compress(raw, 9))
    (OUT / 'supplement-request.zlib.b64').write_bytes(transport)
    meta = {'stage': str(STAGE), 'request_sha256': sha(raw), 'inventory_sha256': pin, 'request_bytes': len(raw), 'target_count': len(targets), 'expected_new_signatures': len(targets)+1, 'transport_bytes': len(transport), 'transport_sha256': sha(transport), 'chunk_size': 12288, 'chunks': (len(transport)+12287)//12288}
    (OUT / 'supplement-freeze.json').write_bytes(encode(meta));print(json.dumps(meta))

if __name__ == '__main__':
    main()
