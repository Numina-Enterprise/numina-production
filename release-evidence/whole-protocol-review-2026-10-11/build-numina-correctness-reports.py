"""Build a frozen public successor from finalized reviews; never sign or alter originals."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import zipfile

SOURCE_RECORD_SHA = '1cf4c2fe90af6d24229ac227ed26f28cc02c50f70980ffccab2273b3577c1957'
EXTENSION_SHA = '033a23ec61cf9e0fa850907988ddf21fc18649015e7d9983524644f86f092ad8'
PROOF_ZIP_SHA = '62b3607544daeb524fb82ad60c7442eb9281f9cfb1862029fc716cfd5a14954e'
PROOF_ZIP_NAME = 'NCPS-Lean4-Proofs-2026-10-09.zip'
PUBLIC_KEY_SHA = 'b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f'
REVIEW_FILES = (
    'NCPSModelClosure.lean', 'NCPSModelClosure-audit.log',
    'NCPSModelClosure-verification.json', 'RecoveredTheoremPremises.json',
    'independent-proof-review.json', 'independent-compiler-check.json',
    'independent-remote-check.py', 'implementation-conformance-review.json',
    'implementation-conformance-review.md', 'root-canonicalization-readback.json',
    'probe-runtime-canonicalization.py', 'appendix-q-recovery.json',
    'whole-protocol-proof-obligations.json', 'v156-source-commitment-verification.json',
    'v156-provider-observation.json', 'original-pdf-and-package-checksum-readback.json',
    'verify-original-pdf-and-package-checksum.py',
)

def require(condition, message):
    if not condition:
        raise ValueError(message)

def digest_file(path):
    with path.open('rb') as f:
        h = sha256()
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def record(path, relative):
    require(path.is_file() and not path.is_symlink(), f'Not a regular file: {relative}')
    return {'path': relative, 'bytes': path.stat().st_size, 'sha256': digest_file(path)}

def read_json(path):
    return json.loads(path.read_bytes())

def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + '\n', encoding='utf8')

VERIFY_SOURCE = r'''"""Check frozen report identities and optional operational signatures; not a proof checker."""
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
'''

def build(args):
    repository = args.repository.resolve()
    reviews = args.reviews.resolve()
    destination = args.output.resolve()
    archive = destination.with_suffix('.zip')
    require(not destination.exists() and not archive.exists(), 'Refusing to overwrite a frozen delivery')
    finalized_path = reviews / 'agent-reviews-finalized.json'
    finalized_bytes = finalized_path.read_bytes()
    finalized = json.loads(finalized_bytes)
    require(finalized['state'] == 'finalized', 'Reviewers have not finalized inputs')
    require(set(finalized['files']) == set(REVIEW_FILES), 'Finalized input set differs from the builder contract')
    for name in REVIEW_FILES:
        require(record(reviews / name, name) == finalized['files'][name], f'Review changed after finalization: {name}')

    source_record_path = repository / 'release-evidence/final-manuscript-delivery-2026-10-10/source-record.json'
    source_record_bytes = source_record_path.read_bytes()
    require(sha256(source_record_bytes).hexdigest() == SOURCE_RECORD_SHA, 'Original source record differs')
    original_record = json.loads(source_record_bytes)
    for entry in original_record['files']:
        relative = PurePosixPath(entry['path'])
        require(not relative.is_absolute() and '..' not in relative.parts, 'Unsafe original source-record path')
        require(record(repository / entry['path'], entry['path']) == entry, f'Original delivery differs: {entry["path"]}')
    require(original_record['whole_protocol_verified'] is False, 'Unexpected original proof claim')

    proof = read_json(reviews / 'independent-compiler-check.json')
    independent = read_json(reviews / 'independent-proof-review.json')
    authored = read_json(reviews / 'NCPSModelClosure-verification.json')
    conformance = read_json(reviews / 'implementation-conformance-review.json')
    local_probe = read_json(reviews / 'root-canonicalization-readback.json')
    obligations = read_json(reviews / 'whole-protocol-proof-obligations.json')
    recovery = read_json(reviews / 'appendix-q-recovery.json')
    readback = read_json(reviews / 'original-pdf-and-package-checksum-readback.json')
    require(digest_file(reviews / 'NCPSModelClosure.lean') == EXTENSION_SHA, 'Proof extension differs')
    require(proof['extension']['sha256'] == EXTENSION_SHA == authored['sha256'], 'Proof reviews refer to different sources')
    require(proof['all_compilation_passed'] and len(proof['compilation']) == 13, 'Independent compilation did not pass')
    require(proof['compiler']['trust_level'] == 0 and proof['base_axiom_audit']['original_log_exact'], 'Kernel/audit condition missing')
    require(proof['originals_unchanged'] and independent['independent_execution']['every_unit_passed'], 'Independent review incomplete')
    require(independent['whole_protocol_correctness']['verified'] is False and obligations['whole_protocol_pass'] is False, 'Unsupported protocol-success claim')
    require(conformance['whole_protocol_correctness_established'] is False and recovery['whole_protocol_pass'] is False, 'Review scope conflict')
    require(conformance['probe']['cases'] == local_probe['probe']['cases'], 'Local canonicalization readback differs')
    require(conformance['source_inventory'] == local_probe['source_inventory'], 'Source pins differ between probes')
    for entry in conformance['source_inventory']:
        require(record(repository / entry['path'], entry['path']) == entry, 'Inspected implementation source changed')
    audit = (reviews / 'NCPSModelClosure-audit.log').read_text()
    require(audit == authored['stdout'] == proof['extension']['axiom_output'], 'Extension axiom transcripts differ')
    require(readback['status'] == 'PASS' and readback['raw_public_key_sha256'] == PUBLIC_KEY_SHA, 'PDF/checksum readback incomplete')
    proof_zip = args.proof_zip.resolve()
    require(digest_file(proof_zip) == PROOF_ZIP_SHA, 'Original proof ZIP differs')
    public = args.public_key.resolve()
    require(public.stat().st_size == 32 and digest_file(public) == PUBLIC_KEY_SHA, 'Public operational pin differs')

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='numina-correctness-stage-', dir=destination.parent) as temporary:
        stage = Path(temporary) / destination.name
        (stage / 'reports').mkdir(parents=True)
        for name in REVIEW_FILES:
            shutil.copyfile(reviews / name, stage / 'reports' / name)
            require(record(stage / 'reports' / name, name) == finalized['files'][name], f'Review changed while copying: {name}')
        (stage / 'reports' / finalized_path.name).write_bytes(finalized_bytes)
        (stage / 'original-delivery-source-record.json').write_bytes(source_record_bytes)
        shutil.copyfile(proof_zip, stage / PROOF_ZIP_NAME)
        shutil.copyfile(public, stage / 'operational-ed25519-public.raw32')
        require(digest_file(stage / PROOF_ZIP_NAME) == PROOF_ZIP_SHA, 'Proof archive changed while copying')
        require(digest_file(stage / 'operational-ed25519-public.raw32') == PUBLIC_KEY_SHA, 'Public pin changed while copying')
        shutil.copyfile(Path(__file__), stage / 'build-numina-correctness-reports.py')
        (stage / 'verify_assessment.py').write_text(VERIFY_SOURCE, encoding='utf8')
        assessment = {
            'schema': 'numina.whole-protocol-assessment-successor.v1',
            'assembled_at_utc': datetime.now(timezone.utc).isoformat(),
            'status': 'assessment_completed_with_blockers',
            'whole_protocol_correctness_established': False,
            'target': 'Manuscript numina.pair-binding.v1; distinct from singular universal-pair.v4 runtime projection',
            'attribution': {'author': 'Samuel J. Kott', 'contributor': 'Lauren J. Anderson', 'ai_assistant_display_name': 'Ed25519'},
            'source_of_record': 'Numina production tree',
            'frozen_original_source_record_sha256': SOURCE_RECORD_SHA,
            'original_delivery_files_verified': len(original_record['files']),
            'prior_signed_pdf_and_package_unchanged': True,
            'model': {'base_theorems': 131, 'successor_theorems': 4, 'independent_units_compiled': 13,
                      'trust_level': 0, 'new_custom_axioms': 0, 'new_admitted_proofs': 0,
                      'extension_sha256': EXTENSION_SHA, 'codec_roundtrip_is_explicit_premise': True,
                      'seven_field_gate_does_not_yet_model_all_eight_manuscript_findings': True},
            'original_pdf_and_checksum_readback': {'signatures_verified': 3, 'tamper_rejections': 6,
                                                  'raw_public_key_sha256': PUBLIC_KEY_SHA},
            'historical_source_commitment_reproduction': 'Closed for selected v156 historical projections; formal/current companion bridges remain open',
            'open_obligation_count': len(obligations['obligations']),
            'closure_obligations': obligations['obligations'],
            'next_verifiable_step': recovery['next_verifiable_step'],
            'boundaries': ['Existing runtime canonicalizers and operational delivery signatures do not establish companion wire acceptance.',
                           'Kernel checking depends on the pinned compiler/standard library; computational crypto and operational authenticity assumptions remain explicit.',
                           'No IETF stream acceptance, deployment, policy adoption, private linkage or underlying scientific claim is established by this builder.'],
        }
        write_json(stage / 'assessment.json', assessment)
        (stage / 'README.md').write_text('''# Numina — whole-protocol assessment successor

The existing signed PDF and completed package remain unchanged. This successor records four additional bounded Lean lemmas, independently recompiled with trust level zero, and the original 131-theorem audit. It also records exact original-PDF signature and package-checksum verification.

Whole-protocol correctness remains blocked. The concrete companion parser/JCS/Ed25519 correspondence, eight-finding semantics, authenticated trust/current-state/private mapping, implementation refinement and exact cited proof dependency closure remain open. The recovered seven-field gate theorem is about that abstract model; fixed-tag framing injectivity requires a codec round-trip proof. The extraction counterexample confirms the manuscript's disclosed loss of order in sets.

Historical v156 commitment reproduction is closed for the inspected projections. The current singular universal-pair.v4 projection and the proposed two-source companion v1 are different subjects. Runtime canonicalization counterexamples concern unrestricted JSON values; they are not demonstrated failures of a future enforced companion profile.

Public review inputs are frozen by exact SHA-256 in inventory.json and SHA256SUMS before any later signing. The builder reads the original source record and refuses changed reviews, altered originals or an existing destination. It never signs, generates keys or modifies the original manuscript. Any operational signatures authenticate these exact reports, not their substantive truth or whole-protocol certification.

Run `python3 verify_assessment.py` after extraction. It checks artifact identities and, when present, direct operational signatures and mutation rejection. It does not rerun Lean. Reports retain the pinned native compiler commands; the canonicalization probe requires the inspected source commit. Missing private proof sources are not republished.
''', encoding='utf8')
        files = [record(p, p.relative_to(stage).as_posix()) for p in sorted(stage.rglob('*')) if p.is_file()]
        write_json(stage / 'inventory.json', {'schema': 'numina.correctness-review-inventory.v1',
            'operational_public_key_sha256': PUBLIC_KEY_SHA, 'whole_protocol_correctness_established': False,
            'files': files, 'signature_framing_if_signed': 'pure Ed25519 over exact full-file bytes, no canonicalization or prehash'})
        checksums = files + [record(stage / 'inventory.json', 'inventory.json')]
        (stage / 'SHA256SUMS').write_text(''.join(x['sha256'] + '  ' + x['path'] + '\n' for x in checksums), encoding='ascii')
        for entry in original_record['files']:
            require(record(repository / entry['path'], entry['path']) == entry, 'Original delivery changed during assembly')
        stage.rename(destination)
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as z:
        for p in sorted(destination.rglob('*')):
            if p.is_file():
                info = zipfile.ZipInfo(p.relative_to(destination).as_posix(), date_time=(2026, 10, 11, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                z.writestr(info, p.read_bytes())
    print(json.dumps({'directory': str(destination), 'archive': str(archive), 'archive_sha256': digest_file(archive),
                      'status': assessment['status'], 'whole_protocol_correctness_established': False,
                      'public_inputs_sha256': digest_file(destination / 'inventory.json')}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', type=Path, default=Path('/workspace/numina-production'))
    parser.add_argument('--reviews', type=Path, default=Path('/workspace/scratch/numina-whole-protocol'))
    parser.add_argument('--output', type=Path, default=Path('/workspace/outputs/Numina-Whole-Protocol-Assessment-2026-10-11'))
    parser.add_argument('--proof-zip', type=Path, default=Path('/workspace/outputs/NCPS-Lean4-Proofs-2026-10-09.zip'))
    parser.add_argument('--public-key', type=Path, default=Path('/workspace/outputs/Numina-operational-ed25519-public.raw32'))
    build(parser.parse_args())
