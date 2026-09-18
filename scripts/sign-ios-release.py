"""Sign existing iOS contents on macOS with an actual Apple distribution identity.

No tests, enrollment, certificate issuance, store upload, or device installation.
Private signing material is confined to a temporary runner directory/keychain.
"""
from pathlib import Path
import base64, datetime, hashlib, json, os, platform, plistlib, re
import secrets, shutil, subprocess, tempfile, zipfile

ROOT=Path(__file__).resolve().parent.parent
def require(ok, message):
    if not ok: raise RuntimeError(message)
def sha(data): return hashlib.sha256(data).hexdigest()
def current_source_build(settings, record):
    match = re.search(r'^CURRENT_PROJECT_VERSION = (\d+)

def main():
    source_version=json.loads((ROOT/'package.json').read_text())['version']
    source_record=json.loads((ROOT/f'docs/native-package-record-v{source_version.split(".")[0]}.json').read_text())
    build_number=current_source_build((ROOT/'mobile/ios/Configuration/Numina.xcconfig').read_text(), source_record)
    require(platform.system()=='Darwin', 'Apple signing requires the configured macOS runner.')
    policy=json.loads((ROOT/'mobile/signing/distribution-policy.json').read_text())
    names=policy['apple']['secrets']
    require(all(os.environ.get(name) for name in names), 'Required Apple signing secrets are not configured.')
    team=os.environ.get(policy['apple']['teamIdEnvironmentVariable'],'')
    require(re.fullmatch(r'[A-Z0-9]{10}',team), 'A real Apple-issued Team ID must be configured.')
    require(policy['apple']['teamId'] in (None,team), 'Configured Team ID differs from the shared distribution policy.')
    require(all(shutil.which(tool) for tool in ['security','codesign','ditto']), 'Apple signing tools are unavailable on this host.')
    version=json.loads((ROOT/'package.json').read_text())['version']
    record=json.loads((ROOT/f'docs/native-package-record-v{version.split(".")[0]}.json').read_text())
    compiled_app=os.environ.get('NUMINA_IOS_COMPILED_APP')
    artifact=None
    archive=None
    if not compiled_app:
        artifact=record['ios']['binaries'][0]
        archive=ROOT/'docs'/artifact['file']
        require(artifact['signed'] is False and sha(archive.read_bytes())==artifact['sha256'], 'Unsigned input differs from the recorded artifact.')
    child_env={key:value for key,value in os.environ.items() if key not in names and key!='NUMINA_IOS_COMPILED_APP'}
    def run(args, step):
        result=subprocess.run([str(arg) for arg in args],env=child_env,capture_output=True,timeout=180)
        require(result.returncode==0, step+' failed (exit '+str(result.returncode)+').')
        return result.stdout
    output=ROOT/'packages/ios-signed'
    require(not output.exists(), 'Choose a fresh signing checkout; existing outputs are retained.')
    with tempfile.TemporaryDirectory(prefix='numina-ios-',dir=os.environ.get('RUNNER_TEMP')) as temporary:
        work=Path(temporary)
        p12=work/'distribution.p12'; profile=work/'distribution.mobileprovision'
        p12.write_bytes(base64.b64decode(os.environ[names[0]],validate=True));p12.chmod(0o600)
        profile.write_bytes(base64.b64decode(os.environ[names[2]],validate=True));profile.chmod(0o600)
        info=plistlib.loads(run(['security','cms','-D','-i',profile],'Provisioning profile decoding'))
        require(info.get('TeamIdentifier')==[team], 'Provisioning profile belongs to another Apple team.')
        expiration=info.get('ExpirationDate')
        require(isinstance(expiration,datetime.datetime) and expiration.replace(tzinfo=datetime.timezone.utc)>datetime.datetime.now(datetime.timezone.utc), 'Provisioning profile has expired or has no expiry.')
        entitlements=info.get('Entitlements',{})
        prefixes=info.get('ApplicationIdentifierPrefix',[])
        require(len(prefixes)==1 and entitlements.get('application-identifier')==prefixes[0]+'.'+policy['packageIdentity'], 'An explicit provisioning profile for the Numina bundle is required.')
        require(entitlements.get('com.apple.developer.team-identifier')==team, 'Provisioning entitlement team mismatch.')
        require(entitlements.get('get-task-allow') is False and not info.get('ProvisionedDevices') and info.get('ProvisionsAllDevices') is not True, 'This workflow requires an App Store distribution profile.')
        with zipfile.ZipFile(archive) as contents:
            for item in contents.infolist():
                parts=Path(item.filename).parts
                require(parts and not item.filename.startswith(('/', '\\')) and '\\' not in item.filename and '..' not in parts and (item.external_attr>>16)&0o170000!=0o120000, 'Unsafe archive entry.')
        payload=work/'Payload';payload.mkdir()
        if compiled_app:
            source_app=Path(compiled_app)
            require(source_app.is_dir() and (source_app/'Info.plist').is_file(), 'Current-source compiled app is unavailable.')
            shutil.copytree(source_app,payload/'Numina.app')
        else:
            run(['ditto','-x','-k',archive,payload],'Bundle extraction')
        app=payload/'Numina.app'; app_info=plistlib.loads((app/'Info.plist').read_bytes())
        require(app_info.get('CFBundleIdentifier')==policy['packageIdentity'] and app_info.get('CFBundleShortVersionString')==version and str(app_info.get('CFBundleVersion'))==str(build_number), 'Bundle identity or version differs from the release.')
        require(not list(app.rglob('*.framework')) and not list(app.rglob('*.appex')) and not (app/'Frameworks').exists(), 'Nested code requires a separately reviewed signing order.')
        executable=app/app_info['CFBundleExecutable']
        original_executable_sha=sha(executable.read_bytes())
        keychain=work/'signing.keychain-db'; keychain_password=secrets.token_hex(32)
        created=False
        try:
            run(['security','create-keychain','-p',keychain_password,keychain],'Temporary keychain creation');created=True
            run(['security','set-keychain-settings','-lut','900',keychain],'Keychain settings')
            run(['security','unlock-keychain','-p',keychain_password,keychain],'Keychain unlock')
            run(['security','import',p12,'-P',os.environ[names[1]],'-k',keychain,'-T','/usr/bin/codesign'],'Distribution certificate import')
            run(['security','set-key-partition-list','-S','apple-tool:,apple:','-s','-k',keychain_password,keychain],'Signing key access')
            identities=run(['security','find-identity','-v','-p','codesigning',keychain],'Distribution identity lookup').decode()
            profile_certificates={hashlib.sha1(cert).hexdigest().upper() for cert in info.get('DeveloperCertificates',[])}
            candidates=[fingerprint for fingerprint,label in re.findall(r'([A-F0-9]{40}) "([^"\n]+)"',identities) if fingerprint in profile_certificates and ('Apple Distribution:' in label or 'iPhone Distribution:' in label) and '('+team+')' in label]
            require(len(candidates)==1, 'Exactly one valid Apple distribution identity matching the profile is required.')
            identity=candidates[0]
            shutil.copyfile(profile,app/'embedded.mobileprovision')
            entitlements_path=work/'entitlements.plist';entitlements_path.write_bytes(plistlib.dumps(entitlements))
            run(['codesign','--force','--sign',identity,'--keychain',keychain,'--entitlements',entitlements_path,'--generate-entitlement-der',app],'Apple bundle signing')
            run(['codesign','--verify','--deep','--strict',app],'Apple signature verification')
            output.mkdir(parents=True)
            ipa=output/f'numina-{version}-app-store-signed.ipa'
            run(['ditto','-c','-k','--keepParent',payload,ipa],'Signed IPA packaging')
            result={'schema':'numina.ios-signing-result.v1','version':version,'buildNumber':build_number,'bundleIdentifier':policy['packageIdentity'],'teamId':team,'certificateSha1':identity,'profileUuid':info['UUID'],'inputArchiveSha256':artifact['sha256'] if artifact else None,'inputExecutableSha256':original_executable_sha,'signedExecutableSha256':sha(executable.read_bytes()),'file':ipa.name,'sha256':sha(ipa.read_bytes()),'bytes':ipa.stat().st_size,'signed':True,'signatureVerification':True,'distributionMethod':'app-store','directDeviceInstallable':False,'storeSubmitted':False,'deviceInstalled':False,'testsRun':False,'nativeCompilationPerformed':False,'sourceCommit':os.environ.get('GITHUB_SHA'),'runId':os.environ.get('GITHUB_RUN_ID')}
            (output/'signing-result.json').write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps({'file':ipa.name,'sha256':result['sha256'],'signed':True,'storeSubmitted':False}))
        finally:
            if created:run(['security','delete-keychain',keychain],'Temporary keychain cleanup')
if __name__=='__main__':
    try:main()
    except (RuntimeError,ValueError,KeyError,OSError,subprocess.TimeoutExpired,zipfile.BadZipFile) as error:
        raise SystemExit('iOS signing stopped: '+str(error))
, settings, re.MULTILINE)
    require(match is not None, 'Current iOS source build is missing.')
    build = int(match.group(1))
    if os.environ.get('NUMINA_IOS_COMPILED_APP'):
        return build
    ios = record['ios']
    require(ios.get('currentSourceCompiled') is True, 'CURRENT_IOS_SOURCE_NOT_COMPILED: retained binaries must not be signed as current source.')
    require(ios.get('sourceBuildNumber') == build and ios.get('binaryVersionCode') == build,
            'CURRENT_IOS_SIGNING_INPUT_MISMATCH: build a matching current-source bundle first.')
    require(ios.get('signingInputMatchesCurrentSource') is True, 'CURRENT_IOS_SIGNING_INPUT_NOT_VERIFIED')
    return build

def main():
    source_version=json.loads((ROOT/'package.json').read_text())['version']
    source_record=json.loads((ROOT/f'docs/native-package-record-v{source_version.split(".")[0]}.json').read_text())
    build_number=current_source_build((ROOT/'mobile/ios/Configuration/Numina.xcconfig').read_text(), source_record)
    require(platform.system()=='Darwin', 'Apple signing requires the configured macOS runner.')
    policy=json.loads((ROOT/'mobile/signing/distribution-policy.json').read_text())
    names=policy['apple']['secrets']
    require(all(os.environ.get(name) for name in names), 'Required Apple signing secrets are not configured.')
    team=os.environ.get(policy['apple']['teamIdEnvironmentVariable'],'')
    require(re.fullmatch(r'[A-Z0-9]{10}',team), 'A real Apple-issued Team ID must be configured.')
    require(policy['apple']['teamId'] in (None,team), 'Configured Team ID differs from the shared distribution policy.')
    require(all(shutil.which(tool) for tool in ['security','codesign','ditto']), 'Apple signing tools are unavailable on this host.')
    version=json.loads((ROOT/'package.json').read_text())['version']
    record=json.loads((ROOT/f'docs/native-package-record-v{version.split(".")[0]}.json').read_text())
    artifact=record['ios']['binaries'][0]
    archive=ROOT/'docs'/artifact['file']
    require(artifact['signed'] is False and sha(archive.read_bytes())==artifact['sha256'], 'Unsigned input differs from the recorded artifact.')
    child_env={key:value for key,value in os.environ.items() if key not in names}
    def run(args, step):
        result=subprocess.run([str(arg) for arg in args],env=child_env,capture_output=True,timeout=180)
        require(result.returncode==0, step+' failed (exit '+str(result.returncode)+').')
        return result.stdout
    output=ROOT/'packages/ios-signed'
    require(not output.exists(), 'Choose a fresh signing checkout; existing outputs are retained.')
    with tempfile.TemporaryDirectory(prefix='numina-ios-',dir=os.environ.get('RUNNER_TEMP')) as temporary:
        work=Path(temporary)
        p12=work/'distribution.p12'; profile=work/'distribution.mobileprovision'
        p12.write_bytes(base64.b64decode(os.environ[names[0]],validate=True));p12.chmod(0o600)
        profile.write_bytes(base64.b64decode(os.environ[names[2]],validate=True));profile.chmod(0o600)
        info=plistlib.loads(run(['security','cms','-D','-i',profile],'Provisioning profile decoding'))
        require(info.get('TeamIdentifier')==[team], 'Provisioning profile belongs to another Apple team.')
        expiration=info.get('ExpirationDate')
        require(isinstance(expiration,datetime.datetime) and expiration.replace(tzinfo=datetime.timezone.utc)>datetime.datetime.now(datetime.timezone.utc), 'Provisioning profile has expired or has no expiry.')
        entitlements=info.get('Entitlements',{})
        prefixes=info.get('ApplicationIdentifierPrefix',[])
        require(len(prefixes)==1 and entitlements.get('application-identifier')==prefixes[0]+'.'+policy['packageIdentity'], 'An explicit provisioning profile for the Numina bundle is required.')
        require(entitlements.get('com.apple.developer.team-identifier')==team, 'Provisioning entitlement team mismatch.')
        require(entitlements.get('get-task-allow') is False and not info.get('ProvisionedDevices') and info.get('ProvisionsAllDevices') is not True, 'This workflow requires an App Store distribution profile.')
        with zipfile.ZipFile(archive) as contents:
            for item in contents.infolist():
                parts=Path(item.filename).parts
                require(parts and not item.filename.startswith(('/', '\\')) and '\\' not in item.filename and '..' not in parts and (item.external_attr>>16)&0o170000!=0o120000, 'Unsafe archive entry.')
        payload=work/'Payload';payload.mkdir()
        run(['ditto','-x','-k',archive,payload],'Bundle extraction')
        app=payload/'Numina.app'; app_info=plistlib.loads((app/'Info.plist').read_bytes())
        require(app_info.get('CFBundleIdentifier')==policy['packageIdentity'] and app_info.get('CFBundleShortVersionString')==version and str(app_info.get('CFBundleVersion'))==str(build_number), 'Bundle identity or version differs from the release.')
        require(not list(app.rglob('*.framework')) and not list(app.rglob('*.appex')) and not (app/'Frameworks').exists(), 'Nested code requires a separately reviewed signing order.')
        executable=app/app_info['CFBundleExecutable']
        original_executable_sha=sha(executable.read_bytes())
        keychain=work/'signing.keychain-db'; keychain_password=secrets.token_hex(32)
        created=False
        try:
            run(['security','create-keychain','-p',keychain_password,keychain],'Temporary keychain creation');created=True
            run(['security','set-keychain-settings','-lut','900',keychain],'Keychain settings')
            run(['security','unlock-keychain','-p',keychain_password,keychain],'Keychain unlock')
            run(['security','import',p12,'-P',os.environ[names[1]],'-k',keychain,'-T','/usr/bin/codesign'],'Distribution certificate import')
            run(['security','set-key-partition-list','-S','apple-tool:,apple:','-s','-k',keychain_password,keychain],'Signing key access')
            identities=run(['security','find-identity','-v','-p','codesigning',keychain],'Distribution identity lookup').decode()
            profile_certificates={hashlib.sha1(cert).hexdigest().upper() for cert in info.get('DeveloperCertificates',[])}
            candidates=[fingerprint for fingerprint,label in re.findall(r'([A-F0-9]{40}) "([^"\n]+)"',identities) if fingerprint in profile_certificates and ('Apple Distribution:' in label or 'iPhone Distribution:' in label) and '('+team+')' in label]
            require(len(candidates)==1, 'Exactly one valid Apple distribution identity matching the profile is required.')
            identity=candidates[0]
            shutil.copyfile(profile,app/'embedded.mobileprovision')
            entitlements_path=work/'entitlements.plist';entitlements_path.write_bytes(plistlib.dumps(entitlements))
            run(['codesign','--force','--sign',identity,'--keychain',keychain,'--entitlements',entitlements_path,'--generate-entitlement-der',app],'Apple bundle signing')
            run(['codesign','--verify','--deep','--strict',app],'Apple signature verification')
            output.mkdir(parents=True)
            ipa=output/f'numina-{version}-app-store-signed.ipa'
            run(['ditto','-c','-k','--keepParent',payload,ipa],'Signed IPA packaging')
            result={'schema':'numina.ios-signing-result.v1','version':version,'buildNumber':build_number,'bundleIdentifier':policy['packageIdentity'],'teamId':team,'certificateSha1':identity,'profileUuid':info['UUID'],'inputArchiveSha256':artifact['sha256'],'inputExecutableSha256':original_executable_sha,'signedExecutableSha256':sha(executable.read_bytes()),'file':ipa.name,'sha256':sha(ipa.read_bytes()),'bytes':ipa.stat().st_size,'signed':True,'signatureVerification':True,'distributionMethod':'app-store','directDeviceInstallable':False,'storeSubmitted':False,'deviceInstalled':False,'testsRun':False,'nativeCompilationPerformed':False,'sourceCommit':os.environ.get('GITHUB_SHA'),'runId':os.environ.get('GITHUB_RUN_ID')}
            (output/'signing-result.json').write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps({'file':ipa.name,'sha256':result['sha256'],'signed':True,'storeSubmitted':False}))
        finally:
            if created:run(['security','delete-keychain',keychain],'Temporary keychain cleanup')
if __name__=='__main__':
    try:main()
    except (RuntimeError,ValueError,KeyError,OSError,subprocess.TimeoutExpired,zipfile.BadZipFile) as error:
        raise SystemExit('iOS signing stopped: '+str(error))
