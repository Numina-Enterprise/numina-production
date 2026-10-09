import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {evidenceCanonical,verifyReleaseEnvelope,readSignedTransport,readSignedControl,readTrustedReleaseEvidence} from '../scripts/trusted-release-evidence.mjs';
import {evaluateFrontierReadiness,deploymentProvenance} from '../api/application-release.mjs';
import {EXPECTED_RELEASE,RELEASE_ARTIFACT_TYPE} from '../public/runtime-contract.js';
import {APPLICATION_VERSION,APPLICATION_RELEASE,EXPECTED_APPLICATION_ARTIFACT_BUILD_ID,EXPECTED_APPLICATION_CLIENT_SHA256,EXPECTED_APPLICATION_SERVER_SHA256} from '../src/application-release-contract.js';
import legacyRuntime from '../runtime/vercel-production/lib/numina.js';
import projection from '../runtime/vercel-production/lib/numina-projection.js';
import manifestModule from '../runtime/vercel-production/lib/numina-manifest.js';

// These ephemeral fixture keys never alter production pins or sign real evidence.
const keys=generateKeyPairSync('ed25519'),raw=keys.publicKey.export({format:'der',type:'spki'}).subarray(12);
const pinnedKey=raw.toString('base64'),keyId=createHash('sha256').update(raw).digest('hex').slice(0,24);
const receipt=(artifact_type,payload)=>{const value={artifact_type,key_id:keyId,payload};return {...value,algorithm:'Ed25519',public_key:pinnedKey,signature:sign(null,evidenceCanonical(value),keys.privateKey).toString('base64')};};
const verifyEnvelope=(value,type)=>verifyReleaseEnvelope(value,type,{pinnedKey,keyId});
const observedAt='2026-09-19T18:00:00Z',now=Date.parse(observedAt),expectedGitSha='a'.repeat(40);
const options={verifyEnvelope,now};
function fixture(){
  const deployment=deploymentProvenance({NUMINA_ENV:'production',GITHUB_RUN_ID:'fixture',GITHUB_SHA:expectedGitSha,GITHUB_REF_NAME:'main'});
  const application={schema:'numina.application-release.v2',schema_version:2,singular:true,identity:'NUMINA',manifest:'NUMINA',canonicalSource:'NUMINA',sourceOfTruth:'NUMINA',product:'Numina',version:APPLICATION_VERSION,release:APPLICATION_RELEASE,release_channel:'production',build_id:EXPECTED_APPLICATION_ARTIFACT_BUILD_ID,artifact_digest_algorithm:'sha256',frontier:{version:APPLICATION_VERSION},distribution:{codex_plugin:{version:APPLICATION_VERSION}},runtime_dependency:{singular:true,identity:'NUMINA',version:EXPECTED_RELEASE.production_version,release:EXPECTED_RELEASE.release,manifest:'/v1/release/manifest',signed_declaration:'/v1/release/attestation'},artifacts:[{path:'client/index.html',sha256:EXPECTED_APPLICATION_CLIENT_SHA256},{path:'server/index.js',sha256:EXPECTED_APPLICATION_SERVER_SHA256}]};
  const manifest=structuredClone(manifestModule.NUMINA_MANIFEST),supply={valid:true,release:EXPECTED_RELEASE.release,production_files_root:EXPECTED_RELEASE.production_files_root,spdx_sbom_sha256:EXPECTED_RELEASE.spdx_sbom_sha256,slsa_provenance_sha256:EXPECTED_RELEASE.slsa_provenance_sha256};
  const readiness={schema:'numina.frontier-readiness.v3',observed_at:observedAt,...evaluateFrontierReadiness({application,deployment,manifest:{manifest,receipt:receipt('NUMINA_MANIFEST',manifest)},attestation:receipt(RELEASE_ARTIFACT_TYPE,EXPECTED_RELEASE),supply:{evidence:supply,receipt:receipt('NUMINA_SUPPLY_CHAIN_EVIDENCE',supply)}},{verifyEnvelope:(value,type)=>{try{verifyEnvelope(value,type);return true;}catch{return false;}}})};
  const control=projection.project('control-manifest',{schema:'numina.control-manifest.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',release:EXPECTED_RELEASE.production_version,controls:legacyRuntime.ownerControls(),funds:legacyRuntime.fundsManifest(),execution:legacyRuntime.executionManifest(),partnership:legacyRuntime.partnershipManifest(),external_execution_performed:false,external_funds_moved:false});
  return {expectedGitSha,frontier:{readiness,receipt:receipt('NUMINA_FRONTIER_READINESS',readiness)},transportResponse:{root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',host:'NUMINA',provenance:'NUMINA',deployment:'NUMINA',deployed:true,transport:{identity:'NUMINA',role:'factual_transport_verification_channel',separate_roles:true,singular_identity:true,substrate_observation:{identity:'NUMINA',service:'NUMINA',substrate:'NUMINA',verified:true,observation:deployment}},receipt:receipt('NUMINA_TRANSPORT_OBSERVATION',deployment)},controlResponse:{manifest:control,receipt:receipt('NUMINA_CONTROL_MANIFEST',control)}};
}

test('trusted release binds current v3 readiness to separate signed control authorization and actual transport',()=>{
  const input=fixture(),before=structuredClone(input),result=readTrustedReleaseEvidence(input,options);
  assert.equal(Object.keys(result.readiness.checks).length,7);
  assert.equal(result.readiness.checks.execution_authorization_bounded,undefined);
  assert.equal(result.control.execution.owner_authorization_required,true);
  assert.equal(result.control.execution.pre_signed_payload_required,true);
  assert.equal(result.control.execution.external_execution_performed,false);
  assert.equal(result.fundableTargets.target_amount,'500000000000000');
  assert.equal(result.fundableTargets.external_balance_verified,false);
  for(const role of ['bankUsd','stripeUsdc','nativeNusd']){
    assert.equal(result.readiness.softwareTreasury[role].current,null);
    assert.equal(result.readiness.softwareTreasury[role].available,null);
    assert.equal(result.readiness.softwareTreasury[role].modeledValue,'500000000000000');
  }
  assert.equal(result.readiness.softwareTreasury.aggregate.current,null);
  assert.equal(result.readiness.softwareTreasury.aggregate.modeledValue,'1500000000000000');
  assert.equal(result.transportObservation.git_commit_sha,expectedGitSha);
  assert.equal(result.transportVerified,true);assert.deepEqual(input,before);
});

test('signed unsafe execution or external-funding assertions cannot pass a trusted release',()=>{
  const cases=[
    ['owner approval',x=>x.execution.owner_authorization_required=false],
    ['pre-signed payload',x=>x.execution.pre_signed_payload_required=false],
    ['control owner approval',x=>x.controls.owner_authorization_required=false],
    ['embedded key',x=>x.execution.embedded_private_key_allowed=true],
    ['credentialed submitter',x=>x.execution.credentialed_provider_submitter_available=true],
    ['arbitrary destination',x=>x.controls.arbitrary_provider_url_allowed=true],
    ['wrong provider',x=>x.execution.supported_live_providers=['bank']],
    ['execution occurred',x=>x.execution.external_execution_performed=true],
    ['funds moved',x=>x.external_funds_moved=true],
    ['external balance',x=>x.funds.external_balance_verified=true],
    ['external backing',x=>x.funds.external_backing_asserted=true],
    ['external target balance',x=>x.funds.fundable_targets={...x.funds.fundable_targets,external_balance_verified:true}],
    ['authorization changed',x=>x.funds.authorization_id='different'],
    ['external partnership',x=>x.partnership.external_partnership_verified=true]
  ];
  for(const [label,mutate] of cases){const input=structuredClone(fixture());mutate(input.controlResponse.manifest.payload);input.controlResponse.receipt=receipt('NUMINA_CONTROL_MANIFEST',input.controlResponse.manifest);assert.throws(()=>readTrustedReleaseEvidence(input,options),undefined,label);}
});

test('missing, unsigned, mismatched or wrong-key control evidence fails despite release readiness',()=>{
  for(const mutate of [x=>delete x.controlResponse,x=>delete x.controlResponse.receipt,x=>x.controlResponse.manifest.payload.extra='unsigned',x=>x.controlResponse.receipt.signature='A'.repeat(88),x=>x.controlResponse.receipt.public_key='A'.repeat(44)]){
    const input=structuredClone(fixture());mutate(input);assert.throws(()=>readTrustedReleaseEvidence(input,options));
  }
  assert.throws(()=>readSignedControl(fixture().controlResponse)); // Fixture key is not the production key.
});

test('current transport verification rejects stale commits, nonproduction provenance and unsigned wrapper substitutions',()=>{
  for(const mutate of [x=>x.transport.substrate_observation.verified=false,x=>x.transport.role='diagnostic_only',x=>x.transport.substrate_observation.observation.git_commit_sha='b'.repeat(40),x=>x.receipt.signature='A'.repeat(88)]){
    const response=structuredClone(fixture().transportResponse);mutate(response);assert.throws(()=>readSignedTransport(response,{verifyEnvelope,expectedGitSha}));
  }
  for(const field of ['environment','git_commit_ref','git_commit_sha']){
    const response=structuredClone(fixture().transportResponse);response.transport.substrate_observation.observation[field]=field==='git_commit_sha'?'b'.repeat(40):'staging';response.receipt=receipt('NUMINA_TRANSPORT_OBSERVATION',response.transport.substrate_observation.observation);assert.throws(()=>readSignedTransport(response,{verifyEnvelope,expectedGitSha}));
  }
});

test('readiness requires exact booleans, current schema, freshness and the same signed transport',()=>{
  for(const mutate of [x=>x.checks.numina_deployment='true',x=>delete x.checks.supply_chain_identity,x=>x.schema='numina.frontier-readiness.v2',x=>x.observed_at='2026-09-18T00:00:00Z',x=>x.transport.substrate_observation.verified=false,x=>x.runtime.production_files_root='0'.repeat(64),x=>x.runtime.spdx_sbom_sha256='0'.repeat(64)]){
    const input=structuredClone(fixture());mutate(input.frontier.readiness);input.frontier.receipt=receipt('NUMINA_FRONTIER_READINESS',input.frontier.readiness);assert.throws(()=>readTrustedReleaseEvidence(input,options));
  }
});
