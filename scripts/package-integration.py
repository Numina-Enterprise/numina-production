from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import zipfile,json
root=Path(__file__).resolve().parents[1]
source=root/'integrations/numina'
inventory=json.loads((source/'file-manifest.json').read_text())
paths=[item['path'] for item in inventory['files']]+['file-manifest.json']
archive=root/'docs/numina-integration-kit-v2.0.0.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as bundle:
    for path in paths:
        info=zipfile.ZipInfo('numina-integration-kit-v2.0.0/'+path,date_time=(2026,9,13,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        bundle.writestr(info,(source/path).read_bytes())
data=archive.read_bytes();record=json.loads((root/'docs/integration-kit-v2.0.0-record.json').read_text())
record.update(revision='frontier-production-v2.1.0',livemode=True,bytes=len(data),sha256=sha256(data).hexdigest(),sourceFiles=len(paths),packagedAtUtc=datetime.now(timezone.utc).isoformat(),testsRun=False)
record['defaultTools']=json.loads((source/'verification.json').read_text())['defaultTools']
(root/'docs/integration-kit-v2.0.0-record.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'files':len(paths),'bytes':len(data),'sha256':record['sha256']}))
