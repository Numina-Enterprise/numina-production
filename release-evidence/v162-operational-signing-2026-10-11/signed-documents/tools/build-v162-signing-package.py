#!/usr/bin/env python3
"""Freeze public version-162 inputs for the existing exact-byte signer."""
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import zlib

ROOT = Path('/workspace/numina-production')
OUT = ROOT / 'outputs/v162-signed-delivery-2026-10-11'
STAGE = OUT / 'signed-documents'
PIN = 'b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f'
PUBLIC = bytes.fromhex('f29ec679836c6889ef87d41b842bfd2236004c1a6d84d4bac0814cae45a90c28')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')

def main():
    if OUT.exists():
        raise RuntimeError('Use a fresh stage; never overwrite a frozen signing event')
    STAGE.mkdir(parents=True)
    proposal_path = Path('/workspace/scratch/numina-v162-current-unsigned-signing-inventory-proposal-v2.json')
    proposal = json.loads(proposal_path.read_bytes())
    assert sha(proposal_path.read_bytes()) == 'e7d0c67fc5e4a8f40648ddd97df8785455fa91770f8e1ffe0aa068323a5ca2af'
    targets = {}
    def add(name, data):
        if name in targets:
            assert targets[name] == data
            return
        assert not name.startswith('/') and '..' not in Path(name).parts
        destination = STAGE / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        targets[name] = data
    def copy_row(row):
        source = Path(row['path'])
        assert source.is_file() and not source.is_symlink()
        data = source.read_bytes()
        assert len(data) == row['bytes'] and sha(data) == row['sha256'], str(source)
        add(str(source.relative_to('/workspace')), data)
    for row in proposal['directDocumentTargets']:
        copy_row(row)
        for alias in row.get('byte_identical_aliases', []):
            copy_row(alias)
    add('review/signing-inventory-proposal.json', proposal_path.read_bytes())
    for source, name in [
        ('/workspace/scratch/numina-v162-provider-fresh-public-readback.json', 'review/fresh-provider-readback.json'),
        ('/workspace/scratch/numina-protocol-ietf-closure-current-readback-2026-10-11.json', 'review/protocol-ietf-closure.json'),
        ('/workspace/scratch/numina-protocol-ietf-closure-current-readback-2026-10-11.md', 'review/protocol-ietf-closure.md'),
        ('/workspace/scratch/numina-protocol-ietf-public-sources-2026-10-11.json', 'review/official-ietf-process-sources.json'),
        ('/workspace/scratch/numina-v162-coordinator-signing-readback.json', 'review/fresh-coordinator-readback.json'),
        ('/workspace/scratch/verify-numina-v162-delivery.py', 'tools/verify-numina-v162-delivery.py'),
        (str(ROOT / 'scripts/verify-exact-numina-delivery.py'), 'tools/verify-exact-numina-delivery.py'),
        (__file__, 'tools/build-v162-signing-package.py'),
    ]:
        add(name, Path(source).read_bytes())
    archive = proposal['supportingBinaryArtifacts'][0]
    archive_path = Path(archive['path'])
    archive_data = archive_path.read_bytes()
    assert len(archive_data) == archive['bytes'] and sha(archive_data) == archive['sha256']
    outer_path = 'artifacts/numina-cloud-site-delivery.tar.gz'
    (OUT / 'artifacts').mkdir()
    shutil.copyfile(archive_path, OUT / outer_path)
    commitment = {
        'schema': 'numina.v162-archive-commitment.v1',
        'archive': {'path': outer_path, 'bytes': archive['bytes'], 'sha256': archive['sha256']},
        'regular_members': [{k: row[k] for k in ('archive_member', 'bytes', 'sha256')} for row in proposal['archiveRegularMemberInventory']],
    }
    add('archive-commitment.json', encode(commitment))
    add('archive.sha256', (archive['sha256'] + '  ' + outer_path + '\n').encode())
    add('operational-ed25519-public.raw32', PUBLIC)
    report = {
        'schema': 'numina.v162-current-external-gates.v1',
        'assembled_at_utc': datetime.now(timezone.utc).isoformat(),
        'deployment': {'version': 162, 'deployment_id': proposal['deploymentId'], 'status': 'succeeded', 'publication_source_commit': proposal['sitesSourceCommit']},
        'journal': {'observed_at_utc': '2026-10-11T20:16:34.201Z', 'rows': 143, 'contiguous': True, 'complete_event_and_command_hashes_verified': 138, 'hash_mismatches': 0, 'truncated_revisions': [73,134,140,141,142], 'manifest_truncated': True, 'full_recovery': False, 'mcp_readback': 'UNAUTHORIZED; reconnect required', 'next_action': 'Reconnect the existing Numina MCP app or obtain a supported untruncated owner database export; retain private journal values privately.'},
        'salesforce': {'observed_at_utc': '2026-10-11T20:13:00Z', 'connector_state': 'DISABLED_BY_ADMIN / NOT_AVAILABLE', 'authenticated_agent_or_version_ids': False, 'tasks_included': 100, 'activated_salesforce_agents': None, 'activation_established': False, 'next_action': 'Workspace administrator restores the approved Salesforce connector; then read authenticated org, agent/version IDs and entitlement before actual activation.'},
        'whole_protocol_correctness_established': False,
        'proof_scope': 'Retained Lean 4.24 manuscript findings and later bounded Lean 4.22 checks remain distinct; 15 concrete whole-protocol obligations remain open. See signed review/protocol-ietf-closure.json.',
        'independent_stream_acceptance_established': False,
        'ietf': {'fresh_official_process_guidance_retrieved': True, 'fresh_datatracker_read': 'bot_blocked', 'last_retained_public_observation_at_utc': '2026-10-11T04:06:16.806983+00:00', 'last_retained_revision': '01', 'last_retained_stream': None, 'decision_authority': 'Independent Submissions Editor; a local operational signature is not an editorial acceptance receipt.'},
        'signed_manuscript': {'sha256': '3e5db9f5ef29b7adb7ce408488b6c78cdd7121732d92efa638157de7a96f3ce9', 'unchanged': True, 'new_paper_edition_created': False},
        'financial_operations_performed': False,
        'broad_test_or_mutation_campaigns_performed': False,
        'signing_boundary': 'This new operational signing event authenticates the exact files and existing findings. Original signed:false labels describe their earlier issuance; signatures are retained separately and do not change those original bytes.'
    }
    add('current-gates.json', encode(report))
    add('README.md', b'# Numina version 162 signed delivery\n\nThis separate operational signing event preserves every original file byte and the final signed manuscript. It directly signs the reviewed deployment receipt, public reports, programs, all 100 prepared task records, exact public-key representation, inventory and literal checksums. The 40 MB site gzip and its 366 member identities are bound through the directly signed archive-commitment.json and archive.sha256. The gzip is not directly signed as binary bytes.\n\nThe original receipt remains byte-identical with its historical unsigned-at-issuance label. Its new detached signature is in signatures/numina-production/release-evidence/cloud-coordination-publication-2026-10-11.json.ed25519.sig64. Detached files contain raw 64-byte Ed25519 signatures despite the retained sig64 filename convention.\n\nThe established operational public-key SHA-256 is b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f. Independent request and inventory pins are required by the included verifier. No private key is included.\n\nSigning does not activate Salesforce tasks, complete truncated journal recovery, prove the whole protocol, or establish an ISE publication decision. current-gates.json and review/protocol-ietf-closure.json retain the concrete findings and next actions. No new manuscript edition or broad test/mutation campaign was performed. No personal funds were used.\n')
    rows = [{'path': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in sorted(targets.items())]
    inventory_bytes = encode({'schema': 'numina.exact-delivery-inventory.v1', 'public_key_sha256': PIN, 'files': rows})
    inventory_sha = sha(inventory_bytes)
    add('inventory.json', inventory_bytes)
    checksums = ''.join(row['sha256'] + '  ' + row['path'] + '\n' for row in rows) + inventory_sha + '  inventory.json\n'
    add('SHA256SUMS', checksums.encode())
    request = {'schema': 'numina.exact-delivery-signing-request.v1', 'purpose': 'New exact-byte operational signing event for the reviewed Numina version 162 deployment receipt, public source/report/task records and archive commitment; original signed manuscript unchanged.', 'public_key_sha256': PIN, 'inventory_sha256': inventory_sha, 'whole_protocol_correctness_established': False, 'independent_stream_acceptance_established': False, 'targets': [{'path': name, 'bytes': len(data), 'sha256': sha(data), 'message_base64': base64.b64encode(data).decode('ascii')} for name, data in sorted(targets.items())]}
    request_bytes = encode(request)
    (STAGE / 'request.json').write_bytes(request_bytes)
    spec = importlib.util.spec_from_file_location('public_signing_schema', ROOT / 'scripts/sign-exact-numina-delivery.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.read_public_request(STAGE, sha(request_bytes), inventory_sha)
    compressed = zlib.compress(request_bytes, 9)
    transport = base64.b64encode(compressed)
    (OUT / 'request.zlib.b64').write_bytes(transport)
    metadata = {'stage': str(STAGE), 'request_sha256': sha(request_bytes), 'inventory_sha256': inventory_sha, 'request_bytes': len(request_bytes), 'target_count': len(targets), 'expected_new_signatures': len(targets) + 1, 'compressed_bytes': len(compressed), 'transport_bytes': len(transport), 'archive_sha256': archive['sha256']}
    (OUT / 'freeze.json').write_bytes(encode(metadata))
    print(json.dumps(metadata))

if __name__ == '__main__':
    main()
