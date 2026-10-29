# Package current iOS sources; no compilation, signing, or publication.
from pathlib import Path
import datetime, hashlib, io, json, subprocess, zipfile

ROOT = Path(__file__).resolve().parent.parent

def identity():
    result = subprocess.run(['node', 'scripts/ios-release.mjs', 'identity'], cwd=ROOT,
                            capture_output=True, text=True, encoding='utf-8', timeout=30, check=True)
    return json.loads(result.stdout)

def write(path, data):
    if isinstance(data, dict):
        data = (json.dumps(data, indent=2) + '\n').encode('utf-8')
    path.write_bytes(data)
    if path.read_bytes() != data:
        raise RuntimeError('Package readback mismatch: ' + str(path))

def main():
    before = identity()
    version = before['applicationVersion']
    prefix = 'numina-os-' + version + '-ios'
    rows = [row for row in before['sourceInputs']['inputs'] if row['path'].startswith('mobile/ios/')]
    entries = {}
    for row in rows:
        path = ROOT / row['path']
        if path.is_symlink() or not path.resolve().is_relative_to((ROOT / 'mobile/ios').resolve()):
            raise RuntimeError('Source path escapes iOS package')
        data = path.read_bytes()
        if path.suffix.lower() not in ['.png', '.jpg', '.jpeg', '.ico']:
            data = data.decode('utf-8').replace('\r\n', '\n').encode('utf-8')
        if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
            raise RuntimeError('Source changed while packaging: ' + row['path'])
        entries[prefix + '/' + row['path'][len('mobile/ios/'):]] = data
    entries[prefix + '/SOURCE-IDENTITY.json'] = (json.dumps(before, indent=2) + '\n').encode('utf-8')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, data in sorted(entries.items()):
            item = zipfile.ZipInfo(name, date_time=(2026, 9, 14, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(item, data)
    archive = buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        if bundle.testzip() is not None or set(bundle.namelist()) != set(entries):
            raise RuntimeError('Source archive integrity mismatch')
        for name, data in entries.items():
            if bundle.read(name) != data:
                raise RuntimeError('Source archive entry mismatch')
    if identity()['sourceInputs']['sha256'] != before['sourceInputs']['sha256']:
        raise RuntimeError('Source changed while packaging')
    record_path = ROOT / ('docs/native-package-record-v' + version.split('.')[0] + '.json')
    record = json.loads(record_path.read_text(encoding='utf-8'))
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    item = {'platform': 'ios', 'file': prefix + '-source.zip', 'bytes': len(archive),
            'sha256': hashlib.sha256(archive).hexdigest(), 'kind': 'source_archive', 'installable': False,
            'sourceBuildNumber': before['buildNumber'], 'sourceInputsSha256': before['sourceInputs']['sha256'],
            'sourceTextNormalization': 'utf8_lf_binary_unchanged', 'packagedAtUtc': timestamp}
    record['sourceArchives'] = [old for old in record['sourceArchives'] if old['platform'] != 'ios'] + [item]
    record['ios'].update(sourceBuildNumber=before['buildNumber'], currentSourceCompiled=False,
                         sourceInputsSha256=before['sourceInputs']['sha256'], signingInputMatchesCurrentSource=False,
                         sourceAlignmentScope='current_source_package_not_native_build')
    record['iosSourcePackagedAtUtc'] = timestamp
    record['nativeDistributionPolicy'] = 'Historical binaries retain their exact bytes and build evidence. Current iOS source requires a fresh compile and matching signing input.'
    write(ROOT / 'docs' / item['file'], archive)
    write(record_path, record)
    mirror = ROOT / 'runtime/vercel-production/public/downloads'
    if mirror.exists():
        write(mirror / item['file'], archive)
        write(mirror / record_path.name, record)
    print(json.dumps({'iosSource': item, 'nativeBinariesChanged': False, 'compiled': False,
                      'signed': False, 'published': False}))

if __name__ == '__main__':
    main()
