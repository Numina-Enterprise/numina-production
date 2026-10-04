"""Package maintained Numina sources without running application tests."""
from pathlib import Path
import argparse, datetime, hashlib, json, subprocess, zipfile

root = Path(__file__).resolve().parent.parent
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
write = lambda p, value: p.write_text(json.dumps(value, indent=2)+'\n', encoding='utf-8', newline='\n')
sha = lambda data: hashlib.sha256(data).hexdigest()
version = read(root/'package.json')['version']
major = version.split('.')[0]
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--native-only', action='store_true', help='Refresh native source archives without rebuilding integration distributions.')
options = parser.parse_args()

def package(source, name, prefix, paths):
    target = root/'docs'/name
    entries = {}
    for path in sorted(paths):
        if path.is_symlink() or not path.resolve().is_relative_to(source.resolve()):
            raise RuntimeError('Source path escapes its package')
        relative = path.relative_to(source).as_posix()
        if '..' in Path(relative).parts or path.suffix.lower() in {'.key','.p12','.jks','.keystore','.mobileprovision'} or path.name.startswith('.env'):
            raise RuntimeError('Unpublishable source input: '+relative)
        entries[prefix+'/'+relative] = path.read_bytes()
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name,date_time=(2026,9,13,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(info,data)
    with zipfile.ZipFile(target) as bundle:
        if bundle.testzip() is not None or set(bundle.namelist()) != set(entries):
            raise RuntimeError('Archive integrity mismatch')
        for name, data in entries.items():
            if sha(bundle.read(name)) != sha(data):
                raise RuntimeError('Archive source mismatch: '+name)
    return {'file':target.name,'bytes':target.stat().st_size,'sha256':sha(target.read_bytes())}

subprocess.run(['node','scripts/package-legal-companions.mjs'],cwd=root,check=True)
record = plugin = None
if not options.native_only:
    subprocess.run(['node','integrations/numina/scripts/package-distribution.js'],cwd=root,check=True)
    source = root/'integrations/numina'
    inventory = read(source/'file-manifest.json')
    item = package(source,f'numina-integration-kit-v{version}.zip',f'numina-integration-kit-v{version}',[source/f['path'] for f in inventory['files']]+[source/'file-manifest.json'])
    verification = read(source/'verification.json')
    record = {'schema':'numina.integration.archive.v2','version':version,'revision':verification['revision'],'archive':item['file'],'bytes':item['bytes'],'sha256':item['sha256'],'packagedAtUtc':now,'sourceFiles':len(inventory['files'])+1,'testsRun':False,'defaultTools':verification['defaultTools'],'applicationManifest':verification['applicationManifest'],'providerInstallationPerformed':False,'registryPublicationPerformed':False,'sitePublicationPerformedByThisPackageStep':False,'livemode':True}
    write(root/f'docs/integration-kit-v{version}-record.json',record)
    source = root/'integrations/codex/numina'
    plugin = package(source,f'numina-codex-plugin-{version}.zip','numina',[p for p in source.rglob('*') if p.is_file()])
    write(root/f'docs/codex-plugin-v{major}-record.json',{'version':version,**plugin,'publication':'download_available_after_deployment','marketplacePublicationVerified':False})
native = read(root/f'docs/native-package-record-v{major}.json')
native['sourceArchives'] = []
for platform in ['android','ios']:
    source = root/'mobile'/platform
    paths = [p for p in source.rglob('*') if p.is_file() and not set(p.relative_to(source).parts)&{'.gradle','build','.DS_Store','local.properties'}]
    item = package(source,f'numina-os-{version}-{platform}-source.zip',f'numina-os-{version}-{platform}',paths)
    native['sourceArchives'].append({'platform':platform,**item,'kind':'source_archive','installable':False})
native['sourcePackagedAtUtc'] = now
write(root/f'docs/native-package-record-v{major}.json',native)
mirror = root/'runtime/vercel-production/public/downloads'
if mirror.exists():
    (mirror/f'native-package-record-v{major}.json').write_bytes((root/f'docs/native-package-record-v{major}.json').read_bytes())
    for item in native['sourceArchives']:
        (mirror/item['file']).write_bytes((root/'docs'/item['file']).read_bytes())
# Refresh the iOS-specific source fingerprint after general source packaging.
subprocess.run([__import__('sys').executable,'scripts/package-ios-source.py'],cwd=root,check=True)
native = read(root/f'docs/native-package-record-v{major}.json')
print(json.dumps({'version':version,'integration':record,'plugin':plugin,'nativeSources':native['sourceArchives'],'nativeBinariesChanged':False,'applicationTestsRun':False}))
