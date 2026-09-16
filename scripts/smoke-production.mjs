import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {EXPECTED_RELEASE,PINNED_RUNTIME_KEY_ID,PINNED_RUNTIME_PUBLIC_KEY,RELEASE_ARTIFACT_TYPE,RUNTIME_ORIGIN,RUNTIME_VERSION} from '../public/runtime-contract.js';

const CANONICAL_ORIGIN='https://numinalabs.xyz';
const SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex');
const MAX_JSON_BYTES=262144;
const MAX_HTML_BYTES=1048576;
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
function canonical(value){return Buffer.from(JSON.stringify(sorted(value)),'utf8');}
function digestText(value){return createHash('sha256').update(value,'utf8').digest('hex');}
function assert(condition,message){if(!condition)throw new Error(message);}
function exactRelease(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(EXPECTED_RELEASE).every(([field,expected])=>value[field]===expected);}
function sameJson(a,b){return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));}
function firstDifference(a,b){const length=Math.min(a.length,b.length);for(let i=0;i<length;i++)if(a[i]!==b[i])return i;return a.length===b.length?-1:length;}
function verifyEnvelope(envelope,expectedType){
  assert(envelope&&typeof envelope==='object','signed envelope missing');
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
assert(exactRelease(manifest.value),'runtime manifest identity drift');
assert(exactRelease(status.value),'status release identity drift');
assert(status.value.live_provider_submitter_exposed===false,'live provider submitter unexpectedly exposed');
assert(status.value.external_execution_performed===false,'status reports external execution');
assert(supply.value.valid===true,'supply-chain verifier not valid');
assert(supply.value.release===EXPECTED_RELEASE.release,'supply-chain release drift');
assert(supply.value.production_files_root===EXPECTED_RELEASE.production_files_root,'production files root drift');
assert(supply.value.spdx_sbom_sha256===EXPECTED_RELEASE.spdx_sbom_sha256,'SBOM digest drift');
assert(supply.value.slsa_provenance_sha256===EXPECTED_RELEASE.slsa_provenance_sha256,'SLSA provenance digest drift');
const releasePayload=verifyEnvelope(attestation.value,RELEASE_ARTIFACT_TYPE);
assert(exactRelease(releasePayload),'release attestation identity drift');
assert(releasePayload.environment==='production'&&releasePayload.role==='public-verifier','release attestation scope drift');
assert(releasePayload.financial_execution_performed===false,'release attestation reports financial execution');
const controlPayload=verifyEnvelope(control.value.receipt,'NUMINA_CONTROL_STATE');
assert(sameJson(controlPayload,control.value.state),'control state receipt mismatch');
assert(controlPayload.release===RUNTIME_VERSION,'control state release drift');
assert(controlPayload.real_funds_enabled===false&&controlPayload.employer_ip_enabled===false&&controlPayload.public_execution_api_enabled===false&&controlPayload.public_execution_route_exposed===false,'execution boundary unexpectedly open');
assert(application.value.version==='4.0.0'&&application.value.release==='numina-v4.0.0','application release drift');
assert(application.value.runtime_dependency?.version===RUNTIME_VERSION&&application.value.runtime_dependency?.release===EXPECTED_RELEASE.release,'application runtime binding drift');
const deploymentPayload=verifyEnvelope(provenance.value.receipt,'NUMINA_DEPLOYMENT_PROVENANCE');
assert(sameJson(deploymentPayload,provenance.value.provenance),'deployment provenance receipt mismatch');
assert(deploymentPayload.environment==='production','deployment environment drift');
assert(/^dpl_[A-Za-z0-9]+$/.test(deploymentPayload.deployment_id),'deployment id missing');
assert(/^[0-9a-f]{40}$/i.test(deploymentPayload.git_commit_sha),'deployment git SHA missing');
assert(deploymentPayload.git_commit_ref==='main','deployment branch drift');
const readiness=frontier.value.readiness;
assert(readiness?.ready===true,'frontier readiness is false');
assert(readiness.mode==='public-verifier-no-financial-execution','frontier mode drift');
assert(Object.values(readiness.checks||{}).length===8&&Object.values(readiness.checks).every(Boolean),'one or more frontier readiness checks failed');
assert(exactRelease(readiness.runtime),'frontier runtime identity drift');
assert(readiness.deployment?.deployment_id===deploymentPayload.deployment_id&&readiness.deployment?.git_commit_sha===deploymentPayload.git_commit_sha,'frontier provenance binding drift');
const readinessPayload=verifyEnvelope(frontier.value.receipt,'NUMINA_FRONTIER_READINESS');
assert(sameJson(readinessPayload,readiness),'frontier readiness receipt mismatch');

assert(canonicalApplication.value.version==='4.0.0'&&canonicalApplication.value.release==='numina-v4.0.0','canonical application release drift');
assert(canonicalApplication.value.runtime_dependency?.version===RUNTIME_VERSION&&canonicalApplication.value.runtime_dependency?.release===EXPECTED_RELEASE.release,'canonical application runtime binding drift');
assert(sameJson(application.value,canonicalApplication.value),'stable and canonical application manifests diverged');
assert(stableAgentCard.value?.name==='Numina Control'&&stableAgentCard.value?.version==='4.0.0','stable agent card identity drift');
assert(stableAgentCard.value?.url===CANONICAL_ORIGIN+'/api/control/v2/a2a','stable agent card endpoint drift');
assert(sameJson(stableAgentCard.value,canonicalAgentCard.value),'stable and canonical agent cards diverged');
assert(stableControlManifest.value?.schema==='numina.frontier.v2'&&stableControlManifest.value?.version==='4.0.0','stable control manifest identity drift');
assert(stableControlManifest.value?.environment==='production'&&stableControlManifest.value?.livemode===true,'stable control manifest environment drift');
assert(stableControlManifest.value?.externalExecution===false,'canonical control plane reports external execution');
assert(sameJson(stableControlManifest.value,canonicalControlManifest.value),'stable and canonical control manifests diverged');
assert(/<link rel="canonical" href="https:\/\/numinalabs\.xyz\/frontier">/i.test(stableFrontier.text),'stable frontier canonical link drift');
assert(/<link rel="canonical" href="https:\/\/numinalabs\.xyz\/frontier">/i.test(canonicalFrontier.text),'canonical frontier canonical link drift');
assert(/NUMINA/i.test(stableFrontier.text)&&/NUMINA/i.test(canonicalFrontier.text),'frontier identity marker missing');
const stableFrontierSha256=digestText(stableFrontier.text),canonicalFrontierSha256=digestText(canonicalFrontier.text);
if(stableFrontierSha256!==canonicalFrontierSha256){
  const offset=firstDifference(stableFrontier.text,canonicalFrontier.text);
  const start=Math.max(0,offset-120),end=Math.min(Math.max(stableFrontier.text.length,canonicalFrontier.text.length),offset+240);
  console.error(JSON.stringify({frontier_drift:{stable_sha256:stableFrontierSha256,canonical_sha256:canonicalFrontierSha256,stable_bytes:Buffer.byteLength(stableFrontier.text,'utf8'),canonical_bytes:Buffer.byteLength(canonicalFrontier.text,'utf8'),first_difference:offset,stable_context:stableFrontier.text.slice(start,end),canonical_context:canonicalFrontier.text.slice(start,end)}},null,2));
}
assert(stableFrontierSha256===canonicalFrontierSha256,'stable and canonical frontier HTML diverged');

console.log(JSON.stringify({ok:true,runtime:RUNTIME_VERSION,release:EXPECTED_RELEASE.release,application:application.value.release,deployment_id:deploymentPayload.deployment_id,git_commit_sha:deploymentPayload.git_commit_sha,readiness_checks:Object.keys(readiness.checks),signing_key_id:PINNED_RUNTIME_KEY_ID,execution_boundary:'closed',public_surface_convergence:{application_manifest:true,agent_card:true,control_manifest:true,frontier_html:true,frontier_sha256:stableFrontierSha256,canonical_origin:CANONICAL_ORIGIN,stable_origin:RUNTIME_ORIGIN}},null,2));
