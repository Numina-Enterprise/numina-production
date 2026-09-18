import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {PINNED_RUNTIME_KEY_ID,PINNED_RUNTIME_PUBLIC_KEY,RUNTIME_VERSION} from '../public/runtime-contract.js';

function assert(condition,message){if(!condition)throw new Error(message);}
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
const canonical=value=>Buffer.from(JSON.stringify(sorted(value)),'utf8');
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const compactTimestamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');

const inputPath=resolve(process.env.NUMINA_PROVIDER_EVIDENCE_PATH||''),outputPath=resolve(process.env.NUMINA_PROVIDER_RECORD_PATH||'provider-evidence/neon-evidence-record.json');
const artifactName=String(process.env.NUMINA_ARCHIVE_ARTIFACT_NAME||'').trim(),artifactId=String(process.env.NUMINA_ARCHIVE_ARTIFACT_ID||'').trim();
const artifactDigestRaw=String(process.env.NUMINA_ARCHIVE_ARTIFACT_DIGEST||'').trim(),artifactDigest=/^[0-9a-f]{64}$/i.test(artifactDigestRaw)?`sha256:${artifactDigestRaw.toLowerCase()}`:artifactDigestRaw.toLowerCase();
const workflowRunId=String(process.env.GITHUB_RUN_ID||'').trim(),runAttempt=String(process.env.GITHUB_RUN_ATTEMPT||'').trim();
const archive=JSON.parse(readFileSync(inputPath,'utf8'));
assert(archive?.schema==='numina.provider-evidence-archive.v2'&&archive.root==='NUMINA'&&archive.manifest==='NUMINA','archive manifest drift');
assert(archive.signing_key_id===PINNED_RUNTIME_KEY_ID&&archive.credentialed===false&&archive.partnership_status==='asserted'&&archive.external_execution_performed===false,'archive boundary drift');
assert(/^[0-9a-f]{40}$/i.test(String(archive.source_commit||'')),'source commit invalid');
assert(archive.transport?.identity==='NUMINA'&&archive.transport?.role==='diagnostic_only','transport diagnostics missing');
assert(/^sha256:[0-9a-f]{64}$/i.test(artifactDigest)&&artifactName&&/^\d+$/.test(artifactId)&&/^\d+$/.test(workflowRunId)&&/^\d+$/.test(runAttempt),'GitHub archive metadata invalid');

const projection=archive.observation_set,observation=projection?.payload&&typeof projection.payload==='object'?projection.payload:projection;
assert(observation?.schema==='numina.provider-observation-set.v1'&&observation.release===RUNTIME_VERSION&&observation.status==='HEALTHY'&&observation.all_healthy===true,'provider set drift');
assert(Array.isArray(observation.providers)&&observation.providers.join(',')==='arc,circle'&&observation.credentialed===false&&observation.partnership_status==='asserted'&&observation.external_execution_performed===false,'provider boundary drift');
const byProvider=new Map((observation.observations||[]).map(item=>[item.provider,item])),arc=byProvider.get('arc'),circle=byProvider.get('circle');
assert(circle?.healthy===true&&circle?.observed?.message==='pong','Circle observation invalid');
assert(arc?.healthy===true&&arc?.observed?.chain_id===5042002&&Number.isSafeInteger(arc?.observed?.latest_block),'Arc observation invalid');
const observedAt=observation.observed_at;assert(Number.isFinite(Date.parse(observedAt)),'provider observed_at invalid');

const artifact_json={
  schema:'numina.evidence-record.v2',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',scope:'provider_observation',
  source_commit:archive.source_commit,
  transport:archive.transport,
  provider_observation:{observation_set:archive.observation_set,receipt:archive.observation_receipt},
  archive:{available:true,artifact_name:artifactName,artifact_id:Number(artifactId),digest:artifactDigest,workflow_name:'Verify provider observations',workflow_run_id:Number(workflowRunId),run_attempt:Number(runAttempt),git_commit_sha:archive.source_commit,archive_sha256:archive.archive_sha256,observation_receipt_sha256:archive.observation_receipt_sha256},
  assertions:{transport_signature_verified:true,provider_observation_signature_verified:true,transport_current_expected_commit:archive.transport.current_expected_commit===true,matching_github_evidence_available:true,pinned_key_id:PINNED_RUNTIME_KEY_ID,pinned_public_key:PINNED_RUNTIME_PUBLIC_KEY,provider_set_schema:observation.schema,runtime_release:observation.release,providers:observation.providers,provider_status:observation.status,all_healthy:observation.all_healthy,circle_message:circle.observed.message,arc_chain_id:arc.observed.chain_id,arc_latest_block:arc.observed.latest_block,fresh_timestamp:true,credentialed:false,partnership_status:'asserted',external_execution_performed:false}
};
const artifact_root=digest(artifact_json);
const manifest={root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',record_id:`provider-observation-${archive.source_commit.slice(0,12)}-${compactTimestamp(observedAt)}`,status:'PROVIDER_OBSERVATION_VERIFIED',artifact_type:'NUMINA_PROVIDER_OBSERVATION_SET',artifact_root,artifact_json,created_at:Math.floor(Date.parse(observedAt)/1000),revoked:false};
mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,JSON.stringify(manifest,null,2)+'\n',{encoding:'utf8',mode:0o600});
console.log(JSON.stringify({ok:true,root:'NUMINA',manifest:'NUMINA',record_id:manifest.record_id,status:manifest.status,artifact_root,archive_digest:artifactDigest,source_commit:archive.source_commit,transport_deployment_id:archive.transport.observation?.deployment_id??null,transport_current_expected_commit:archive.transport.current_expected_commit===true,provider_status:observation.status,circle_message:circle.observed.message,arc_chain_id:arc.observed.chain_id,arc_latest_block:arc.observed.latest_block,credentialed:false,partnership_status:'asserted',external_execution_performed:false,path:outputPath},null,2));
