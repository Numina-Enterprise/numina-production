import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NUMINA_FINAL_MANIFEST_REFERENCE as reference} from '../public/final-manifest-reference.js';
import {createFinalManifestReference,syncFinalManifestReference} from '../scripts/sync-final-manifest-reference.mjs';
import {canonicalManifest,alignedApplication} from '../public/manifest-surface.js';
import {controlHttp} from '../src/control-http.js';
import runtime from '../runtime/vercel-production/lib/numina-manifest.js';
import built from '../dist/server/index.js';
import {database} from '../scripts/sqlite.mjs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url));
const json=file=>JSON.parse(read(file));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected={applicationVersion:'4.0.0',scope:'SOFTWARE_SOURCE_BINDINGS_ONLY',
 manifest:{route:'/final-manifest.json',access:'authenticated_owner'},
 build:{route:'/final-build.json',access:'authenticated_owner'},
 currentTreasury:{route:'/api/control/v1/treasury',status:'AUTHENTICATED_CURRENT_RECORD_REQUIRED'}};
const inputs=()=>({manifestBytes:read('public/final-manifest.json'),buildBytes:read('public/final-build.json'),applicationVersion:'4.0.0'});

test('owner-evidence reference is an exact safe allowlist derived from unchanged private FINAL bytes',()=>{
 assert.equal(sha(read('public/final-manifest.json')),'b7aac505fde953ad99ff03e4523f21eef17b667d767cbfe30816c91a2d045762');
 assert.equal(sha(read('public/final-build.json')),'2824c267ffa892d4c8013473b4236fd75571700da62f948cbf74975af0a6d2f2');
 assert.deepEqual(createFinalManifestReference(inputs()),expected);
 assert.deepEqual(reference,expected);
 assert.deepEqual(json('config/numina-manifest.v2.json').finalManifestReference,expected);
 assert.deepEqual(json('runtime/vercel-production/final-manifest-reference.json'),expected);
 assert.deepEqual(runtime.NUMINA_MANIFEST.finalManifestReference,expected);
 assert.equal(syncFinalManifestReference().consistent,true);
 assert.deepEqual(read('dist/client/final-manifest-reference.js'),read('public/final-manifest-reference.js'));
 assert.doesNotMatch(JSON.stringify(reference),/(?:[a-f0-9]{64}|acct_|finaddr_|fa_|genesis|sourceId|balance|amount|settled|signature|transaction)/i);
 for(const file of ['public/final-manifest-reference.js','runtime/vercel-production/final-manifest-reference.json']){
  const text=read(file).toString();
  for(const source of json('public/final-manifest.json').universalPair.sources)assert.equal(text.includes(source.sha256),false);
 }
});

test('reference generation rejects changed private pair, raw preimage, version or source claims',()=>{
 for(const mutate of [
  value=>value.applicationVersion='3.0.0',
  value=>value.canonicalSource='OTHER',
  value=>value.productionBinding.scope='FINANCIAL_EXECUTION',
  value=>value.productionBinding.providerExecutionVerified=true,
  value=>value.finalBuild.sha256='0'.repeat(64),
  value=>value.universalPair.sources[0].sha256='0'.repeat(64),
  value=>value.canonicalTreasuryValues.status='SETTLED'
 ]){
  const input=inputs(),manifest=JSON.parse(input.manifestBytes);mutate(manifest);
  assert.throws(()=>createFinalManifestReference({...input,manifestBytes:JSON.stringify(manifest)}));
 }
 const input=inputs();assert.throws(()=>createFinalManifestReference({...input,buildBytes:Buffer.concat([input.buildBytes,Buffer.from('\n')])}),/Exact private FINAL build preimage/);
});

test('source and built production manifests bind safe FINAL discovery while retaining exact current artifact and runtime identities',async t=>{
 const db=database();t.after(()=>db.close());
 const env={DB:db,NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch(req){const file=new URL('../dist/client'+new URL(req.url).pathname,import.meta.url);return existsSync(file)?new Response(readFileSync(file)):new Response('',{status:404});}}};
 const request=()=>new Request('https://numina.test/api/control/v1/manifest');
 const inventory=json('dist/client/downloads/application-release-v4.json');
 for(const response of [await controlHttp(request(),env),await built.fetch(request(),env)]){
  assert.equal(response.status,200);const manifest=canonicalManifest(await response.json());
  assert.deepEqual(manifest.finalManifestReference,expected);
  assert.equal(manifest.version,'1.0.0');assert.equal(manifest.applicationVersion,'4.0.0');
  assert.equal(manifest.schema,'numina.manifest.v2');assert.equal(manifest.mechanics.runtime.version,'1.9.0-rc26');
  assert.equal(manifest.mechanics.artifact.build_id,inventory.build_id);
  assert.equal(manifest.financialVerification,false);assert.equal(manifest.externalExecution,false);
  assert.equal(alignedApplication(manifest,inventory),inventory);
  for(const mutate of [value=>delete value.finalManifestReference,value=>value.finalManifestReference.manifest.access='public',value=>value.finalManifestReference.genesisHash='0'.repeat(64),value=>value.finalManifestReference.currentTreasury.status='SETTLED']){
   const altered=structuredClone(manifest);mutate(altered);assert.throws(()=>canonicalManifest(altered));
  }
  for(const mutate of [value=>delete value.finalManifestReference,value=>value.finalManifestReference.build.route='/other.json',value=>value.finalManifestReference.currentTreasury.balance='1']){
   const altered=structuredClone(inventory);mutate(altered);assert.throws(()=>alignedApplication(manifest,altered));
  }
 }
 for(const alias of ['release.json','application-release-v2.json','application-release-v3.json','application-release-v4.json'])assert.deepEqual(json('dist/client/downloads/'+alias).finalManifestReference,expected);
 assert.equal(inventory.canonicalTreasuryValues.status,'CURRENT_STATE_UNAVAILABLE');
 assert.equal(inventory.canonicalTreasuryValues.aggregate.current,null);
});

test('lineage update preserves policies, triggers, financial sources, treasury values and intentional inherited config fingerprint',()=>{
 const baseline='add9734c09f7c456b224c44c75cf7f3b11103651';
 const original=file=>execFileSync('git',['show',baseline+':'+file]);
 for(const file of ['public/final-build.json','public/final-manifest.json','public/current-environments.json','public/treasury-connection-model.js','public/wallet-execution-policy.js','runtime/nusd/policies/issuer-policy-1500t-18d.json','runtime/nusd/deployment.production.json','runtime/nusd/scripts/deploy-production.mjs','.github/workflows/deploy-nusd-contracts.yml','src/native-treasury.js','src/treasury-submission.js'])assert.deepEqual(read(file),original(file),file);
 const before=JSON.parse(original('config/numina-manifest.v2.json')),after=json('config/numina-manifest.v2.json');
 delete after.finalManifestReference;assert.deepEqual(after,before,'Only additive reference metadata changes in configuration');
});
