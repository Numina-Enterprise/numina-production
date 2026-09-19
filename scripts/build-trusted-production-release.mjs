import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {EXPECTED_RELEASE,PINNED_RUNTIME_KEY_ID,PINNED_RUNTIME_PUBLIC_KEY,RUNTIME_ORIGIN} from '../public/runtime-contract.js';
import {readTrustedReleaseEvidence} from './trusted-release-evidence.mjs';

const PROVIDER_RECORD_PATH=process.env.NUMINA_PROVIDER_RECORD_PATH||'',OUTPUT_PATH=process.env.NUMINA_TRUSTED_RELEASE_PATH||'',EXPECTED_GIT_SHA=(process.env.NUMINA_EXPECTED_GIT_SHA||'').trim();
const SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex'),MAX_JSON_BYTES=262144;
function assert(condition,message){if(!condition)throw new Error(message);}
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const output={};for(const key of Object.keys(value).sort())output[key]=sorted(value[key]);return output;}return value;}
const canonical=value=>Buffer.from(JSON.stringify(sorted(value)),'utf8');
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const sameJson=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
function verifyEnvelope(envelope,expectedType){assert(envelope&&typeof envelope==='object','signed envelope missing');assert(envelope.artifact_type===expectedType,`unexpected artifact type: ${envelope.artifact_type}`);assert(envelope.algorithm==='Ed25519'&&envelope.key_id===PINNED_RUNTIME_KEY_ID&&envelope.public_key===PINNED_RUNTIME_PUBLIC_KEY,'runtime signing identity drift');const raw=Buffer.from(PINNED_RUNTIME_PUBLIC_KEY,'base64');assert(raw.length===32&&createHash('sha256').update(raw).digest('hex').slice(0,24)===PINNED_RUNTIME_KEY_ID,'pinned key invalid');const publicKey=createPublicKey({key:Buffer.concat([SPKI_PREFIX,raw]),format:'der',type:'spki'});assert(verifySignature(null,canonical({artifact_type:envelope.artifact_type,key_id:envelope.key_id,payload:envelope.payload}),publicKey,Buffer.from(envelope.signature||'','base64')),'signature verification failed');return envelope.payload;}
async function fetchJson(pathname){const response=await fetch(RUNTIME_ORIGIN+pathname,{headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});assert(response.status===200,`${pathname} returned ${response.status}`);assert((response.headers.get('content-type')||'').toLowerCase().includes('application/json'),`${pathname} content type drift`);const text=await response.text();assert(Buffer.byteLength(text,'utf8')<=MAX_JSON_BYTES,`${pathname} response too large`);return JSON.parse(text);}

assert(PROVIDER_RECORD_PATH,'NUMINA_PROVIDER_RECORD_PATH required');assert(OUTPUT_PATH,'NUMINA_TRUSTED_RELEASE_PATH required');assert(/^[0-9a-f]{40}$/i.test(EXPECTED_GIT_SHA),'NUMINA_EXPECTED_GIT_SHA must be a full Git SHA');
const providerRecord=JSON.parse(fs.readFileSync(PROVIDER_RECORD_PATH,'utf8'));
assert(providerRecord.root==='NUMINA'&&providerRecord.manifest==='NUMINA'&&providerRecord.status==='PROVIDER_OBSERVATION_VERIFIED','provider evidence manifest invalid');
assert(providerRecord.artifact_type==='NUMINA_PROVIDER_OBSERVATION_SET'&&providerRecord.revoked===false&&/^[0-9a-f]{64}$/i.test(String(providerRecord.artifact_root||'')),'provider evidence header invalid');
assert(digest(providerRecord.artifact_json)===providerRecord.artifact_root,'provider artifact root mismatch');
const providerArtifact=providerRecord.artifact_json||{};
assert(providerArtifact.source_commit===EXPECTED_GIT_SHA,'provider evidence source commit mismatch');
assert(providerArtifact.root==='NUMINA'&&providerArtifact.manifest==='NUMINA'&&providerArtifact.transport?.role==='diagnostic_only','provider evidence NUMINA drift');
assert(providerArtifact.assertions?.provider_status==='HEALTHY'&&providerArtifact.assertions?.circle_message==='pong'&&providerArtifact.assertions?.arc_chain_id===5042002,'provider evidence unhealthy');
assert(providerArtifact.assertions?.credentialed===false&&providerArtifact.assertions?.partnership_status==='asserted'&&providerArtifact.assertions?.external_execution_performed===false,'provider evidence boundary drift');
assert(/^sha256:[0-9a-f]{64}$/i.test(String(providerArtifact.archive?.digest||'')),'provider archive digest invalid');

const [frontier,transportResponse,controlResponse]=await Promise.all([fetchJson('/v1/frontier/readiness'),fetchJson('/v1/deployment/provenance'),fetchJson('/v1/control/state')]);
// Release readiness and bounded execution are separately signed statements.
// Neither authorization nor a healthy provider observation is a submission.
const {readiness,transportObservation,transportVerified,fundableTargets}=readTrustedReleaseEvidence({frontier,transportResponse,controlResponse,expectedGitSha:EXPECTED_GIT_SHA},{verifyEnvelope});
const checks=readiness.checks;
const transportCurrent=String(transportObservation.git_commit_sha||'').toLowerCase()===EXPECTED_GIT_SHA.toLowerCase();

const observedMs=Date.parse(readiness.observed_at);assert(Number.isFinite(observedMs),'readiness observed_at invalid');
const observedTag=new Date(observedMs).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const artifactJson={
  schema:'numina.trusted-production-release.v2',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',deployment:'NUMINA',deployed:true,
  scope:'numina_release_gate',source_commit:EXPECTED_GIT_SHA,
  transport:{identity:'NUMINA',role:'diagnostic_only',verified:transportVerified,current_expected_commit:transportCurrent,observation:transportObservation,receipt:transportResponse.receipt},
  provider_evidence:{record_id:providerRecord.record_id,artifact_root:providerRecord.artifact_root,archive_digest:providerArtifact.archive.digest},
  readiness:{readiness:frontier.readiness,receipt:frontier.receipt},
  control:{manifest:controlResponse.manifest,receipt:controlResponse.receipt,scope:'signed_capability_and_authorization_declaration_not_external_execution'},
  fundable_targets:fundableTargets,
  assertions:{numina_deployment:true,readiness_signature_verified:true,transport_signature_verified:true,all_readiness_checks_passed:true,provider_evidence_workflow_verified:true,provider_status:'HEALTHY',circle_message:'pong',arc_chain_id:5042002,credentialed:false,partnership_status:'asserted',external_execution_performed:false,execution_authorization_bounded:true,live_submission_enabled:true,live_submission_provider:'arc',owner_authorization_required:true,pre_signed_payload_required:true,fundable_target:'500T',fundable_target_amount:'500000000000000',fundable_target_scope:'numina_native',external_balance_verified:false,external_backing_asserted:false}
};
const manifest={root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',record_id:`trusted-numina-${EXPECTED_GIT_SHA.slice(0,12)}-${observedTag}`,status:'TRUSTED_NUMINA_RELEASE',artifact_type:'NUMINA_TRUSTED_PRODUCTION_RELEASE',artifact_root:digest(artifactJson),artifact_json:artifactJson,created_at:Math.floor(observedMs/1000),revoked:false};
fs.mkdirSync(path.dirname(OUTPUT_PATH),{recursive:true});fs.writeFileSync(OUTPUT_PATH,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({ok:true,root:'NUMINA',manifest:'NUMINA',record_id:manifest.record_id,status:manifest.status,artifact_root:manifest.artifact_root,source_commit:EXPECTED_GIT_SHA,transport_deployment_id:transportObservation.deployment_id??null,transport_current_expected_commit:transportCurrent,provider_evidence_record_id:providerRecord.record_id,provider_artifact_root:providerRecord.artifact_root,archive_digest:providerArtifact.archive.digest,readiness_observed_at:readiness.observed_at,readiness_checks:Object.keys(checks),credentialed:false,partnership_status:'asserted',external_execution_performed:false,execution_authorization_bounded:true,live_submission_enabled:true,live_submission_provider:'arc',owner_authorization_required:true,pre_signed_payload_required:true,fundable_target:'500T',fundable_target_scope:'numina_native',external_balance_verified:false,external_backing_asserted:false,path:path.resolve(OUTPUT_PATH)},null,2));
