import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {PINNED_RUNTIME_KEY_ID,PINNED_RUNTIME_PUBLIC_KEY,RUNTIME_VERSION} from '../public/runtime-contract.js';

function assert(condition,message){if(!condition)throw new Error(message);}
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
function canonical(value){return Buffer.from(JSON.stringify(sorted(value)),'utf8');}
function digest(value){return createHash('sha256').update(canonical(value)).digest('hex');}
function compactTimestamp(value){return new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}

const inputPath=resolve(process.env.NUMINA_PROVIDER_EVIDENCE_PATH||'');
const outputPath=resolve(process.env.NUMINA_PROVIDER_RECORD_PATH||'provider-evidence/neon-evidence-record.json');
const artifactName=String(process.env.NUMINA_ARCHIVE_ARTIFACT_NAME||'').trim();
const artifactId=String(process.env.NUMINA_ARCHIVE_ARTIFACT_ID||'').trim();
const artifactDigestRaw=String(process.env.NUMINA_ARCHIVE_ARTIFACT_DIGEST||'').trim();
const artifactDigest=/^[0-9a-f]{64}$/i.test(artifactDigestRaw)?`sha256:${artifactDigestRaw.toLowerCase()}`:artifactDigestRaw.toLowerCase();
const workflowRunId=String(process.env.GITHUB_RUN_ID||'').trim();
const runAttempt=String(process.env.GITHUB_RUN_ATTEMPT||'').trim();
const archive=JSON.parse(readFileSync(inputPath,'utf8'));

assert(archive?.schema==='numina.provider-evidence-archive.v1','archive schema drift');
assert(archive?.signing_key_id===PINNED_RUNTIME_KEY_ID,'archive signing key drift');
assert(archive?.credentialed===false,'archive unexpectedly credentialed');
assert(archive?.partnership_status==='not_asserted','archive asserts partnership');
assert(archive?.external_execution_performed===false,'archive reports external execution');
assert(/^sha256:[0-9a-f]{64}$/i.test(artifactDigest),'GitHub artifact digest missing or invalid');
assert(artifactName,'GitHub artifact name missing');
assert(/^\d+$/.test(artifactId),'GitHub artifact id missing or invalid');
assert(/^\d+$/.test(workflowRunId),'GitHub workflow run id missing or invalid');
assert(/^\d+$/.test(runAttempt),'GitHub run attempt missing or invalid');

const observationProjection=archive.observation_set;
const observation=observationProjection?.payload&&typeof observationProjection.payload==='object'?observationProjection.payload:observationProjection;
assert(observation?.schema==='numina.provider-observation-set.v1','provider set schema drift');
assert(observation?.release===RUNTIME_VERSION,'provider set release drift');
assert(observation?.status==='HEALTHY'&&observation?.all_healthy===true,'provider set is not healthy');
assert(Array.isArray(observation?.providers)&&observation.providers.join(',')==='arc,circle','provider identities drift');
assert(observation?.credentialed===false,'provider set unexpectedly credentialed');
assert(observation?.partnership_status==='not_asserted','provider set asserts partnership');
assert(observation?.external_execution_performed===false,'provider set reports external execution');
const byProvider=new Map((observation.observations||[]).map(item=>[item.provider,item]));
const arc=byProvider.get('arc');
const circle=byProvider.get('circle');
assert(circle?.healthy===true&&circle?.observed?.message==='pong','Circle observation invalid');
assert(arc?.healthy===true&&arc?.observed?.chain_id===5042002&&Number.isSafeInteger(arc?.observed?.latest_block),'Arc observation invalid');
assert(archive?.deployment?.git_commit_sha,'deployment git sha missing');
assert(archive?.deployment?.deployment_id,'deployment id missing');
const observedAt=observation.observed_at;
assert(Number.isFinite(Date.parse(observedAt)),'provider observed_at invalid');

const artifact_json={
  schema:'numina.evidence-record.v1',
  scope:'provider_observation',
  deployment:{provenance:archive.deployment,receipt:archive.deployment_receipt},
  provider_observation:{observation_set:archive.observation_set,receipt:archive.observation_receipt},
  archive:{
    available:true,
    artifact_name:artifactName,
    artifact_id:Number(artifactId),
    digest:artifactDigest,
    workflow_name:'Verify provider observations',
    workflow_run_id:Number(workflowRunId),
    run_attempt:Number(runAttempt),
    git_commit_sha:archive.deployment.git_commit_sha,
    archive_sha256:archive.archive_sha256,
    observation_receipt_sha256:archive.observation_receipt_sha256
  },
  assertions:{
    deployment_signature_verified:true,
    provider_observation_signature_verified:true,
    provenance_converged:true,
    matching_github_evidence_available:true,
    pinned_key_id:PINNED_RUNTIME_KEY_ID,
    pinned_public_key:PINNED_RUNTIME_PUBLIC_KEY,
    provider_set_schema:observation.schema,
    runtime_release:observation.release,
    providers:observation.providers,
    provider_status:observation.status,
    all_healthy:observation.all_healthy,
    circle_message:circle.observed.message,
    arc_chain_id:arc.observed.chain_id,
    arc_latest_block:arc.observed.latest_block,
    fresh_timestamp:true,
    credentialed:false,
    partnership_status:'not_asserted',
    external_execution_performed:false
  }
};
const artifact_root=digest(artifact_json);
const manifest={
  record_id:`provider-observation-${archive.deployment.git_commit_sha.slice(0,12)}-${compactTimestamp(observedAt)}`,
  state:'PROVIDER_OBSERVATION_VERIFIED',
  artifact_type:'NUMINA_PROVIDER_OBSERVATION_SET',
  artifact_root,
  artifact_json,
  created_at:Math.floor(Date.parse(observedAt)/1000),
  revoked:false
};
mkdirSync(dirname(outputPath),{recursive:true});
writeFileSync(outputPath,JSON.stringify(manifest,null,2)+'\n',{encoding:'utf8',mode:0o600});
console.log(JSON.stringify({ok:true,record_id:manifest.record_id,artifact_root,archive_digest:artifactDigest,git_commit_sha:archive.deployment.git_commit_sha,deployment_id:archive.deployment.deployment_id,provider_status:observation.status,circle_message:circle.observed.message,arc_chain_id:arc.observed.chain_id,arc_latest_block:arc.observed.latest_block,credentialed:false,partnership_status:'not_asserted',external_execution_performed:false,path:outputPath},null,2));
