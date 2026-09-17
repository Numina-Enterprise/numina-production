'use strict';

const crypto=require('crypto');
const {verifyEnvelope,RELEASE_IDENTITY}=require('./numina');

const GITHUB_ISSUER='https://token.actions.githubusercontent.com';
const GITHUB_JWKS='https://token.actions.githubusercontent.com/.well-known/jwks';
const EXPECTED_REPOSITORY='skott34-dot/numina-production';
const EXPECTED_REF='refs/heads/main';
const EXPECTED_AUDIENCE='numina-provider-evidence';
const WORKFLOW_PATH='.github/workflows/verify-provider-observations.yml';
const MAX_AGE_MS=10*60*1000;

function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
function canonical(value){return Buffer.from(JSON.stringify(sorted(value)),'utf8');}
function root(value){return crypto.createHash('sha256').update(canonical(value)).digest('hex');}
function assert(condition,message){if(!condition)throw new Error(message);}
function requiredEnv(name){const value=process.env[name];if(!value)throw new Error(`${name}_REQUIRED`);return value;}
function b64url(value){return Buffer.from(String(value).replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(value).length/4)*4,'='),'base64');}
function sameJson(a,b){return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));}

async function verifyGithubOidc(token){
  const parts=String(token||'').split('.');
  assert(parts.length===3,'GITHUB_OIDC_TOKEN_INVALID');
  let header,payload;
  try{header=JSON.parse(b64url(parts[0]).toString('utf8'));payload=JSON.parse(b64url(parts[1]).toString('utf8'));}catch{throw new Error('GITHUB_OIDC_TOKEN_INVALID');}
  assert(header.alg==='RS256'&&header.kid,'GITHUB_OIDC_HEADER_INVALID');
  const response=await fetch(GITHUB_JWKS,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
  assert(response.ok,'GITHUB_OIDC_JWKS_UNAVAILABLE');
  const jwks=await response.json(),jwk=(jwks.keys||[]).find(key=>key.kid===header.kid&&key.kty==='RSA');
  assert(jwk,'GITHUB_OIDC_SIGNING_KEY_UNKNOWN');
  const publicKey=crypto.createPublicKey({key:jwk,format:'jwk'});
  const valid=crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`,'utf8'),publicKey,b64url(parts[2]));
  assert(valid,'GITHUB_OIDC_SIGNATURE_INVALID');
  const now=Math.floor(Date.now()/1000),aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
  assert(payload.iss===GITHUB_ISSUER,'GITHUB_OIDC_ISSUER_INVALID');
  assert(aud.includes(EXPECTED_AUDIENCE),'GITHUB_OIDC_AUDIENCE_INVALID');
  assert(Number(payload.exp)>now&&Number(payload.iat)<=now+60,'GITHUB_OIDC_TIME_INVALID');
  if(payload.nbf!==undefined)assert(Number(payload.nbf)<=now+60,'GITHUB_OIDC_NOT_YET_VALID');
  assert(payload.repository===EXPECTED_REPOSITORY,'GITHUB_OIDC_REPOSITORY_INVALID');
  assert(payload.ref===EXPECTED_REF,'GITHUB_OIDC_REF_INVALID');
  assert(String(payload.sub||'').startsWith(`repo:${EXPECTED_REPOSITORY}:`),'GITHUB_OIDC_SUBJECT_INVALID');
  assert(String(payload.workflow_ref||'').startsWith(`${EXPECTED_REPOSITORY}/${WORKFLOW_PATH}@${EXPECTED_REF}`),'GITHUB_OIDC_WORKFLOW_INVALID');
  assert(/^[0-9a-f]{40}$/i.test(String(payload.sha||'')),'GITHUB_OIDC_SHA_INVALID');
  assert(/^\d+$/.test(String(payload.run_id||'')),'GITHUB_OIDC_RUN_ID_INVALID');
  assert(/^\d+$/.test(String(payload.run_attempt||'')),'GITHUB_OIDC_RUN_ATTEMPT_INVALID');
  return payload;
}

function validateManifest(manifest,claims){
  assert(manifest&&typeof manifest==='object','EVIDENCE_MANIFEST_MISSING');
  assert(manifest.state==='PROVIDER_OBSERVATION_VERIFIED','EVIDENCE_STATE_INVALID');
  assert(manifest.artifact_type==='NUMINA_PROVIDER_OBSERVATION_SET','EVIDENCE_ARTIFACT_TYPE_INVALID');
  assert(manifest.revoked===false,'EVIDENCE_REVOKED_INVALID');
  assert(/^[0-9a-f]{64}$/i.test(String(manifest.artifact_root||'')),'EVIDENCE_ARTIFACT_ROOT_INVALID');
  assert(root(manifest.artifact_json)===manifest.artifact_root,'EVIDENCE_ARTIFACT_ROOT_MISMATCH');
  assert(Number.isInteger(manifest.created_at)&&manifest.created_at>0,'EVIDENCE_CREATED_AT_INVALID');
  const artifact=manifest.artifact_json||{};
  assert(artifact.schema==='numina.evidence-record.v1'&&artifact.scope==='provider_observation','EVIDENCE_SCHEMA_INVALID');
  for(const key of ['deployment','provider_observation','archive','assertions'])assert(artifact[key]&&typeof artifact[key]==='object',`EVIDENCE_${key.toUpperCase()}_MISSING`);

  const deployment=artifact.deployment;
  assert(verifyEnvelope(deployment.receipt,'NUMINA_DEPLOYMENT_PROVENANCE'),'DEPLOYMENT_SIGNATURE_INVALID');
  assert(sameJson(deployment.receipt.payload,deployment.provenance),'DEPLOYMENT_RECEIPT_MISMATCH');
  const provenance=deployment.provenance;
  assert(provenance.runtime_release===RELEASE_IDENTITY.production_version,'DEPLOYMENT_RELEASE_INVALID');
  assert(provenance.git_commit_sha===claims.sha,'DEPLOYMENT_GITHUB_SHA_MISMATCH');
  assert(provenance.git_commit_ref==='main','DEPLOYMENT_GIT_REF_INVALID');
  assert(provenance.environment==='production','DEPLOYMENT_ENVIRONMENT_INVALID');
  const currentSha=String(process.env.VERCEL_GIT_COMMIT_SHA||'').trim();
  assert(currentSha&&currentSha===provenance.git_commit_sha,'DEPLOYMENT_RUNTIME_SHA_MISMATCH');

  const provider=artifact.provider_observation;
  assert(verifyEnvelope(provider.receipt,'NUMINA_PROVIDER_OBSERVATION_SET'),'PROVIDER_SIGNATURE_INVALID');
  assert(sameJson(provider.receipt.payload,provider.observation_set),'PROVIDER_RECEIPT_MISMATCH');
  const projection=provider.observation_set;
  assert(projection.source==='NUMINA'&&projection.authority==='NUMINA'&&projection.productionSource==='NUMINA'&&projection.surface==='provider-observations','PROVIDER_PROJECTION_INVALID');
  const observation=projection.payload;
  assert(observation&&observation.schema==='numina.provider-observation-set.v1','PROVIDER_SCHEMA_INVALID');
  assert(observation.release===RELEASE_IDENTITY.production_version,'PROVIDER_RELEASE_INVALID');
  assert(observation.status==='HEALTHY'&&observation.all_healthy===true,'PROVIDER_STATUS_INVALID');
  assert(Array.isArray(observation.providers)&&observation.providers.join(',')==='arc,circle','PROVIDER_SET_INVALID');
  assert(observation.credentialed===false,'PROVIDER_CREDENTIALED_INVALID');
  assert(observation.partnership_status==='not_asserted','PROVIDER_PARTNERSHIP_INVALID');
  assert(observation.external_execution_performed===false,'PROVIDER_EXECUTION_BOUNDARY_INVALID');
  const observedMs=Date.parse(observation.observed_at),age=Date.now()-observedMs;
  assert(Number.isFinite(observedMs)&&age<=MAX_AGE_MS&&age>=-60000,'PROVIDER_TIMESTAMP_INVALID');
  assert(Math.floor(observedMs/1000)===manifest.created_at,'EVIDENCE_CREATED_AT_MISMATCH');
  const byProvider=new Map((observation.observations||[]).map(item=>[item.provider,item]));
  const circle=byProvider.get('circle'),arc=byProvider.get('arc');
  assert(circle?.healthy===true&&circle?.http_status===200&&circle?.observed?.message==='pong','CIRCLE_OBSERVATION_INVALID');
  assert(arc?.healthy===true&&arc?.http_status===200&&arc?.observed?.chain_id===5042002&&Number.isSafeInteger(arc?.observed?.latest_block)&&arc.observed.latest_block>=0,'ARC_OBSERVATION_INVALID');
  for(const item of [circle,arc])assert(item.credentialed===false&&item.partnership_status==='not_asserted'&&item.external_execution_performed===false,'PROVIDER_OBSERVATION_BOUNDARY_INVALID');

  const archive=artifact.archive;
  assert(archive.available===true,'ARCHIVE_NOT_AVAILABLE');
  assert(/^sha256:[0-9a-f]{64}$/i.test(String(archive.digest||'')),'ARCHIVE_DIGEST_INVALID');
  assert(archive.git_commit_sha===provenance.git_commit_sha,'ARCHIVE_GIT_SHA_MISMATCH');
  assert(Number(archive.workflow_run_id)===Number(claims.run_id),'ARCHIVE_RUN_ID_MISMATCH');
  assert(Number(archive.run_attempt)===Number(claims.run_attempt),'ARCHIVE_RUN_ATTEMPT_MISMATCH');
  assert(String(archive.workflow_name)==='Verify provider observations','ARCHIVE_WORKFLOW_INVALID');

  const assertions=artifact.assertions;
  assert(assertions.deployment_signature_verified===true&&assertions.provider_observation_signature_verified===true&&assertions.provenance_converged===true&&assertions.matching_github_evidence_available===true,'ASSERTION_VERIFICATION_INVALID');
  assert(assertions.provider_status==='HEALTHY'&&assertions.circle_message==='pong'&&assertions.arc_chain_id===5042002&&assertions.arc_latest_block===arc.observed.latest_block,'ASSERTION_PROVIDER_INVALID');
  assert(assertions.credentialed===false&&assertions.partnership_status==='not_asserted'&&assertions.external_execution_performed===false,'ASSERTION_BOUNDARY_INVALID');
  const expectedRecordId=`provider-observation-${provenance.git_commit_sha.slice(0,12)}-${new Date(observation.observed_at).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`;
  assert(manifest.record_id===expectedRecordId,'EVIDENCE_RECORD_ID_MISMATCH');
  return {provenance,observation,arc,circle,archive};
}

async function persistProviderEvidence({token,manifest}){
  const claims=await verifyGithubOidc(token);
  const verified=validateManifest(manifest,claims);
  const now=Date.now(),jobId=`provider-observation:${manifest.record_id}`;
  const request={
    schema:'numina.durable-evidence.commit.v1',operation:'WRITE_COMMIT_READ_BACK',
    job:{job_id:jobId,tx_hash:verified.provenance.git_commit_sha,handoff_id:manifest.record_id,request_json:{source:'github-actions-oidc',repository:claims.repository,workflow_run_id:Number(claims.run_id),run_attempt:Number(claims.run_attempt)},status:manifest.state,attempts:1,next_attempt_at:now,expires_at:now,result_record_id:manifest.record_id,created_at:now,updated_at:now},
    evidence:{record_id:manifest.record_id,tx_hash:verified.provenance.git_commit_sha,handoff_id:manifest.record_id,state:manifest.state,artifact_type:manifest.artifact_type,artifact_root:manifest.artifact_root,artifact_json:manifest.artifact_json,created_at:manifest.created_at,revoked:false}
  };
  const response=await fetch(requiredEnv('NUMINA_DURABLE_EVIDENCE_URL'),{method:'POST',headers:{authorization:`Bearer ${requiredEnv('NUMINA_DURABLE_EVIDENCE_TOKEN')}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`DURABLE_EVIDENCE_HTTP_${response.status}`);
  const result=await response.json();
  assert(result?.committed===true&&result?.read_back===true,'DURABLE_EVIDENCE_COMMIT_NOT_PROVEN');
  assert(result?.record_id===manifest.record_id,'DURABLE_EVIDENCE_RECORD_ID_MISMATCH');
  assert(result?.artifact_root===manifest.artifact_root,'DURABLE_EVIDENCE_ROOT_MISMATCH');
  assert(root(result?.artifact_json)===manifest.artifact_root,'DURABLE_EVIDENCE_READBACK_MISMATCH');
  assert(sameJson(result.artifact_json,manifest.artifact_json),'DURABLE_EVIDENCE_ARTIFACT_MISMATCH');
  return {committed:true,read_back:true,record_id:manifest.record_id,artifact_root:manifest.artifact_root,git_commit_sha:verified.provenance.git_commit_sha,deployment_id:verified.provenance.deployment_id,provider_status:verified.observation.status,circle_message:verified.circle.observed.message,arc_chain_id:verified.arc.observed.chain_id,arc_latest_block:verified.arc.observed.latest_block,archive_digest:verified.archive.digest,credentialed:false,partnership_status:'not_asserted',external_execution_performed:false};
}

module.exports={persistProviderEvidence,verifyGithubOidc,validateManifest};
