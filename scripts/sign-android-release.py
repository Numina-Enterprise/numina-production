"""Sign existing release outputs with the owner's persistent signing identities."""
import base64, hashlib, json, os, pathlib, subprocess, tempfile

root=pathlib.Path(__file__).resolve().parent.parent
vault=json.loads(os.environ['NUMINA_RELEASE_SIGNING_VAULT'])
signing=json.loads((root/'mobile/signing/release-identities.json').read_text())
child_env={k:v for k,v in os.environ.items() if k!='NUMINA_RELEASE_SIGNING_VAULT'}
packages=root/'packages'
packages.mkdir(exist_ok=True)
sdk=pathlib.Path(os.environ['ANDROID_HOME'])/'build-tools/35.0.0'
def run(args):
    result=subprocess.run([str(arg) for arg in args],env=child_env,capture_output=True,text=True)
    if result.returncode:raise RuntimeError('Signing command failed: '+str(args[0])+' (exit '+str(result.returncode)+')')
    return result.stdout
with tempfile.TemporaryDirectory(prefix='numina-signing-',dir=os.environ.get('RUNNER_TEMP')) as temporary:
    tmp=pathlib.Path(temporary)
    credentials={}
    for purpose in ['release','upload']:
        entry=vault['android'][purpose]
        key=tmp/(purpose+'.p12');password=tmp/(purpose+'.password')
        # apksigner consumes one line for the store and a second for the key
        # when both password options refer to the same file.
        key.write_bytes(base64.b64decode(entry['pkcs12']));password.write_text(entry['password']+'\n'+entry['password']+'\n')
        key.chmod(0o600);password.chmod(0o600)
        credentials[purpose]=(key,password,entry['alias'])
        certificate=run(['keytool','-exportcert','-keystore',key,'-storetype','PKCS12','-storepass:file',password,'-alias',entry['alias'],'-rfc'])
        actual=hashlib.sha256(base64.b64decode(''.join(line for line in certificate.splitlines() if not line.startswith('-----')))).hexdigest()
        if actual!=signing['android'][purpose]['sha256'].replace(':','').lower():raise RuntimeError('Signing certificate differs from the committed public identity')
    key,password,alias=credentials['upload']
    bundle=packages/'numina-3.0.0-upload-signed.aab'
    run(['jarsigner','-keystore',key,'-storetype','PKCS12','-storepass:file',password,'-keypass:file',password,'-sigalg','SHA256withRSA','-digestalg','SHA-256','-signedjar',bundle,root/'mobile/android/app/build/outputs/bundle/release/app-release.aab',alias])
    run(['jarsigner','-verify',bundle])
    aligned=tmp/'aligned.apk'
    run([sdk/'zipalign','-P','16','-f','4',root/'mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk',aligned])
    key,password,alias=credentials['release']
    apk=packages/'numina-3.0.0-release-signed.apk'
    run([sdk/'apksigner','sign','--ks',key,'--ks-type','PKCS12','--ks-key-alias',alias,'--ks-pass','file:'+str(password),'--key-pass','file:'+str(password),'--out',apk,aligned])
    verified=run([sdk/'apksigner','verify','--verbose','--print-certs',apk])
    expected=signing['android']['release']['sha256'].replace(':','').lower()
    if 'Signer #1 certificate SHA-256 digest: '+expected not in verified:raise RuntimeError('APK signer does not match the committed release identity')
    run([sdk/'zipalign','-c','-P','16','4',apk])
artifacts=[{'file':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [apk,bundle]]
(packages/'signed-build-record.json').write_text(json.dumps({'schema':'numina.android-signed-build.v1','sourceCommit':os.environ.get('GITHUB_SHA'),'runId':os.environ.get('GITHUB_RUN_ID'),'packageIdentity':'xyz.numinalabs.app','identities':signing['android'],'artifacts':artifacts,'signatureVerification':True,'deviceInstalled':False,'storeSubmitted':False,'testsRun':False},indent=2)+'\n')
(packages/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(packages.iterdir()) if p.name!='SHA256SUMS'))
print(json.dumps({'signedArtifacts':artifacts,'signatureVerification':True,'storeSubmitted':False}))
