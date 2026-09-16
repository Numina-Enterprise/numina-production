import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {EXPECTED_RELEASE,RUNTIME_VERSION,RELEASE_ARTIFACT_TYPE} from '../public/runtime-contract.js';
import {canonical,assessRuntimeEvidence} from '../public/runtime-release-model.js';
import {routeRuntime} from '../src/runtime-http.js';
import {NuminaClient} from '../integrations/numina/src/client.js';

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
  const state={schema:'numina.control-state.v1',release:RUNTIME_VERSION};
  const values={manifest,status,attestation:receipt(RELEASE_ARTIFACT_TYPE,status),control:{state,receipt:receipt('NUMINA_CONTROL_STATE',state)},supply:{valid:true,spdx_sbom_sha256:manifest.spdx_sbom_sha256,slsa_provenance_sha256:manifest.slsa_provenance_sha256}};
  return Object.fromEntries(Object.entries(values).map(([key,data])=>[key,{state:'ok',data}]));
}
const assess=records=>assessRuntimeEvidence(records,{pinnedKey});

test('rc26 evidence binds the manifest, production status and control state to signed payloads',async()=>{
  const result=await assess(fixtures());
  for(const field of ['manifestMatches','releaseDeclarationVerified','runtimeStatusMatches','supplyIdentityMatches','controlStateBound'])assert.equal(result[field],true,field);
});

test('rc26 rejects changed or unsigned manifest fields and mismatched control state',async()=>{
  for(const changes of [{build_id:hash('tampered')},{extra_claim:'not signed'}]){
    const records=fixtures();Object.assign(records.manifest.data,changes);
    assert.equal((await assess(records)).releaseDeclarationVerified,false);
  }
  const records=fixtures();records.control.data.state={...records.control.data.state,head:'unsigned test claim'};
  assert.equal((await assess(records)).controlStateBound,false);
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
    ['/v1/control/state',{state:{release:RUNTIME_VERSION}},RUNTIME_VERSION],
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
