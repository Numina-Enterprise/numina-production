import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {EXPECTED_RELEASE,RUNTIME_VERSION,RELEASE_ARTIFACT_TYPE} from '../public/runtime-contract.js';
import {canonical,assessRuntimeEvidence} from '../public/runtime-release-model.js';
import {routeRuntime} from '../src/runtime-http.js';
import {NuminaClient} from '../integrations/numina/src/client.js';
import manifestModule from '../runtime/vercel-production/lib/numina-manifest.js';
import projectionModule from '../runtime/vercel-production/lib/numina-projection.js';
import {checkRuntime} from '../scripts/check-runtime.mjs';
import {createRuntimeReleaseUI,RUNTIME_ENDPOINTS} from '../public/runtime-release-ui.js';

// Isolated test keys and digests never enter production configuration or evidence.
const keys=generateKeyPairSync('ed25519');
const rawKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(12);
const pinnedKey=rawKey.toString('base64');
const key_id=createHash('sha256').update(rawKey).digest('hex').slice(0,24);
const hash=label=>createHash('sha256').update('test fixture '+label).digest('hex');
function receipt(artifact_type,payload){
  const preimage={artifact_type,key_id,payload};
  return {...preimage,algorithm:'Ed25519',public_key:pinnedKey,signature:sign(null,Buffer.from(canonical(preimage)),keys.privateKey).toString('base64')};
}
function fixtures(){
  const manifest={...EXPECTED_RELEASE};
  const status={...manifest,environment:'production',frozen_core:{valid:true,manifest_root:EXPECTED_RELEASE.frozen_core_manifest_root},conformance:{valid:true}};
  const controlManifest={schema:'numina.control-manifest.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',release:RUNTIME_VERSION};
  const values={manifest,status,attestation:receipt(RELEASE_ARTIFACT_TYPE,status),control:{manifest:controlManifest,receipt:receipt('NUMINA_CONTROL_MANIFEST',controlManifest)},supply:{valid:true,spdx_sbom_sha256:manifest.spdx_sbom_sha256,slsa_provenance_sha256:manifest.slsa_provenance_sha256}};
  return Object.fromEntries(Object.entries(values).map(([key,data])=>[key,{phase:'ok',data}]));
}
const assess=records=>assessRuntimeEvidence(records,{pinnedKey});

test('rc26 evidence binds the manifest, production status and control manifest to signed payloads',async()=>{
  const result=await assess(fixtures());
  for(const field of ['manifestMatches','releaseDeclarationVerified','runtimeStatusMatches','supplyIdentityMatches','controlManifestBound'])assert.equal(result[field],true,field);
});

test('rc26 rejects changed or unsigned manifest fields and mismatched control state',async()=>{
  for(const changes of [{build_id:hash('tampered')},{extra_claim:'not signed'}]){
    const records=fixtures();Object.assign(records.manifest.data,changes);
    assert.equal((await assess(records)).releaseDeclarationVerified,false);
  }
  const records=fixtures();records.control.data.manifest={...records.control.data.manifest,head:'unsigned test claim'};
  assert.equal((await assess(records)).controlManifestBound,false);
});

function singularFixtures(){
  const manifest=structuredClone(manifestModule.NUMINA_MANIFEST),project=projectionModule.project;
  const status=project('status',{release:EXPECTED_RELEASE,external_execution_performed:false});
  const control=project('control-manifest',{schema:'numina.control-manifest.v1',release:RUNTIME_VERSION,external_execution_performed:false});
  const evidence={valid:true,spdx_sbom_sha256:EXPECTED_RELEASE.spdx_sbom_sha256,slsa_provenance_sha256:EXPECTED_RELEASE.slsa_provenance_sha256};
  const values={
    manifest:{manifest,receipt:receipt('NUMINA_MANIFEST',manifest)},
    status:{status,receipt:receipt('NUMINA_PRODUCTION_STATUS',status)},
    attestation:receipt(RELEASE_ARTIFACT_TYPE,project('release-attestation',{release:EXPECTED_RELEASE,manifest})),
    control:{manifest:control,receipt:receipt('NUMINA_CONTROL_MANIFEST',control)},
    supply:project('supply-chain',{evidence,receipt:receipt('NUMINA_SUPPLY_CHAIN_EVIDENCE',evidence)})
  };
  return Object.fromEntries(Object.entries(values).map(([key,data])=>[key,{phase:'ok',data:structuredClone(data)}]));
}

test('current singular runtime wrappers retain exact signed manifest, status and control bindings',async()=>{
  const result=await assess(singularFixtures());
  for(const field of ['manifestMatches','releaseDeclarationVerified','runtimeStatusMatches','supplyIdentityMatches','controlManifestBound'])assert.equal(result[field],true,field);
  assert.deepEqual(result.release,EXPECTED_RELEASE);
  assert.equal(result.status.external_execution_performed,false);
  assert.equal(result.status.frozen_core,undefined); // No historical observation is invented by unwrapping.
});

test('unsigned changes to singular runtime projections never inherit their receipt verification',async()=>{
  const cases=[
    ['releaseDeclarationVerified',records=>records.manifest.data.manifest.extra_claim='unsigned'],
    ['releaseDeclarationVerified',records=>records.manifest.data.manifest.finalManifestReference.manifest.access='public'],
    ['releaseDeclarationVerified',records=>records.attestation.data.payload.payload.manifest.finalManifestReference.currentTreasury.status='SETTLED'],
    ['releaseDeclarationVerified',records=>records.manifest.data.receipt.signature='A'.repeat(88)],
    ['releaseDeclarationVerified',records=>records.attestation.data.payload.payload.manifest.mechanics.treasury.nativeModelAmount='1'],
    ['runtimeStatusMatches',records=>records.status.data.status.payload.external_execution_performed=true],
    ['controlManifestBound',records=>records.control.data.manifest.payload.extra_claim='unsigned'],
    ['supplyIdentityMatches',records=>records.supply.data.payload.evidence.extra_claim='unsigned']
  ];
  for(const [field,mutate]of cases){const records=singularFixtures();mutate(records);assert.equal((await assess(records))[field],false,field);}
});

function runtimeResponses(){
  const records=singularFixtures(),bootstrap={release:RUNTIME_VERSION,evidence_store_durable:true};
  return {...Object.fromEntries(Object.entries(RUNTIME_ENDPOINTS).map(([name,route])=>[route,records[name]?.data??{}])),
    '/readyz':{status:'ready'},'/v1/bootstrap/attestation':{bootstrap,receipt:receipt('NUMINA_BOOTSTRAP_ATTESTATION',bootstrap)}};
}

test('read-only runtime CLI check accepts current wrappers and reports every required gate as a boolean',async()=>{
  const responses=runtimeResponses(),calls=[];
  const report=await checkRuntime({pinnedKey,fetch:async(url,options)=>{
    calls.push(url);assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');assert.deepEqual(options.headers,{Accept:'application/json'});
    return Response.json(responses[new URL(url).pathname]);
  }});
  assert.equal(calls.length,7);assert.equal(report.observed,RUNTIME_VERSION);assert.equal(report.passed,true);
  assert.ok(Object.values(report.checks).every(value=>value===true));assert.deepEqual(report.errors,{});
});

test('runtime CLI check retains readiness and signed durability failures instead of passing a release alone',async()=>{
  for(const change of ['missing-ready','bootstrap-tampered','bootstrap-unavailable']){
    const responses=runtimeResponses();
    if(change==='bootstrap-tampered')responses['/v1/bootstrap/attestation'].bootstrap={release:RUNTIME_VERSION,evidence_store_durable:false};
    const report=await checkRuntime({pinnedKey,fetch:async url=>{
      const route=new URL(url).pathname;
      if(change==='missing-ready'&&route==='/readyz'||change==='bootstrap-unavailable'&&route==='/v1/bootstrap/attestation')return new Response('',{status:503});
      return Response.json(responses[route]);
    }});
    assert.equal(report.checks.signature,true);assert.equal(report.checks.control,true);assert.equal(report.passed,false);
    assert.equal(report.checks[change==='missing-ready'?'ready':'durable'],false);
    assert.ok(Object.values(report.checks).every(value=>typeof value==='boolean'));
  }
});

test('runtime browser view displays current signed wrapper fields without inventing historical status counts',async()=>{
  const responses=runtimeResponses(),nodes=new Map();
  const document={querySelectorAll(selector){
    if(['[data-download]','[data-refresh-release]'].includes(selector))return [];
    if(!nodes.has(selector))nodes.set(selector,{textContent:'',dataset:{}});
    return [nodes.get(selector)];
  }};
  const ui=createRuntimeReleaseUI({document,window:{addEventListener(){},removeEventListener(){}},pinnedKey,
    fetch:async route=>Response.json(responses[route])});
  try{
    await ui.refresh();
    assert.equal(nodes.get('[data-release-version]').textContent,'v'+RUNTIME_VERSION);
    assert.equal(nodes.get('[data-readiness]').textContent,'Runtime responding · rc26 identity matches');
    assert.equal(nodes.get('[data-live-status]').textContent,'Signed declaration verified');
    assert.equal(nodes.get('[data-sbom-hash]').textContent,EXPECTED_RELEASE.spdx_sbom_sha256);
    assert.equal(nodes.get('[data-frozen-files]').textContent,'Not reported');
    assert.equal(nodes.get('[data-conformance]').textContent,'Not reported');
    assert.deepEqual(JSON.parse(nodes.get('[data-manifest-json]').textContent),responses['/v1/release/manifest']);
  }finally{ui.destroy();}
});

test('legacy release, staging, legacy attestation type and unpinned key cannot establish rc26',async()=>{
  for(const change of ['legacy','staging','type','key']){
    const records=fixtures();
    if(change==='legacy')records.attestation.data=receipt(RELEASE_ARTIFACT_TYPE,{...records.status.data,production_version:'1.9.0-rc22'});
    if(change==='staging')records.attestation.data=receipt(RELEASE_ARTIFACT_TYPE,{...records.status.data,environment:'staging'});
    if(change==='type')records.attestation.data=receipt('NUMINA_DEPLOYMENT_ATTESTATION',records.status.data);
    const result=change==='key'?await assessRuntimeEvidence(records):await assess(records);
    assert.equal(result.releaseDeclarationVerified,false,change);
  }
});

test('missing provenance hashes never establish supply-chain evidence',async()=>{
  const records=fixtures();records.manifest.data.spdx_sbom_sha256=null;records.supply.data.spdx_sbom_sha256=null;
  assert.equal((await assess(records)).supplyIdentityMatches,false);
});

test('runtime gateway rejects an older release and missing version without forwarding credentials',async()=>{
  for(const payload of [{production_version:'1.9.0-rc22'},{}]){
    const response=await routeRuntime(new Request('https://numina.test/v1/status',{headers:{Authorization:'Bearer private-test-token',Cookie:'private=test'}}),async(url,options)=>{
      assert.equal(url,'https://numina-production.vercel.app/v1/status');
      assert.deepEqual(options.headers,{Accept:'application/json'});
      return Response.json(payload);
    });
    assert.equal(response.status,502);assert.equal((await response.json()).error,'RUNTIME_RELEASE_MISMATCH');
    assert.equal(response.headers.get('X-Numina-Runtime-Release'),null);
  }
});

test('runtime gateway marks only successful release-bound rc26 responses',async()=>{
  for(const [path,payload,expected] of [
    ['/v1/status',{...EXPECTED_RELEASE},RUNTIME_VERSION],
    ['/v1/control/state',{manifest:{release:RUNTIME_VERSION}},RUNTIME_VERSION],
    ['/v1/release/attestation',{payload:{...EXPECTED_RELEASE}},RUNTIME_VERSION],
    ['/v1/release/supply-chain',{valid:true,spdx_sbom_sha256:EXPECTED_RELEASE.spdx_sbom_sha256,slsa_provenance_sha256:EXPECTED_RELEASE.slsa_provenance_sha256},RUNTIME_VERSION],
    ['/v2/network/status',{status:'unavailable'},null]
  ]){
    const response=await routeRuntime(new Request('https://numina.test'+path),async()=>Response.json(payload));
    assert.equal(response.status,200);assert.equal(response.headers.get('X-Numina-Runtime-Release'),expected);
  }
});

test('runtime gateway rejects artifact identity drift even when the rc26 version matches',async()=>{
  for(const [path,payload] of [
    ['/v1/status',{...EXPECTED_RELEASE,build_id:hash('drifted build')}],
    ['/v1/release/manifest',{...EXPECTED_RELEASE,spdx_sbom_sha256:hash('drifted sbom')}],
    ['/v1/release/attestation',{payload:{...EXPECTED_RELEASE,slsa_provenance_sha256:hash('drifted provenance')}}],
    ['/v1/release/supply-chain',{valid:true,spdx_sbom_sha256:EXPECTED_RELEASE.spdx_sbom_sha256,slsa_provenance_sha256:hash('drifted supply')}]
  ]){
    const response=await routeRuntime(new Request('https://numina.test'+path),async()=>Response.json(payload));
    assert.equal(response.status,502,path);assert.equal((await response.json()).error,'RUNTIME_RELEASE_IDENTITY_MISMATCH',path);
    assert.equal(response.headers.get('X-Numina-Runtime-Release'),null,path);
  }
});

function appManifest(version=RUNTIME_VERSION){
  return {schema:'numina.application-release.v2',schema_version:2,product:'Numina',version:'4.0.0',release:'numina-v4.0.0',artifact_digest_algorithm:'sha256',build_id:hash('application'),artifacts:[{path:'server/index.js',sha256:hash('worker')}],runtime_dependency:{version,release:'core-v1.8+prod-v'+version}};
}
test('packaged integration requires rc26 while retaining server-reported evidence classification',async()=>{
  const client=payload=>new NuminaClient({baseUrl:'https://numina.test',token:'private-test-token',fetch:async(url,options)=>{
    assert.equal(url,'https://numina.test/v4/release/manifest');assert.equal(options.headers.Authorization,undefined);return Response.json(payload);
  }});
  const result=await client(appManifest()).release();
  assert.equal(result.verification,'server_reported_not_independently_verified');
  assert.equal(result.data.runtime_dependency.version,RUNTIME_VERSION);
  await assert.rejects(client(appManifest('1.9.0-rc22')).release(),{code:'RUNTIME_RELEASE_MISMATCH'});
  for(const version of ['2.0.0','3.0.0','4.0.0-rc1'])await assert.rejects(client({...appManifest(),version,release:'numina-v'+version}).release(),{code:'APPLICATION_RELEASE_MISMATCH'});
});

test('integration distribution contains the same release contract as the browser and gateway',()=>{
  assert.equal(readFileSync(new URL('../public/runtime-contract.js',import.meta.url),'utf8'),readFileSync(new URL('../integrations/numina/src/runtime-contract.js',import.meta.url),'utf8'));
});
