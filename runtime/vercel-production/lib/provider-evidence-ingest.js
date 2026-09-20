'use strict';

const crypto=require('crypto');
const {verifyEnvelope,RELEASE_IDENTITY}=require('./numina');
const {callEvidenceRpc}=require('./neon-evidence-rpc');

const GITHUB_ISSUER='https://token.actions.githubusercontent.com',GITHUB_JWKS='https://token.actions.githubusercontent.com/.well-known/jwks';
const EXPECTED_REPOSITORY='skott34-dot/numina-production',EXPECTED_REF='refs/heads/main',EXPECTED_AUDIENCE='numina-provider-evidence';
const WORKFLOW_PATH='.github/workflows/verify-provider-observations.yml',MAX_AGE_MS=10*60*1000;
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
const canonical=value=>Buffer.from(JSON.stringify(sorted(value)),'utf8');
const root=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const b64url=value=>Buffer.from(String(value).replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(value).length/4)*4,'='),'base64');
const sameJson=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));

async function verifyGithubOidc(token){
  const parts=String(token||'').split('.');assert(parts.length===3,'GITHUB_OIDC_TOKEN_INVALID');
  let header,payload;try{header=JSON.parse(b64url(parts[0]).toString('utf8'));payload=JSON.parse(b64url(parts[1]).toString('utf8'));}catch{throw new Error('GITHUB_OIDC_TOKEN_INVALID');}
  assert(header.alg==='RS256'&&header.kid,'GITHUB_OIDC_HEADER_INVALID');
  const response=await fetch(GITHUB_JWKS,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});assert(response.ok,'GITHUB_OIDC_JWKS_UNAVAILABLE');
  const jwks=await response.json(),jwk=(jwks.keys||[]).find(key=>key.kid===header.kid&&key.kty==='RSA');assert(jwk,'GITHUB_OIDC_SIGNING_KEY_UNKNOWN');
  assert(crypto.verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`,'utf8'),crypto.createPublicKey({key:jwk,format:'jwk'}),b64url(parts[2])),'GITHUB_OIDC_SIGNATURE_INVALID');
  const now=Math.floor(Date.now()/1000),aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
  assert(payload.iss===GITHUB_ISSUER&&aud.includes(EXPECTED_AUDIENCE),'GITHUB_OIDC_SCOPE_INVALID');
  assert(Number(payload.exp)>now&&Number(payload.iat)<=now+60,'GITHUB_OIDC_TIME_INVALID');if(payload.nbf!==undefined)assert(Number(payload.nbf)<=now+60,'GITHUB_OIDC_NOT_YET_VALID');
  assert(payload.repository===EXPECTED_REPOSITORY&&payload.ref===EXPECTED_REF,'GITHUB_OIDC_REPOSITORY_INVALID');
  assert(String(payload.workflow_ref||'').startsWith(`${EXPECTED_REPOSITORY}/${WORKFLOW_PATH}@${EXPECTED_REF}`),'GITHUB_OIDC_WORKFLOW_INVALID');
  assert(/^[0-9a-f]{40}$/i.test(String(payload.sha||''))&&/^\d+$/.test(String(payload.run_id||''))&&/^\d+$/.test(String(payload.run_attempt||'')),'GITHUB_OIDC_RUN_INVALID');
  return payload;
}
function validateManifest(manifest,claims){
  assert(manifest&&typeof manifest==='object','EVIDENCE_MANIFEST_MISSING');
  const status=manifest.status??manifest.state;assert(status==='PROVIDER_OBSERVATION_VERIFIED','EVIDENCE_STATUS_INVALID');
  assert(manifest.artifact_type==='NUMINA_PROVIDER_OBSERVATION_SET'&&manifest.revoked===false,'EVIDENCE_HEADER_INVALID');
  assert(/^[0-9a-f]{64}$/i.test(String(manifest.artifact_root||''))&&root(manifest.artifact_json)===manifest.artifact_root,'EVIDENCE_ARTIFACT_ROOT_INVALID');
  const artifact=manifest.artifact_json||{},canonicalManifest=artifact.schema==='numina.evidence-record.v2';
  assert(canonicalManifest||artifact.schema==='numina.evidence-record.v1','EVIDENCE_SCHEMA_INVALID');assert(artifact.scope==='provider_observation','EVIDENCE_SCOPE_INVALID');
  if(canonicalManifest)assert(manifest.root==='NUMINA'&&manifest.manifest==='NUMINA'&&artifact.root==='NUMINA'&&artifact.manifest==='NUMINA','EVIDENCE_NUMINA_INVALID');
  const sourceCommit=artifact.source_commit??artifact.deployment?.provenance?.git_commit_sha;assert(sourceCommit===claims.sha,'EVIDENCE_GITHUB_SHA_MISMATCH');
  const transport=canonicalManifest?artifact.transport:{identity:'NUMINA',role:'legacy_transport_compatibility',observation:artifact.deployment?.provenance,receipt:artifact.deployment?.receipt};
  const transportType=canonicalManifest?'NUMINA_TRANSPORT_OBSERVATION':'NUMINA_DEPLOYMENT_PROVENANCE';
  assert(transport?.observation&&transport?.receipt&&verifyEnvelope(transport.receipt,transportType),'TRANSPORT_SIGNATURE_INVALID');
  assert(sameJson(transport.receipt.payload,transport.observation),'TRANSPORT_RECEIPT_MISMATCH');
  assert(transport.observation.runtime_release===RELEASE_IDENTITY.production_version,'TRANSPORT_RELEASE_INVALID');

  const provider=artifact.provider_observation;assert(provider&&verifyEnvelope(provider.receipt,'NUMINA_PROVIDER_OBSERVATION_SET'),'PROVIDER_SIGNATURE_INVALID');assert(sameJson(provider.receipt.payload,provider.observation_set),'PROVIDER_RECEIPT_MISMATCH');
  const projection=provider.observation_set;assert(projection.source==='NUMINA'&&projection.authority==='NUMINA'&&projection.productionSource==='NUMINA'&&projection.surface==='provider-observations','PROVIDER_PROJECTION_INVALID');
  const observation=projection.payload;assert(observation?.schema==='numina.provider-observation-set.v1'&&observation.release===RELEASE_IDENTITY.production_version&&observation.status==='HEALTHY'&&observation.all_healthy===true,'PROVIDER_STATUS_INVALID');
  assert(Array.isArray(observation.providers)&&observation.providers.join(',')==='arc,circle'&&observation.credentialed===false&&observation.partnership_status==='asserted'&&observation.external_execution_performed===false,'PROVIDER_BOUNDARY_INVALID');
  const observedMs=Date.parse(observation.observed_at),age=Date.now()-observedMs;assert(Number.isFinite(observedMs)&&age<=MAX_AGE_MS&&age>=-60000,'PROVIDER_TIMESTAMP_INVALID');assert(Math.floor(observedMs/1000)===manifest.created_at,'EVIDENCE_CREATED_AT_MISMATCH');
  const byProvider=new Map((observation.observations||[]).map(item=>[item.provider,item])),circle=byProvider.get('circle'),arc=byProvider.get('arc');
  assert(circle?.healthy===true&&circle?.http_status===200&&circle?.observed?.message==='pong','CIRCLE_OBSERVATION_INVALID');
  assert(arc?.healthy===true&&arc?.http_status===200&&arc?.observed?.chain_id===5042002&&Number.isSafeInteger(arc?.observed?.latest_block)&&arc.observed.latest_block>=0,'ARC_OBSERVATION_INVALID');
  for(const item of [circle,arc])assert(item.credentialed===false&&item.external_execution_performed===false,'PROVIDER_OBSERVATION_BOUNDARY_INVALID');

  const archive=artifact.archive;assert(archive?.available===true&&/^sha256:[0-9a-f]{64}$/i.test(String(archive.digest||''))&&archive.git_commit_sha===sourceCommit,'ARCHIVE_BINDING_INVALID');
  assert(Number(archive.workflow_run_id)===Number(claims.run_id)&&Number(archive.run_attempt)===Number(claims.run_attempt)&&archive.workflow_name==='Verify provider observations','ARCHIVE_WORKFLOW_INVALID');
  const assertions=artifact.assertions;assert(assertions?.provider_observation_signature_verified===true&&assertions.matching_github_evidence_available===true&&assertions.provider_status==='HEALTHY'&&assertions.circle_message==='pong'&&assertions.arc_chain_id===5042002,'ASSERTION_VERIFICATION_INVALID');
  assert(assertions.credentialed===false&&assertions.partnership_status==='asserted'&&assertions.external_execution_performed===false,'ASSERTION_BOUNDARY_INVALID');
  const expectedRecordId=`provider-observation-${sourceCommit.slice(0,12)}-${new Date(observation.observed_at).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`;assert(manifest.record_id===expectedRecordId,'EVIDENCE_RECORD_ID_MISMATCH');
  return {status,sourceCommit,transport,observation,arc,circle,archive};
}
async function persistProviderEvidence({token,manifest}){
  const claims=await verifyGithubOidc(token),verified=validateManifest(manifest,claims);
  const result=await callEvidenceRpc({token,rpc:'numina_ingest_provider_evidence',manifest});
  assert(result?.committed===true&&result?.read_back===true&&result?.record_id===manifest.record_id&&result?.artifact_root===manifest.artifact_root,'DURABLE_EVIDENCE_COMMIT_NOT_PROVEN');
  assert((result.source_commit??result.git_commit_sha)===verified.sourceCommit,'DURABLE_EVIDENCE_SOURCE_COMMIT_MISMATCH');
  assert(result.deployment_id===(verified.transport.observation?.deployment_id??null),'DURABLE_EVIDENCE_DEPLOYMENT_MISMATCH');
  assert(result.provider_status===verified.observation.status&&result.circle_message===verified.circle.observed.message&&result.arc_chain_id===verified.arc.observed.chain_id,'DURABLE_EVIDENCE_PROVIDER_STATUS_MISMATCH');
  assert(result.archive_digest===verified.archive.digest,'DURABLE_EVIDENCE_ARCHIVE_MISMATCH');
  assert(result.credentialed===false&&result.partnership_status==='asserted'&&result.external_execution_performed===false,'DURABLE_EVIDENCE_BOUNDARY_MISMATCH');
  return {committed:true,read_back:true,root:'NUMINA',manifest:'NUMINA',record_id:manifest.record_id,status:verified.status,artifact_root:manifest.artifact_root,source_commit:verified.sourceCommit,transport_deployment_id:verified.transport.observation?.deployment_id??null,provider_status:verified.observation.status,circle_message:verified.circle.observed.message,arc_chain_id:verified.arc.observed.chain_id,arc_latest_block:verified.arc.observed.latest_block,archive_digest:verified.archive.digest,credentialed:false,partnership_status:'asserted',external_execution_performed:false};
}
module.exports={persistProviderEvidence,verifyGithubOidc,validateManifest};
