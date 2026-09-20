"""Validate and upload the signed NUMINA IPA to App Store Connect using an API key."""
from pathlib import Path
import base64, datetime, hashlib, json, os, platform, subprocess, tempfile

ROOT=Path(__file__).resolve().parent.parent
def need(value,message):
    if not value: raise RuntimeError(message)
    return value
need(platform.system()=='Darwin','App Store upload requires macOS/Xcode.')
version=json.loads((ROOT/'package.json').read_text())['version']
ipas=sorted((ROOT/'packages/ios-signed').glob(f'numina-{version}-build*-app-store-signed.ipa'))
need(len(ipas)==1,'Exactly one current signed IPA is required.')
ipa=ipas[0]
key_id=need(os.environ.get('NUMINA_APP_STORE_CONNECT_KEY_ID'),'App Store Connect key ID is not configured.')
issuer=need(os.environ.get('NUMINA_APP_STORE_CONNECT_ISSUER_ID'),'App Store Connect issuer ID is not configured.')
p8_b64=need(os.environ.get('NUMINA_APP_STORE_CONNECT_KEY_P8_BASE64'),'App Store Connect API key is not configured.')

with tempfile.TemporaryDirectory(prefix='numina-asc-') as temp:
    home=Path(temp)
    key_dir=home/'.appstoreconnect/private_keys'
    key_dir.mkdir(parents=True)
    key_file=key_dir/f'AuthKey_{key_id}.p8'
    key_file.write_bytes(base64.b64decode(p8_b64,validate=True))
    key_file.chmod(0o600)
    env={k:v for k,v in os.environ.items() if k!='NUMINA_APP_STORE_CONNECT_KEY_P8_BASE64'}
    env['HOME']=str(home)
    def run(mode):
        result=subprocess.run(
            ['xcrun','altool',mode,'-f',str(ipa),'-t','ios','--apiKey',key_id,'--apiIssuer',issuer],
            env=env,capture_output=True,text=True,timeout=900)
        if result.returncode:
            raise RuntimeError('App Store Connect '+mode+' failed (exit '+str(result.returncode)+').')
    run('--validate-app')
    run('--upload-app')

receipt={
    'schema':'numina.app-store-upload.v1','provider':'App Store Connect','version':version,
    'ipa':ipa.name,'ipaSha256':hashlib.sha256(ipa.read_bytes()).hexdigest(),
    'uploadAccepted':True,'storeSubmitted':True,'reviewSubmitted':False,'publicationConfirmed':False,
    'observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()
}
out=ROOT/'packages/ios-signed/app-store-upload-receipt.json'
out.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'submitted':True,'provider':'App Store Connect','file':ipa.name}))
