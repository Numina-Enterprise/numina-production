import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const PROVIDER_RECORD_PATH=process.env.NUMINA_PROVIDER_RECORD_PATH||'',OUTPUT_PATH=process.env.NUMINA_TRUSTED_RELEASE_PATH||'',EXPECTED_GIT_SHA=(process.env.NUMINA_EXPECTED_GIT_SHA||process.env.GITHUB_SHA||'').trim();
function assert(condition,message){if(!condition)throw new Error(message);}
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const output={};for(const key of Object.keys(value).sort())output[key]=sorted(value[key]);return output;}return value;}
const canonical=value=>Buffer.from(JSON.stringify(sorted(value)),'utf8');
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');

assert(PROVIDER_RECORD_PATH,'NUMINA_PROVIDER_RECORD_PATH required');assert(OUTPUT_PATH,'NUMINA_TRUSTED_RELEASE_PATH required');assert(/^[0-9a-f]{40}$/i.test(EXPECTED_GIT_SHA),'current GitHub source commit is required');
assert(process.env.NUMINA_ROOT_VERIFIED==='true','Numina build and exact artifact checks must pass before trusted source release creation');
if(process.env.GITHUB_REPOSITORY)assert(process.env.GITHUB_REPOSITORY==='skott34-dot/numina-production','unexpected GitHub repository');
if(process.env.GITHUB_REF_NAME)assert(process.env.GITHUB_REF_NAME==='main','trusted source release must be bound to main');

const providerRecord=JSON.parse(fs.readFileSync(PROVIDER_RECORD_PATH,'utf8'));
assert(providerRecord.root==='NUMINA'&&providerRecord.manifest==='NUMINA'&&providerRecord.status==='PROVIDER_OBSERVATION_VERIFIED','provider evidence manifest invalid');
assert(providerRecord.artifact_type==='NUMINA_PROVIDER_OBSERVATION_SET'&&providerRecord.revoked===false&&/^[0-9a-f]{64}$/i.test(String(providerRecord.artifact_root||'')),'provider evidence header invalid');
assert(digest(providerRecord.artifact_json)===providerRecord.artifact_root,'provider artifact root mismatch');
const providerArtifact=providerRecord.artifact_json||{};
assert(providerArtifact.source_commit===EXPECTED_GIT_SHA,'provider evidence source commit mismatch');
assert(providerArtifact.root==='NUMINA'&&providerArtifact.manifest==='NUMINA'&&providerArtifact.transport?.role==='diagnostic_only'&&providerArtifact.transport?.observation?.transport==='github','provider evidence NUMINA mismatch');
assert(providerArtifact.assertions?.provider_status==='HEALTHY'&&providerArtifact.assertions?.circle_message==='pong'&&providerArtifact.assertions?.arc_chain_id===5042002,'provider evidence unhealthy');
assert(providerArtifact.assertions?.credentialed===false&&providerArtifact.assertions?.partnership_status==='asserted'&&providerArtifact.assertions?.external_execution_performed===false,'provider evidence boundary mismatch');
assert(/^sha256:[0-9a-f]{64}$/i.test(String(providerArtifact.archive?.digest||'')),'provider archive digest invalid');

const finalBuild=JSON.parse(fs.readFileSync('public/final-build.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('config/numina-manifest.v2.json','utf8'));
const routing=JSON.parse(fs.readFileSync('config/numina-routing.json','utf8'));
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
assert(finalBuild.identity==='NUMINA'&&finalBuild.status==='FINAL'&&finalBuild.manifestContract?.finalAll==='NUMINA','final build identity invalid');
assert(pkg.numina?.finalBuildManifest?.blob&&pkg.numina.finalBuildManifest.identity==='NUMINA','final build pin missing');
const repository=manifest.mechanics?.repository,githubLeaf=routing.tree?.leaves?.github;
assert(manifest.schema==='numina.manifest.v2'&&manifest.identity==='NUMINA'&&repository?.identity==='NUMINA'&&repository?.branch==='main'&&repository?.role==='CANONICAL_ROOT_REPOSITORY'&&repository?.authoritative===true,'canonical manifest mismatch');
assert(routing.canonicalSource?.root==='NUMINA'&&routing.canonicalSource?.role==='ROOT_SOURCE_OF_TRUTH'&&routing.canonicalSource?.updateDirection==='ROOT_TO_LEAVES'&&githubLeaf?.repository==='skott34-dot/numina-production'&&githubLeaf?.branch==='main'&&githubLeaf?.role==='ARCHIVE_LEAF'&&githubLeaf?.authoritative===false,'canonical GitHub routing mismatch');
assert(!(manifest.mechanics?.delivery?.surfaces||[]).some(value=>String(value).includes('vercel.app')),'retired Vercel surface returned');

const observedAt=providerArtifact.provider_observation?.observation_set?.observed_at;
assert(Number.isFinite(Date.parse(observedAt)),'provider observation timestamp invalid');
const observedTag=new Date(observedAt).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const artifactJson={
  schema:'numina.trusted-source-release.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',
  scope:'numina_github_source_release_gate',source_commit:EXPECTED_GIT_SHA,canonical_repository:'skott34-dot/numina-production',canonical_branch:'main',
  provider_evidence:{record_id:providerRecord.record_id,artifact_root:providerRecord.artifact_root,archive_digest:providerArtifact.archive.digest},
  root_verification:{build_and_artifact_checks:true,full_test_suite_executed:false,workflow_run_id:process.env.GITHUB_RUN_ID||null,workflow_run_attempt:process.env.GITHUB_RUN_ATTEMPT||null,final_build_blob:pkg.numina.finalBuildManifest.blob,application_version:pkg.version},
  publication:{public_deployment_verified:false,classification:'source_release_not_live_deployment'},
  assertions:{github_main_verified:true,provider_evidence_workflow_verified:true,provider_status:'HEALTHY',circle_message:'pong',arc_chain_id:5042002,credentialed:false,partnership_status:'asserted',external_execution_performed:false,external_balance_verified:false,external_backing_asserted:false,vercel_active_dependency:false,neon_active_dependency:false}
};
const recordId='trusted-source-numina-'+EXPECTED_GIT_SHA.slice(0,12)+'-'+observedTag;
const output={root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',record_id:recordId,status:'TRUSTED_NUMINA_SOURCE_RELEASE',artifact_type:'NUMINA_TRUSTED_SOURCE_RELEASE',artifact_root:digest(artifactJson),artifact_json:artifactJson,created_at:Math.floor(Date.parse(observedAt)/1000),revoked:false};
fs.mkdirSync(path.dirname(OUTPUT_PATH),{recursive:true});fs.writeFileSync(OUTPUT_PATH,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({ok:true,record_id:output.record_id,status:output.status,artifact_root:output.artifact_root,source_commit:EXPECTED_GIT_SHA,provider_evidence_record_id:providerRecord.record_id,provider_artifact_root:providerRecord.artifact_root,archive_digest:providerArtifact.archive.digest,public_deployment_verified:false,external_execution_performed:false,path:path.resolve(OUTPUT_PATH)},null,2));
