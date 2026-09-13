"""Assemble the real reconstructed verifier; no tests, keys, or treasury mutations."""
from pathlib import Path
from hashlib import sha256
import json,os,shutil,subprocess,sys,time

repo=Path(__file__).resolve().parents[1]
source=repo/'runtime/verifier-rc26'
destination=Path(sys.argv[1]).resolve()
if destination.exists():
    raise SystemExit('Choose a new assembly directory; existing artifacts are retained.')
destination.mkdir(parents=True)
for path in source.rglob('*'):
    if not path.is_file() or '__pycache__' in path.parts or path.suffix=='.pyc':continue
    relative=path.relative_to(source)
    if relative.parts[0]=='artifacts':continue
    target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
(destination/'api').mkdir()
shutil.copyfile(source/'deploy/vercel/entrypoint.py',destination/'api/index.py')
shutil.copyfile(source/'deploy/vercel/vercel.json',destination/'vercel.json')
shutil.copyfile(source/'deploy/vercel/requirements.lock.txt',destination/'requirements.txt')
shutil.copyfile(repo/'runtime/vercel-production/api/node-connection.mjs',destination/'api/node-connection.mjs')
(destination/'.python-version').write_text('3.12\n',encoding='utf-8')
(destination/'package.json').write_text(json.dumps({'name':'numina-production','version':'3.0.0','private':True,'type':'module'})+'\n',encoding='utf-8')
(destination/'.vercel').mkdir()
shutil.copyfile(repo/'runtime/vercel-production/.vercel/project.json',destination/'.vercel/project.json')

sys.path.insert(0,str(destination))
from numina_prod.frozen import verify_frozen_core
frozen=verify_frozen_core()
if not frozen.valid or frozen.checked!=105:raise SystemExit('Frozen core integrity failed')
fixture_path=repo/'fixtures/public-release-evidence.json'
historical=json.loads(fixture_path.read_text())['status']['conformance']
if historical['frozen_manifest_root']!=frozen.manifest_root or historical['core_version']!='1.8.0' or historical['return_code']!=0 or historical['valid'] is not True:
    raise SystemExit('Historical evidence does not bind this frozen core')
artifacts=destination/'artifacts';artifacts.mkdir()
(artifacts/'core-conformance.json').write_text(json.dumps(historical,indent=2,sort_keys=True)+'\n',encoding='utf-8')
origin={'schema':'numina.historical-evidence-origin.v1','source':'fixtures/public-release-evidence.json','sourceSha256':sha256(fixture_path.read_bytes()).hexdigest(),'sourceProductionVersion':historical['production_version'],'capturedAt':historical['captured_at'],'scope':'Previously captured frozen-core conformance. No new test execution or rc26 conformance is asserted.'}
(artifacts/'core-conformance-origin.json').write_text(json.dumps(origin,indent=2)+'\n',encoding='utf-8')

from numina_prod.config import Settings
from numina_prod.release import build_identity,release_descriptor
settings=Settings(environment='production',role='public-verifier',release='core-v1.8+prod-v1.9.0-rc26',data_dir=Path('/tmp/numina'),signing_key_file=None,allow_ephemeral_key=False,require_frozen_core=True,public_url='https://numina-production.vercel.app',database_url=None,real_funds_enabled=False,employer_ip_enabled=False,trusted_hosts=('numina-production.vercel.app',),arc_verification_enabled=False,evidence_require_durable=True)
identity=build_identity(settings)
entries=[]
for path in sorted(destination.rglob('*')):
    if not path.is_file() or any(x in path.parts for x in ('__pycache__','.vercel','artifacts')) or path.name=='MANIFEST.production.sha256':continue
    entries.append(sha256(path.read_bytes()).hexdigest()+' '+path.relative_to(destination).as_posix())
(destination/'MANIFEST.production.sha256').write_text('\n'.join(entries)+'\n',encoding='utf-8')
os.environ['SOURCE_DATE_EPOCH']=str(int(time.time()))
from numina_prod.supply_chain import write_supply_chain_artifacts,verify_supply_chain_artifacts
write_supply_chain_artifacts(build_id=identity['build_id'],production_files_root=identity['production_files_root'])
provenance_path=artifacts/'build-provenance.intoto.json'
provenance=json.loads(provenance_path.read_text())
provenance['predicate']['runDetails']['builder']['id']='urn:numina:builder:local-rc26-assembly:v1'
provenance['predicate']['runDetails']['metadata']['scope']='Local source assembly; unsigned metadata, no hosted SLSA level or new conformance run asserted.'
provenance_path.write_text(json.dumps(provenance,indent=2,sort_keys=True)+'\n',encoding='utf-8')
check=verify_supply_chain_artifacts(build_id=identity['build_id'],production_files_root=identity['production_files_root'])
if not check['valid']:raise SystemExit('Source inventory binding failed')
descriptor=release_descriptor(settings)
(artifacts/'assembled-release.json').write_text(json.dumps(descriptor,indent=2,sort_keys=True)+'\n',encoding='utf-8')
print(json.dumps({'directory':str(destination),'build':descriptor,'frozenFiles':frozen.checked,'sourceFiles':len(entries),'newTestsRun':False},indent=2))
