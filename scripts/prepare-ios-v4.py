"""Version the retained unsigned iOS bundle; preserve its executable bytes."""
from pathlib import Path
import hashlib, json, plistlib, shutil, zipfile

root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version']
record_path=root/f'docs/native-package-record-v{version.split(".")[0]}.json'
record=json.loads(record_path.read_text())
previous=json.loads((root/'docs/native-package-record-v3.json').read_text())['ios']
original=previous['binaries'][0]
source=root/'docs'/original['file']
sha=lambda data:hashlib.sha256(data).hexdigest()
if sha(source.read_bytes())!=original['sha256']:raise RuntimeError('Original iOS artifact hash mismatch')
target=root/f'docs/numina-{version}-ios-unsigned-app.zip'
with zipfile.ZipFile(source) as bundle:
    infos=bundle.infolist()
    if len({item.filename for item in infos})!=len(infos):raise RuntimeError('Duplicate archive paths')
    contents={item.filename:bundle.read(item) for item in infos}
    if any('_CodeSignature' in name or name.endswith('.mobileprovision') for name in contents):raise RuntimeError('Input must be the retained unsigned bundle')
    plist_name='Numina.app/Info.plist'
    info=plistlib.loads(contents[plist_name])
    if info['CFBundleIdentifier']!='xyz.numinalabs.app':raise RuntimeError('Unexpected bundle identity')
    executable='Numina.app/'+info['CFBundleExecutable']
    executable_sha=sha(contents[executable])
    info['CFBundleShortVersionString']=version
    info['CFBundleVersion']=str(record['versionCode'])
    contents[plist_name]=plistlib.dumps(info,fmt=plistlib.FMT_BINARY,sort_keys=False)
    with zipfile.ZipFile(target,'w') as output:
        for item in infos:output.writestr(item,contents[item.filename])
with zipfile.ZipFile(target) as output:
    if sha(output.read(executable))!=executable_sha:raise RuntimeError('Executable bytes changed')
    for name,data in contents.items():
        if output.read(name)!=data:raise RuntimeError('Packaged bundle contents differ')
artifact={'file':target.name,'bytes':target.stat().st_size,'sha256':sha(target.read_bytes()),'platform':'ios','signed':False,'installable':False,'url':'/downloads/'+target.name}
record['ios']={
    'status':'unsigned_v4_bundle_prepared','binaries':[artifact],
    'binaryApplicationVersion':version,'binaryVersionCode':record['versionCode'],
    'sourceApplicationVersion':version,'currentSourceCompiled':False,'compiled':False,
    'signed':False,'ipaCreated':False,'testsRun':False,'storeSubmitted':False,
    'nativeAuthenticatedSessionSupported':False,
    'preparation':{'method':'update_unsigned_bundle_version_metadata','changedEntries':[plist_name],'nativeCompilationPerformed':False,'inputFile':original['file'],'inputSha256':original['sha256'],'inputBuildRun':previous['buildRun'],'inputSourceCommit':previous['sourceCommit'],'executableSha256':executable_sha,'executableBytesUnchanged':True},
    'signingWorkflow':'.github/workflows/numina-ios-signing.yml',
    'distributionPolicy':'/downloads/distribution-policy.json',
    'hostedArtifactPaths':{'numina':'https://numinalabs.xyz'+artifact['url']},
    'hostPublicationVerified':False
}
record['nativeDistributionPolicy']='Retain Android 3.0.0 binaries. Reuse the iOS executable with v4 bundle metadata; Apple signing and canonical hosted publication require successful provider operations.'
record_path.write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8',newline='\n')
destination=root/'runtime/vercel-production/public/downloads';destination.mkdir(parents=True,exist_ok=True)
for file in [target,record_path,root/'mobile/signing/distribution-policy.json']:
    shutil.copyfile(file,destination/file.name)
print(json.dumps({'artifact':artifact,'executableBytesUnchanged':True,'version':version,'buildNumber':record['versionCode'],'signed':False,'hostPublicationPerformed':False}))
