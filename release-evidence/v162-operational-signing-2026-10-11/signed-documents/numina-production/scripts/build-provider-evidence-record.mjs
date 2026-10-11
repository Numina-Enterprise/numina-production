import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {RUNTIME_VERSION} from '../public/runtime-contract.js';

function assert(condition,message){if(!condition)throw new Error(message);}
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
const canonical=value=>Buffer.from(JSON.stringify(sorted(value)),'utf8');
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const compactTimestamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');

const inputPath=resolve(process.env.NUMINA_PROVIDER_EVIDENCE_PATH||''),outputPath=resolve(process.env.NUMINA_PROVIDER_RECORD_PATH||'provider-evidence/github-evidence-record.json');
const inputBytes=readFileSync(inputPath),evidenceFileDigest='sha256:'+createHash('sha256').update(inputBytes).digest('hex');
const artifactName=String(process.env.NUMINA_ARCHIVE_ARTIFACT_NAME||'').trim(),artifactId=String(process.env.NUMINA_ARCHIVE_ARTIFACT_ID||'').trim();
const artifactDigestRaw=String(process.env.NUMINA_ARCHIVE_ARTIFACT_DIGEST||'').trim(),artifactDigest=/^[0-9a-f]{64}$/i.test(artifactDigestRaw)?'sha256:'+artifactDigestRaw.toLowerCase():artifactDigestRaw.toLowerCase();
const archiveOutcome=String(process.env.NUMINA_ARCHIVE_OUTCOME||'unknown').trim();
const actionsArchiveAvailable=archiveOutcome==='success'&&!!artifactName&&/^[1-9]\d*$/.test(artifactId)&&/^sha256:[0-9a-f]{64}$/i.test(artifactDigest);
const workflowRunId=String(process.env.GITHUB_RUN_ID||'').trim(),runAttempt=String(process.env.GITHUB_RUN_ATTEMPT||'').trim();
const archive=JSON.parse(inputBytes);
assert(archive?.schema==='numina.provider-evidence-archive.v3'&&archive.root==='NUMINA'&&archive.manifest==='NUMINA','archive manifest mismatch');
assert(archive.integrity_model==='github_commit_plus_release_sha256_readback'&&archive.credentialed===false&&archive.partnership_status==='asserted'&&archive.external_execution_performed===false,'archive boundary mismatch');
assert(/^[0-9a-f]{40}$/i.test(String(archive.source_commit||'')),'source commit invalid');
assert(archive.source_commit===(process.env.NUMINA_EXPECTED_GIT_SHA||process.env.GITHUB_SHA||'').trim(),'archive source does not match triggering commit');
const {archive_sha256,...archivePayload}=archive;
assert(digest(archivePayload)===archive_sha256,'archive SHA-256 mismatch');
assert(archive.transport?.identity==='NUMINA'&&archive.transport?.role==='diagnostic_only'&&archive.transport?.verified===true&&archive.transport?.observation?.transport==='github'&&archive.transport?.observation?.git_commit_sha===archive.source_commit,'GitHub transport diagnostics missing');
assert(/^\d+$/.test(workflowRunId)&&/^\d+$/.test(runAttempt),'GitHub workflow metadata invalid');

const observation=archive.observation_set;
assert(observation?.schema==='numina.provider-observation-set.v1'&&observation.release===RUNTIME_VERSION&&observation.status==='HEALTHY'&&observation.all_healthy===true,'provider set mismatch');
assert(Array.isArray(observation.providers)&&observation.providers.join(',')==='arc,circle'&&observation.credentialed===false&&observation.partnership_status==='asserted'&&observation.external_execution_performed===false,'provider boundary mismatch');
const byProvider=new Map((observation.observations||[]).map(item=>[item.provider,item])),arc=byProvider.get('arc'),circle=byProvider.get('circle');
assert(circle?.healthy===true&&circle?.observed?.message==='pong','Circle observation invalid');
assert(arc?.healthy===true&&arc?.observed?.chain_id===5042002&&Number.isSafeInteger(arc?.observed?.latest_block),'Arc observation invalid');
const observedAt=observation.observed_at;assert(Number.isFinite(Date.parse(observedAt)),'provider observed_at invalid');

const persistence=actionsArchiveAvailable
  ? {available:true,persistence:'github_actions_artifact',artifact_name:artifactName,artifact_id:Number(artifactId),digest:artifactDigest,evidence_file_sha256:evidenceFileDigest}
  : {available:false,persistence:'github_release_pending_sha256_readback',artifact_name:null,artifact_id:null,digest:evidenceFileDigest,evidence_file_sha256:evidenceFileDigest};
const artifact_json={
  schema:'numina.evidence-record.v3',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',scope:'provider_observation',
  source_commit:archive.source_commit,
  integrity_model:archive.integrity_model,
  transport:archive.transport,
  provider_observation:{observation_set:archive.observation_set},
  archive:{...persistence,actions_upload_outcome:archiveOutcome,workflow_name:'Verify provider observations',workflow_run_id:Number(workflowRunId),run_attempt:Number(runAttempt),git_commit_sha:archive.source_commit,archive_sha256:archive.archive_sha256},
  assertions:{transport_commit_verified:true,provider_observation_public_read_only:true,github_artifact_digest_verified:actionsArchiveAvailable,github_release_sha256_readback_required:true,provider_set_schema:observation.schema,runtime_release:observation.release,providers:observation.providers,provider_status:observation.status,all_healthy:observation.all_healthy,circle_message:circle.observed.message,arc_chain_id:arc.observed.chain_id,arc_latest_block:arc.observed.latest_block,fresh_timestamp:true,credentialed:false,partnership_status:'asserted',external_execution_performed:false}
};
const artifact_root=digest(artifact_json);
const manifest={root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',record_id:'provider-observation-'+archive.source_commit.slice(0,12)+'-'+compactTimestamp(observedAt),status:'PROVIDER_OBSERVATION_VERIFIED',artifact_type:'NUMINA_PROVIDER_OBSERVATION_SET',artifact_root,artifact_json,created_at:Math.floor(Date.parse(observedAt)/1000),revoked:false};
mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,JSON.stringify(manifest,null,2)+'\n',{encoding:'utf8',mode:0o600});
console.log(JSON.stringify({ok:true,root:'NUMINA',manifest:'NUMINA',record_id:manifest.record_id,status:manifest.status,artifact_root,archive_digest:persistence.digest,actions_archive_available:actionsArchiveAvailable,source_commit:archive.source_commit,transport:'github',transport_current_expected_commit:true,provider_status:observation.status,circle_message:circle.observed.message,arc_chain_id:arc.observed.chain_id,arc_latest_block:arc.observed.latest_block,credentialed:false,partnership_status:'asserted',external_execution_performed:false,path:outputPath},null,2));
