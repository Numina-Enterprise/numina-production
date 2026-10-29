"""Sign the freshly compiled NUMINA iOS final build with an App Store distribution identity."""
from pathlib import Path
import base64
import datetime
import hashlib
import json
import os
import platform
import plistlib
import re
import secrets
import shutil
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parent.parent

def require(ok,message):
    if not ok:
        raise RuntimeError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def run(args,env,step):
    result=subprocess.run([str(arg) for arg in args],env=env,capture_output=True,timeout=180)
    require(result.returncode==0,step+' failed (exit '+str(result.returncode)+').')
    return result.stdout

def source_build_number():
    settings=(ROOT/'mobile/ios/Configuration/Numina.xcconfig').read_text()
    match=re.search(r'^CURRENT_PROJECT_VERSION = (\d+)$',settings,re.MULTILINE)
    require(match is not None,'Current iOS source build is missing.')
    return int(match.group(1))

def main():
    require(platform.system()=='Darwin','Apple signing requires the configured macOS runner.')
    require(all(shutil.which(tool) for tool in ['security','codesign','ditto']),'Apple signing tools are unavailable on this host.')

    version=json.loads((ROOT/'package.json').read_text())['version']
    build_number=source_build_number()
    policy=json.loads((ROOT/'mobile/signing/distribution-policy.json').read_text())
    names=policy['apple']['secrets']
    require(all(os.environ.get(name) for name in names),'Required Apple signing secrets are not configured.')
    team=os.environ.get(policy['apple']['teamIdEnvironmentVariable'],'')
    require(re.fullmatch(r'[A-Z0-9]{10}',team) is not None,'A real Apple-issued Team ID must be configured.')
    require(policy['apple']['teamId'] in (None,team),'Configured Team ID differs from the shared distribution policy.')

    compiled_app=os.environ.get('NUMINA_IOS_COMPILED_APP','')
    source_app=Path(compiled_app)
    require(compiled_app and source_app.is_dir() and (source_app/'Info.plist').is_file(),'Freshly compiled current-source iOS app is required.')

    child_env={k:v for k,v in os.environ.items() if k not in names and k!='NUMINA_IOS_COMPILED_APP'}
    output=ROOT/'packages/ios-signed'
    require(not output.exists(),'Choose a fresh signing checkout; existing outputs are retained.')

    with tempfile.TemporaryDirectory(prefix='numina-ios-',dir=os.environ.get('RUNNER_TEMP')) as temporary:
        work=Path(temporary)
        p12=work/'distribution.p12'
        profile=work/'distribution.mobileprovision'
        p12.write_bytes(base64.b64decode(os.environ[names[0]],validate=True))
        profile.write_bytes(base64.b64decode(os.environ[names[2]],validate=True))
        p12.chmod(0o600)
        profile.chmod(0o600)

        info=plistlib.loads(run(['security','cms','-D','-i',profile],child_env,'Provisioning profile decoding'))
        require(info.get('TeamIdentifier')==[team],'Provisioning profile belongs to another Apple team.')
        expiration=info.get('ExpirationDate')
        require(isinstance(expiration,datetime.datetime) and expiration.replace(tzinfo=datetime.timezone.utc)>datetime.datetime.now(datetime.timezone.utc),'Provisioning profile has expired or has no expiry.')
        entitlements=info.get('Entitlements',{})
        prefixes=info.get('ApplicationIdentifierPrefix',[])
        require(len(prefixes)==1 and entitlements.get('application-identifier')==prefixes[0]+'.'+policy['packageIdentity'],'An explicit provisioning profile for the NUMINA bundle is required.')
        require(entitlements.get('com.apple.developer.team-identifier')==team,'Provisioning entitlement team mismatch.')
        require(entitlements.get('get-task-allow') is False and not info.get('ProvisionedDevices') and info.get('ProvisionsAllDevices') is not True,'This workflow requires an App Store distribution profile.')

        payload=work/'Payload'
        payload.mkdir()
        app=payload/'Numina.app'
        shutil.copytree(source_app,app)

        app_info=plistlib.loads((app/'Info.plist').read_bytes())
        require(app_info.get('CFBundleIdentifier')==policy['packageIdentity'],'Bundle identifier differs from the distribution policy.')
        require(app_info.get('CFBundleShortVersionString')==version,'Bundle marketing version differs from package version.')
        require(str(app_info.get('CFBundleVersion'))==str(build_number),'Bundle build number differs from current source.')
        require(not list(app.rglob('*.framework')) and not list(app.rglob('*.appex')) and not (app/'Frameworks').exists(),'Nested code requires a separately reviewed signing order.')

        executable=app/app_info['CFBundleExecutable']
        unsigned_executable_sha=sha(executable.read_bytes())
        keychain=work/'signing.keychain-db'
        keychain_password=secrets.token_hex(32)
        created=False
        try:
            run(['security','create-keychain','-p',keychain_password,keychain],child_env,'Temporary keychain creation')
            created=True
            run(['security','set-keychain-settings','-lut','900',keychain],child_env,'Keychain settings')
            run(['security','unlock-keychain','-p',keychain_password,keychain],child_env,'Keychain unlock')
            run(['security','import',p12,'-P',os.environ[names[1]],'-k',keychain,'-T','/usr/bin/codesign'],child_env,'Distribution certificate import')
            run(['security','set-key-partition-list','-S','apple-tool:,apple:','-s','-k',keychain_password,keychain],child_env,'Signing key access')
            identities=run(['security','find-identity','-v','-p','codesigning',keychain],child_env,'Distribution identity lookup').decode()
            profile_certificates={hashlib.sha1(cert).hexdigest().upper() for cert in info.get('DeveloperCertificates',[])}
            candidates=[
                fingerprint
                for fingerprint,label in re.findall(r'([A-F0-9]{40}) "([^"\n]+)"',identities)
                if fingerprint in profile_certificates
                and ('Apple Distribution:' in label or 'iPhone Distribution:' in label)
                and '('+team+')' in label
            ]
            require(len(candidates)==1,'Exactly one valid Apple distribution identity matching the profile is required.')
            identity=candidates[0]

            shutil.copyfile(profile,app/'embedded.mobileprovision')
            entitlements_path=work/'entitlements.plist'
            entitlements_path.write_bytes(plistlib.dumps(entitlements))
            run(['codesign','--force','--sign',identity,'--keychain',keychain,'--entitlements',entitlements_path,'--generate-entitlement-der',app],child_env,'Apple bundle signing')
            run(['codesign','--verify','--deep','--strict',app],child_env,'Apple signature verification')

            output.mkdir(parents=True)
            ipa=output/f'numina-{version}-build{build_number}-app-store-signed.ipa'
            run(['ditto','-c','-k','--keepParent',payload,ipa],child_env,'Signed IPA packaging')
            result={
                'schema':'numina.ios-signing-result.v2',
                'version':version,
                'buildNumber':build_number,
                'bundleIdentifier':policy['packageIdentity'],
                'teamId':team,
                'certificateSha1':identity,
                'profileUuid':info['UUID'],
                'unsignedExecutableSha256':unsigned_executable_sha,
                'signedExecutableSha256':sha(executable.read_bytes()),
                'file':ipa.name,
                'sha256':sha(ipa.read_bytes()),
                'bytes':ipa.stat().st_size,
                'signed':True,
                'signatureVerification':True,
                'distributionMethod':'app-store',
                'directDeviceInstallable':False,
                'storeSubmitted':False,
                'storeSubmissionReceipt':None,
                'nativeCompilationPerformed':True,
                'sourceCommit':os.environ.get('GITHUB_SHA'),
                'runId':os.environ.get('GITHUB_RUN_ID'),
                'finalBuildRecord':'release-evidence/numina-final-build-2026-09-18.json'
            }
            (output/'signing-result.json').write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps({'file':ipa.name,'sha256':result['sha256'],'signed':True,'storeSubmitted':False}))
        finally:
            if created:
                run(['security','delete-keychain',keychain],child_env,'Temporary keychain cleanup')

if __name__=='__main__':
    try:
        main()
    except (RuntimeError,ValueError,KeyError,OSError,subprocess.TimeoutExpired) as error:
        raise SystemExit('iOS signing stopped: '+str(error))
