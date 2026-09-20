'use strict';

const crypto=require('crypto');
const {verifyGithubOidc}=require('./provider-evidence-ingest');

function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
const canonical=value=>Buffer.from(JSON.stringify(sorted(value)),'utf8');
const root=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const requiredEnv=name=>{const value=process.env[name];if(!value)throw new Error(`${name}_REQUIRED`);return value;};
const sameJson=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));

function validateTrustedRelease(manifest,claims){
  assert(manifest&&typeof manifest==='object','TRUSTED_RELEASE_MANIFEST_MISSING');
  assert(manifest.status==='TRUSTED_NUMINA_RELEASE','TRUSTED_RELEASE_STATUS_INVALID');
  assert(manifest.artifact_type==='NUMINA_TRUSTED_PRODUCTION_RELEASE'&&manifest.revoked===false,'TRUSTED_RELEASE_HEADER_INVALID');
  assert(/^[0-9a-f]{64}$/i.test(String(manifest.artifact_root||''))&&root(manifest.artifact_json)===manifest.artifact_root,'TRUSTED_RELEASE_ROOT_INVALID');
  const artifact=manifest.artifact_json||{};
  assert(artifact.schema==='numina.trusted-production-release.v2'&&artifact.scope==='numina_release_gate','TRUSTED_RELEASE_SCHEMA_INVALID');
  assert(artifact.root==='NUMINA'&&artifact.manifest==='NUMINA'&&artifact.identity==='NUMINA'&&artifact.source==='NUMINA'&&artifact.evidence==='NUMINA','TRUSTED_RELEASE_IDENTITY_INVALID');
  assert(artifact.source_commit===claims.sha,'TRUSTED_RELEASE_GITHUB_SHA_MISMATCH');
  assert(artifact.transport?.observation&&artifact.transport?.receipt&&artifact.transport.verified===true,'TRUSTED_RELEASE_TRANSPORT_INVALID');
  assert(artifact.transport.current_expected_commit===true,'TRUSTED_RELEASE_TRANSPORT_NOT_CURRENT');
  assert(artifact.transport.observation.git_commit_sha===claims.sha,'TRUSTED_RELEASE_TRANSPORT_SHA_INVALID');
  assert(artifact.readiness?.readiness?.ready===true&&artifact.readiness?.receipt,'TRUSTED_RELEASE_READINESS_INVALID');
  const provider=artifact.provider_evidence||{};
  assert(/^provider-observation-[0-9a-f]{12}-\d{8}T\d{6}Z$/.test(String(provider.record_id||'')),'TRUSTED_RELEASE_PROVIDER_RECORD_INVALID');
  assert(/^[0-9a-f]{64}$/i.test(String(provider.artifact_root||'')),'TRUSTED_RELEASE_PROVIDER_ROOT_INVALID');
  assert(/^sha256:[0-9a-f]{64}$/i.test(String(provider.archive_digest||'')),'TRUSTED_RELEASE_ARCHIVE_DIGEST_INVALID');
  const assertions=artifact.assertions||{};
  assert(assertions.provider_status==='HEALTHY'&&assertions.circle_message==='pong'&&assertions.arc_chain_id===5042002,'TRUSTED_RELEASE_PROVIDER_STATUS_INVALID');
  assert(assertions.credentialed===false&&assertions.partnership_status==='asserted'&&assertions.external_execution_performed===false,'TRUSTED_RELEASE_PROVIDER_BOUNDARY_INVALID');
  assert(assertions.execution_authorization_bounded===true&&assertions.live_submission_enabled===true&&assertions.live_submission_provider==='arc','TRUSTED_RELEASE_EXECUTION_BOUNDARY_INVALID');
  assert(assertions.owner_authorization_required===true&&assertions.pre_signed_payload_required===true,'TRUSTED_RELEASE_OWNER_AUTH_INVALID');
  assert(assertions.external_balance_verified===false&&assertions.external_backing_asserted===false,'TRUSTED_RELEASE_EXTERNAL_BALANCE_INVALID');
  const observedAt=artifact.readiness.readiness.observed_at;
  const expectedRecordId=`trusted-numina-${claims.sha.slice(0,12)}-${new Date(Date.parse(observedAt)).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`;
  assert(manifest.record_id===expectedRecordId,'TRUSTED_RELEASE_RECORD_ID_INVALID');
  assert(Math.floor(Date.parse(observedAt)/1000)===manifest.created_at,'TRUSTED_RELEASE_CREATED_AT_INVALID');
  return {sourceCommit:artifact.source_commit,status:manifest.status,deploymentId:artifact.transport.observation.deployment_id??null,provider,assertions};
}

async function durableCommit({claims,manifest,verified}){
  const now=Date.now(),jobId=`trusted-production-release:${manifest.record_id}`;
  const request={schema:'numina.durable-evidence.commit.v1',root:'NUMINA',manifest:'NUMINA',storage_compatibility:{legacy_state_column:true,role:'status_encoding_only'},operation:'WRITE_COMMIT_READ_BACK',
    job:{job_id:jobId,tx_hash:verified.sourceCommit,handoff_id:manifest.record_id,request_json:{source:'github-actions-oidc',repository:claims.repository,workflow_run_id:Number(claims.run_id),run_attempt:Number(claims.run_attempt),type:'trusted-production-release'},status:verified.status,attempts:1,next_attempt_at:now,expires_at:now,result_record_id:manifest.record_id,created_at:now,updated_at:now},
    evidence:{record_id:manifest.record_id,tx_hash:verified.sourceCommit,handoff_id:manifest.record_id,state:verified.status,artifact_type:manifest.artifact_type,artifact_root:manifest.artifact_root,artifact_json:manifest.artifact_json,created_at:manifest.created_at,revoked:false}};
  const response=await fetch(requiredEnv('NUMINA_DURABLE_EVIDENCE_URL'),{method:'POST',headers:{authorization:`Bearer ${requiredEnv('NUMINA_DURABLE_EVIDENCE_TOKEN')}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`DURABLE_EVIDENCE_HTTP_${response.status}`);
  const result=await response.json();
  assert(result?.committed===true&&result?.read_back===true&&result?.record_id===manifest.record_id&&result?.artifact_root===manifest.artifact_root,'DURABLE_EVIDENCE_COMMIT_NOT_PROVEN');
  assert(root(result?.artifact_json)===manifest.artifact_root&&sameJson(result.artifact_json,manifest.artifact_json),'DURABLE_EVIDENCE_READBACK_MISMATCH');
}

async function persistTrustedProductionRelease({token,manifest}){
  const claims=await verifyGithubOidc(token),verified=validateTrustedRelease(manifest,claims);
  await durableCommit({claims,manifest,verified});
  return {committed:true,read_back:true,root:'NUMINA',manifest:'NUMINA',record_id:manifest.record_id,status:verified.status,artifact_root:manifest.artifact_root,git_commit_sha:verified.sourceCommit,deployment_id:verified.deploymentId,provider_evidence_record_id:verified.provider.record_id,provider_artifact_root:verified.provider.artifact_root,archive_digest:verified.provider.archive_digest,provider_status:verified.assertions.provider_status,circle_message:verified.assertions.circle_message,arc_chain_id:verified.assertions.arc_chain_id,credentialed:false,partnership_status:'asserted',external_execution_performed:false,execution_authorization_bounded:true,live_submission_enabled:true,live_submission_provider:'arc',owner_authorization_required:true,pre_signed_payload_required:true};
}

module.exports={persistTrustedProductionRelease,validateTrustedRelease};
