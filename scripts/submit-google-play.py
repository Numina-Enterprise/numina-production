"""Submit the current signed NUMINA Android App Bundle through Google Play Android Publisher."""
from pathlib import Path
import json, os, re, hashlib, datetime

ROOT=Path(__file__).resolve().parent.parent
def need(value,message):
    if not value: raise RuntimeError(message)
    return value

version=json.loads((ROOT/'package.json').read_text())['version']
gradle=(ROOT/'mobile/android/app/build.gradle').read_text()
version_code=int(need(re.search(r'\bversionCode\s+(\d+)',gradle),'Android versionCode missing').group(1))
package_name='xyz.numinalabs.app'
bundle=ROOT/'packages'/f'numina-{version}-upload-signed.aab'
need(bundle.is_file(),'Current signed Android App Bundle is missing.')
service_info=json.loads(need(os.environ.get('NUMINA_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'),'Google Play service-account credential is not configured.'))
track=os.environ.get('NUMINA_GOOGLE_PLAY_TRACK','production')
status=os.environ.get('NUMINA_GOOGLE_PLAY_RELEASE_STATUS','completed')
notes=os.environ.get('NUMINA_GOOGLE_PLAY_RELEASE_NOTES',f'Numina {version}')

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

credentials=service_account.Credentials.from_service_account_info(
    service_info, scopes=['https://www.googleapis.com/auth/androidpublisher'])
publisher=build('androidpublisher','v3',credentials=credentials,cache_discovery=False)
edit=publisher.edits().insert(packageName=package_name,body={}).execute()
edit_id=need(edit.get('id'),'Google Play did not return an edit ID.')
uploaded=publisher.edits().bundles().upload(
    packageName=package_name,editId=edit_id,
    media_body=MediaFileUpload(str(bundle),mimetype='application/octet-stream',resumable=False)
).execute()
provider_code=int(need(uploaded.get('versionCode'),'Google Play did not return a versionCode.'))
need(provider_code==version_code,f'Google Play versionCode {provider_code} differs from source {version_code}.')
release={'name':f'Numina {version}','versionCodes':[str(version_code)],'status':status,
         'releaseNotes':[{'language':'en-US','text':notes[:500]}]}
publisher.edits().tracks().update(
    packageName=package_name,editId=edit_id,track=track,body={'track':track,'releases':[release]}
).execute()
publisher.edits().validate(packageName=package_name,editId=edit_id).execute()
committed=publisher.edits().commit(packageName=package_name,editId=edit_id).execute()
receipt={
    'schema':'numina.google-play-submission.v1','provider':'Google Play','packageName':package_name,
    'version':version,'versionCode':version_code,'track':track,'releaseStatus':status,
    'bundle':bundle.name,'bundleSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),
    'editId':committed.get('id',edit_id),'submitted':True,'providerCommitSucceeded':True,
    'observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()
}
out=ROOT/'packages/google-play-submission-receipt.json'
out.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'submitted':True,'provider':'Google Play','versionCode':version_code,'track':track}))
