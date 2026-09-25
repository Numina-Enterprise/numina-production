"""Refresh only the current integration archive from its verified file inventory."""
from pathlib import Path
import hashlib, json, zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'integrations/numina'
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
sha = lambda b: hashlib.sha256(b).hexdigest()
manifest = read(source / 'file-manifest.json')
verification = read(source / 'verification.json')
version = manifest['version']
prefix = 'numina-integration-kit-v' + version
archive = root / 'docs' / (prefix + '.zip')
entries = {}
for item in manifest['files'] + [{'path': 'file-manifest.json'}]:
    name = item['path']
    path = source / name
    if path.is_symlink() or not path.resolve().is_relative_to(source.resolve()) or '..' in Path(name).parts:
        raise ValueError('Invalid integration input: ' + name)
    if path.name.startswith('.env') or path.suffix in {'.key', '.pem', '.p12', '.keystore'}:
        raise ValueError('Private integration input: ' + name)
    data = path.read_bytes()
    if 'sha256' in item and (sha(data) != item['sha256'] or len(data) != item['bytes']):
        raise ValueError('Integration inventory mismatch: ' + name)
    entries[prefix + '/' + name] = data
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
    for name, data in sorted(entries.items()):
        info = zipfile.ZipInfo(name, date_time=(2026, 9, 19, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        bundle.writestr(info, data)
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert set(bundle.namelist()) == set(entries)
    for name, data in entries.items():
        assert bundle.read(name) == data, name
record = {
    'schema': 'numina.integration.archive.v2', 'identity': 'NUMINA',
    'version': version, 'revision': verification['revision'],
    'archive': archive.name, 'bytes': archive.stat().st_size,
    'sha256': sha(archive.read_bytes()), 'packagedAtUtc': verification['packagedAtUtc'],
    'sourceFiles': len(entries), 'testsRun': False,
    'defaultTools': verification['defaultTools'],
    'applicationManifest': verification['applicationManifest'],
    'manifestSha256': sha((source / 'file-manifest.json').read_bytes()),
    'canonicalTreasuryValues': manifest['canonicalTreasuryValues'],
    'historicalSettlementReceipt': manifest['treasuryAlignment']['historicalSettlementReceipt'],
    'providerInstallationPerformed': False, 'registryPublicationPerformed': False,
    'sitePublicationPerformedByThisPackageStep': False, 'livemode': True
}
(root / 'docs' / ('integration-kit-v' + version + '-record.json')).write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'archive': archive.name, 'files': len(entries), 'manifestMatchesCurrent': True}))
