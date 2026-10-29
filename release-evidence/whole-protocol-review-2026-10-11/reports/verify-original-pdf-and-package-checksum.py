"""Verify preserved PDF and literal checksum bytes, without signing or rewriting."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import zipfile
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

OUTPUTS = Path('/workspace/outputs')
PUBLIC_SHA = 'b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f'
ORIGINAL_SHA = '4b22068f0df2ff2d9b2b3084941ecada40b9915b68ededf4126db6e56671b03b'
INNER_SHA = 'a4b97d9f16da245f9b5a105cd6760a563b6ca5cef71b5a0265d38ae37cb70337'
OUTER_SHA = '62e1273889f5782da1530394f8963e7b29033a973b5af6fd94e4f83ffd080a38'
digest = lambda b: sha256(b).hexdigest()

def stream_hash(stream):
    h = sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
    return h.hexdigest()

def verify_and_tamper(key, signature, message):
    assert len(signature) == 64 and message
    key.verify(signature, message)
    for s, m in [(signature, bytes([message[0] ^ 1]) + message[1:]),
                 (bytes([signature[0] ^ 1]) + signature[1:], message)]:
        try:
            key.verify(s, m)
        except InvalidSignature:
            continue
        raise RuntimeError('Altered bytes accepted')

def run():
    repository = Path('/workspace/numina-production')
    record_path = repository / 'release-evidence/final-manuscript-delivery-2026-10-10/source-record.json'
    record_bytes = record_path.read_bytes()
    record = json.loads(record_bytes)
    for entry in record['files']:
        p = repository / entry['path']
        with p.open('rb') as stream:
            assert stream_hash(stream) == entry['sha256']
        assert p.stat().st_size == entry['bytes']

    inner_path = OUTPUTS / 'Numina-Final-Delivery-Contents.zip'
    outer_path = OUTPUTS / 'Numina-Pair-Binding-02-completed-signed-package.zip'
    for p, expected in [(inner_path, INNER_SHA), (outer_path, OUTER_SHA)]:
        with p.open('rb') as stream:
            assert stream_hash(stream) == expected
    with zipfile.ZipFile(outer_path) as outer:
        with outer.open(inner_path.name) as stream:
            assert stream_hash(stream) == INNER_SHA
        public = outer.read('operational-ed25519-public.raw32')
        assert len(public) == 32 and digest(public) == PUBLIC_SHA
        key = Ed25519PublicKey.from_public_bytes(public)
        checksum = outer.read(inner_path.name + '.sha256')
        expected_checksum = (INNER_SHA + '  ' + inner_path.name + '\n').encode('ascii')
        assert checksum == expected_checksum
        checksum_signature = outer.read(inner_path.name + '.sha256.ed25519.sig64')
        verify_and_tamper(key, checksum_signature, checksum)
        with zipfile.ZipFile(inner_path) as inner:
            assert inner.read('delivery/signing/operational-ed25519-public.raw32') == public
            original_member = 'delivery/manuscript/original-draft-kott-numina-pair-binding-02-evidence-successor.pdf'
            original = inner.read(original_member)
            assert len(original) == 404249 and digest(original) == ORIGINAL_SHA
            original_signature = inner.read('delivery/signing/signatures/manuscript/original-draft-kott-numina-pair-binding-02-evidence-successor.pdf.ed25519.sig64')
            verify_and_tamper(key, original_signature, original)
            checksum_member = 'delivery/SHA256SUMS'
            inventory_checksum = inner.read(checksum_member)
            inventory_signature = inner.read('delivery/signing/signatures/SHA256SUMS.ed25519.sig64')
            verify_and_tamper(key, inventory_signature, inventory_checksum)
            expected_pdf_line = ORIGINAL_SHA + '  manuscript/original-draft-kott-numina-pair-binding-02-evidence-successor.pdf'
            assert expected_pdf_line in inventory_checksum.decode('utf8').splitlines()
            signing_receipt = json.loads(inner.read('delivery/signing/final-document-signing-receipt.json'))
    report = {
        'schema': 'numina.original-pdf-and-package-checksum-readback.v1',
        'checked_at_utc': datetime.now(timezone.utc).isoformat(),
        'status': 'PASS',
        'source_record_sha256': digest(record_bytes),
        'source_record_file_count_verified': len(record['files']),
        'raw_public_key_sha256': PUBLIC_SHA,
        'raw_public_key_bytes': 32,
        'original_pdf': {'member': original_member, 'bytes': len(original), 'sha256': digest(original),
                         'signature_sha256': digest(original_signature), 'signature_verified': True,
                         'signature_event': signing_receipt['signed_at_utc'],
                         'scope': 'New retained operational signature over unchanged original PDF bytes; not recovery of an earlier manuscript signature.'},
        'inner_inventory_checksum': {'member': checksum_member, 'bytes': len(inventory_checksum),
                                      'exact_text_sha256': digest(inventory_checksum),
                                      'signature_sha256': digest(inventory_signature),
                                      'signature_verified': True, 'original_pdf_hash_line_matches': True},
        'inner_zip_checksum': {'archive': inner_path.name, 'archive_sha256': INNER_SHA,
                               'checksum_text_bytes': len(checksum), 'exact_text_sha256': digest(checksum),
                               'signature_sha256': digest(checksum_signature), 'signature_verified': True,
                               'exact_format': 'lowercase SHA256, two ASCII spaces, exact ZIP name, single LF'},
        'outer_zip_sha256': OUTER_SHA,
        'outer_and_inner_archive_bytes_match': True,
        'verified_signatures': 3, 'tamper_rejections': 6,
        'whole_protocol_correctness_established': False,
        'files_changed': False, 'new_signatures_issued': False,
    }
    path = OUTPUTS / 'Numina-Original-PDF-and-Package-Checksum-Readback.json'
    with path.open('x') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'report': str(path), 'status': 'PASS', 'signatures': 3, 'tamper_rejections': 6,
                      'public_key_sha256': PUBLIC_SHA, 'original_pdf_sha256': ORIGINAL_SHA,
                      'inner_checksum_text_sha256': digest(inventory_checksum),
                      'package_checksum_text_sha256': digest(checksum)}))

if __name__ == '__main__':
    run()
