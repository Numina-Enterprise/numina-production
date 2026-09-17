import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {EXPECTED_RELEASE,PINNED_RUNTIME_KEY_ID,PINNED_RUNTIME_PUBLIC_KEY,RELEASE_ARTIFACT_TYPE,RUNTIME_ORIGIN,RUNTIME_VERSION} from '../public/runtime-contract.js';
import {APPLICATION_VERSION,APPLICATION_RELEASE,EXPECTED_APPLICATION_ARTIFACT_BUILD_ID,APPLICATION_ARTIFACT_BUILD_SCOPE} from '../src/application-release-contract.js';

const CANONICAL_ORIGIN='https://numinalabs.xyz';
const EXPECTED_GIT_SHA=(process.env.NUMINA_EXPECTED_GIT_SHA||'').trim();
const SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex');
const MAX_JSON_BYTES=262144;
const MAX_HTML_BYTES=1048576;

function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(object(value)){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
function canonical(value){return Buffer.from(JSON.stringify(sorted(value)),'utf8');}
function digestText(value){return createHash('sha256').update(value,'utf8').digest('hex');}
function assert(condition,message){if(!condition)throw new Error(message);}
function sameJson(a,b){return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));}
function exactRelease(value){return Boolean(object(value)&&Object.entries(EXPECTED_RELEASE).every(([field,expected])=>value[field]===expected));}
function authoredFrontier(html){const marker='</footer>';const index=html.indexOf(marker);assert(index>=0,'frontier footer boundary missing');return html.slice(0,index+marker.length);}
function verifyProjection(value,surface){assert(object(value),`${surface} projection missing`);assert(value.source==='NUMINA'&&value.authority==='NUMINA'&&value.productionSource==='NUMINA',`${surface} authority drift`);assert(value.surface===surface,`${surface} projection surface drift`);return value;}
function verifyEnvelope(envelope,expectedType){
  assert(object(envelope),'signed envelope missing');
  assert(envelope.artifact_type===expectedType,`unexpected artifact type: ${envelope.artifact_type}`);
  assert(envelope.algorithm==='Ed25519','unexpected signing algorithm');
  assert(envelope.key_id===PINNED_RUNTIME_KEY_ID,'runtime key id drift');
  assert(envelope.public_key===PINNED_RUNTIME_PUBLIC_KEY,'runtime public key drift');
  const raw=Buffer.from(PINNED_RUNTIME_PUBLIC_KEY,'base64');
  assert(raw.length===32,'invalid pinned Ed25519 key length');
  assert(createHash('sha256').update(raw).digest('hex').slice(0,24)===PINNED_RUNTIME_KEY_ID,'pinned key fingerprint mismatch');
  const publicKey=createPublicKey({key:Buffer.concat([SPKI_PREFIX,raw]),format:'der',type:'spki'});
  assert(verifySignature(null,canonical({artifact_type:envelope.artifact_type,key_id:envelope.key_id,payload:envelope.payload}),publicKey,Buffer.from(envelope.signature||'','base64')),'signature verification failed');
  return envelope.payload;
}
async function fetchBody(origin,path,{kind='json',maxBytes=MAX_JSON_BYTES}={}){
  const response=await fetch(origin+path,{headers:{accept:kind==='json'?'application/json':'text/html'},redirect:'manual',signal:AbortSignal.timeout(10000)});
  assert(response.status===200,`${origin}${path} returned ${response.status}`);
  const type=(response.headers.get('content-type')||'').toLowerCase();
  assert(kind==='json'?type.includes('application/json'):type.includes('text/html'),`${origin}${path} returned unexpected content type ${type}`);
  const text=await response.text();
  assert(Buffer.byteLength(text,'utf8')<=maxBytes,`${origin}${path} response too large`);
  return {text,value:kind==='json'?JSON.parse(text):text,headers:response.headers};
}
const get=(path)=>fetchBody(RUNTIME_ORIGIN,path);
const getCanonical=(path,options)=>fetchBody(CANONICAL_ORIGIN,path,options);

const [frontier,provenance,status,manifest,supply,attestation,control,application,canonicalApplication,stableAgentCard,canonicalAgentCard,stableControlManifest,canonicalControlManifest,stableFrontier,canonicalFrontier]=await Promise.all([
  get('/v1/frontier/readiness'),get('/v1/deployment/provenance'),get('/v1/status'),get('/v1/release/manifest'),get('/v1/release/supply-chain'),get('/v1/release/attestation'),get('/v1/control/state'),get('/v4/release/manifest'),getCanonical('/v4/release/manifest'),get('/.well-known/agent-card.json'),getCanonical('/.well-known/agent-card.json'),get('/api/control/v2/manifest'),getCanonical('/api/control/v2/manifest'),fetchBody(RUNTIME_ORIGIN,'/frontier',{kind:'html',maxBytes:MAX_HTML_BYTES}),getCanonical('/frontier',{kind:'html',maxBytes:MAX_HTML_BYTES})
]);

assert(frontier.headers.get('x-numina-runtime-release')===RUNTIME_VERSION,'frontier runtime header drift');

const runtimeManifest=manifest.value?.manifest;
verifyProjection(runtimeManifest,'manifest');
assert(runtimeManifest.schema==='numina.manifest.v1','runtime manifest schema drift');
assert(exactRelease(runtimeManifest.release),'runtime manifest identity drift');
const manifestPayload=verifyEnvelope(manifest.value?.receipt,'NUMINA_MANIFEST');
assert(sameJson(manifestPayload,runtimeManifest),'runtime manifest receipt mismatch');

const statusProjection=verifyProjection(status.value?.status,'status');
const statusPayload=verifyEnvelope(status.value?.receipt,'NUMINA_PRODUCTION_STATUS');
assert(sameJson(statusPayload,statusProjection),'status receipt mismatch');
const statusBody=statusProjection.payload;
assert(object(statusBody)&&exactRelease(statusBody.release),'status release identity drift');
assert(statusBody.runtime==='NUMINA','status runtime identity drift');
assert(statusBody.controls?.real_funds_enabled===false&&statusBody.controls?.employer_ip_enabled===false&&statusBody.controls?.public_execution_api_enabled===false,'status execution boundary unexpectedly open');

const supplyProjection=verifyProjection(supply.value,'supply-chain');
const supplyContainer=supplyProjection.payload;
const supplyEvidence=supplyContainer?.evidence;
assert(object(supplyEvidence)&&supplyEvidence.valid===true,'supply-chain verifier not valid');
assert(supplyEvidence.release===EXPECTED_RELEASE.release,'supply-chain release drift');
assert(supplyEvidence.production_files_root===EXPECTED_RELEASE.production_files_root,'production files root drift');
assert(supplyEvidence.spdx_sbom_sha256===EXPECTED_RELEASE.spdx_sbom_sha256,'SBOM digest drift');
assert(supplyEvidence.slsa_provenance_sha256===EXPECTED_RELEASE.slsa_provenance_sha256,'SLSA provenance digest drift');
const supplySigned=verifyEnvelope(supplyContainer?.receipt,'NUMINA_SUPPLY_CHAIN_EVIDENCE');
assert(sameJson(supplySigned,supplyEvidence),'supply-chain receipt mismatch');

const releaseProjection=verifyEnvelope(attestation.value,RELEASE_ARTIFACT_TYPE);
verifyProjection(releaseProjection,'release-attestation');
const releaseBody=releaseProjection.payload;
assert(releaseBody?.schema==='numina.release-attestation.v1','release attestation schema drift');
assert(exactRelease(releaseBody.release),'release attestation identity drift');
assert(releaseBody.runtime==='NUMINA','release attestation runtime drift');
assert(releaseBody.manifest?.schema==='numina.manifest.v1'&&exactRelease(releaseBody.manifest?.release),'release attestation manifest drift');

const controlProjection=verifyProjection(control.value?.state,'control-state');
const controlSigned=verifyEnvelope(control.value?.receipt,'NUMINA_CONTROL_STATE');
assert(sameJson(controlSigned,controlProjection),'control state receipt mismatch');
const controlBody=controlProjection.payload;
assert(controlBody?.schema==='numina.control-state.v1'&&controlBody.release===RUNTIME_VERSION,'control state release drift');
const controls=controlBody.controls;
assert(controls?.runtime_controls_configurable===true&&controls?.real_funds_enabled===false&&controls?.employer_ip_enabled===false&&controls?.public_execution_api_enabled===false&&controls?.public_execution_route_exposed===false,'execution boundary unexpectedly open');

assert(application.value.version===APPLICATION_VERSION&&application.value.release===APPLICATION_RELEASE,'application release drift');
assert(/^[0-9a-f]{64}$/i.test(String(application.value.build_id||'')),'canonical application build id invalid');
assert(application.value.runtime_dependency?.version===RUNTIME_VERSION&&application.value.runtime_dependency?.release===EXPECTED_RELEASE.release,'application runtime binding drift');

const deploymentPayload=verifyEnvelope(provenance.value.receipt,'NUMINA_DEPLOYMENT_PROVENANCE');
assert(sameJson(deploymentPayload,provenance.value.provenance),'deployment provenance receipt mismatch');
assert(deploymentPayload.environment==='production','deployment environment drift');
assert(/^dpl_[A-Za-z0-9]+$/.test(deploymentPayload.deployment_id),'deployment id missing');
assert(/^[0-9a-f]{40}$/i.test(deploymentPayload.git_commit_sha),'deployment git SHA missing');
assert(deploymentPayload.git_commit_ref==='main','deployment branch drift');
assert(deploymentPayload.runtime_release===RUNTIME_VERSION&&deploymentPayload.release===EXPECTED_RELEASE.release,'deployment release drift');
if(EXPECTED_GIT_SHA){
  assert(/^[0-9a-f]{40}$/i.test(EXPECTED_GIT_SHA),'NUMINA_EXPECTED_GIT_SHA must be a full 40-character Git SHA');
  assert(deploymentPayload.git_commit_sha.toLowerCase()===EXPECTED_GIT_SHA.toLowerCase(),`production Git SHA ${deploymentPayload.git_commit_sha} does not match expected ${EXPECTED_GIT_SHA}`);
}

const readiness=frontier.value.readiness;
assert(readiness?.ready===true,'frontier readiness is false');
assert(readiness.mode==='public-verifier-no-financial-execution','frontier mode drift');
assert(Object.values(readiness.checks||{}).length===8&&Object.values(readiness.checks).every(Boolean),'one or more frontier readiness checks failed');
assert(exactRelease(readiness.runtime),'frontier runtime identity drift');
assert(readiness.deployment?.deployment_id===deploymentPayload.deployment_id&&readiness.deployment?.git_commit_sha===deploymentPayload.git_commit_sha,'frontier provenance binding drift');
assert(readiness.application?.canonical_manifest_build_id===application.value.build_id,'signed readiness canonical application build id drift');
assert(readiness.application?.artifact_inventory_build_id===EXPECTED_APPLICATION_ARTIFACT_BUILD_ID,'signed readiness artifact inventory build id drift');
assert(readiness.application?.artifact_inventory_scope===APPLICATION_ARTIFACT_BUILD_SCOPE,'signed readiness artifact inventory scope drift');
const expectedRelation=application.value.build_id===EXPECTED_APPLICATION_ARTIFACT_BUILD_ID?'converged':'distinct_scopes';
assert(readiness.application?.build_identity_relation===expectedRelation,'signed readiness build identity relationship drift');
const readinessPayload=verifyEnvelope(frontier.value.receipt,'NUMINA_FRONTIER_READINESS');
assert(sameJson(readinessPayload,readiness),'frontier readiness receipt mismatch');

assert(canonicalApplication.value.version===APPLICATION_VERSION&&canonicalApplication.value.release===APPLICATION_RELEASE,'canonical application release drift');
assert(canonicalApplication.value.runtime_dependency?.version===RUNTIME_VERSION&&canonicalApplication.value.runtime_dependency?.release===EXPECTED_RELEASE.release,'canonical application runtime binding drift');
assert(sameJson(application.value,canonicalApplication.value),'stable and canonical application manifests diverged');
assert(stableAgentCard.value?.name==='Numina Control'&&stableAgentCard.value?.version===APPLICATION_VERSION,'stable agent card identity drift');
assert(stableAgentCard.value?.url===CANONICAL_ORIGIN+'/api/control/v2/a2a','stable agent card endpoint drift');
assert(sameJson(stableAgentCard.value,canonicalAgentCard.value),'stable and canonical agent cards diverged');
assert(stableControlManifest.value?.schema==='numina.frontier.v2'&&stableControlManifest.value?.version===APPLICATION_VERSION,'stable control manifest identity drift');
assert(stableControlManifest.value?.environment==='production'&&stableControlManifest.value?.livemode===true,'stable control manifest environment drift');
assert(stableControlManifest.value?.externalExecution===false,'canonical control plane reports external execution');
assert(sameJson(stableControlManifest.value,canonicalControlManifest.value),'stable and canonical control manifests diverged');
assert(/<link rel="canonical" href="https:\/\/numinalabs\.xyz\/frontier">/i.test(stableFrontier.text),'stable frontier canonical link drift');
assert(/<link rel="canonical" href="https:\/\/numinalabs\.xyz\/frontier">/i.test(canonicalFrontier.text),'canonical frontier canonical link drift');
assert(/NUMINA/i.test(stableFrontier.text)&&/NUMINA/i.test(canonicalFrontier.text),'frontier identity marker missing');
const stableAuthoredFrontier=authoredFrontier(stableFrontier.text),canonicalAuthoredFrontier=authoredFrontier(canonicalFrontier.text);
const stableFrontierSha256=digestText(stableAuthoredFrontier),canonicalFrontierSha256=digestText(canonicalAuthoredFrontier);
assert(stableFrontierSha256===canonicalFrontierSha256,'stable and canonical authored frontier HTML diverged');

console.log(JSON.stringify({ok:true,runtime:RUNTIME_VERSION,release:EXPECTED_RELEASE.release,application:application.value.release,deployment_id:deploymentPayload.deployment_id,git_commit_sha:deploymentPayload.git_commit_sha,expected_git_commit_sha:EXPECTED_GIT_SHA||null,readiness_checks:Object.keys(readiness.checks),signing_key_id:PINNED_RUNTIME_KEY_ID,execution_boundary:'closed',signed_runtime_surfaces:{manifest:true,status:true,supply_chain:true,release_attestation:true,control_state:true,frontier_readiness:true,deployment_provenance:true},application_build_identity:{canonical_manifest_build_id:application.value.build_id,artifact_inventory_build_id:EXPECTED_APPLICATION_ARTIFACT_BUILD_ID,artifact_inventory_scope:APPLICATION_ARTIFACT_BUILD_SCOPE,relation:expectedRelation},public_surface_convergence:{application_manifest:true,agent_card:true,control_manifest:true,frontier_authored_html:true,frontier_authored_sha256:stableFrontierSha256,canonical_post_document_bytes:Buffer.byteLength(canonicalFrontier.text,'utf8')-Buffer.byteLength(canonicalAuthoredFrontier,'utf8'),canonical_origin:CANONICAL_ORIGIN,stable_origin:RUNTIME_ORIGIN}},null,2));
