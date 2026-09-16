"""Expose existing public preparation inputs without inventing approvals or evidence."""
import hashlib, json, pathlib, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
record = json.loads((root / 'docs/numina-500t-preparation-tools-record.json').read_text())
package = (root / 'docs/Numina-500T-Preparation-Tools.zip').read_bytes()
assert hashlib.sha256(package).hexdigest() == record['sha256']
with zipfile.ZipFile(root / 'docs/Numina-500T-Preparation-Tools.zip') as archive:
    names = ['requests/NuminaUSD.constructor-review.json', 'unresolved-inputs.json', 'configuration/network-observation.request.json']
    files = {name: archive.read(name) for name in names}
result = {'schema': 'numina.deployment-readiness-inputs.v1', 'package': record,
          'request': json.loads(files[names[0]]), 'requirements': json.loads(files[names[1]]),
          'networkObservationTemplate': json.loads(files[names[2]]),
          'sourceFiles': [{'path': name, 'sha256': hashlib.sha256(data).hexdigest()} for name, data in files.items()]}
(root / 'public/deployment-readiness-inputs.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8', newline='\n')
print('Exported existing public preparation inputs; no evidence or transaction created.')
