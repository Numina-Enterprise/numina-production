import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {PINNED_RUNTIME_KEY_ID,PINNED_RUNTIME_PUBLIC_KEY,RUNTIME_ORIGIN,RUNTIME_VERSION} from '../public/runtime-contract.js';

const EXPECTED_GIT_SHA=(process.env.NUMINA_EXPECTED_GIT_SHA||'').trim();
const EVIDENCE_PATH=(process.env.NUMINA_PROVIDER_EVIDENCE_PATH||'').trim();
const SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex');
const MAX_BYTES=262144;
const MAX_AGE_MS=5*60*1000;
const MAX_FUTURE_SKEW_MS=60*1000;
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
function canonical(value){return Buffer.from(JSON.stringify(sorted(value)),'utf8');}
function digest(value){return createHash('sha256').update(Buffer.isBuffer(value)?value:canonical(value)).digest('hex');}
function sameJson(a,b){return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));}
function assert(condition,message){if(!condition)throw new Error(message);}
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
async function get(path){
  const response=await fetch(RUNTIME_ORIGIN+path,{headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
  assert(response.status===200,`${path} returned ${response.status}`);
  assert((response.headers.get('content-type')||'').toLowerCase().includes('application/json'),`${path} returned non-JSON`);
  const text=await response.text();
  assert(Buffer.byteLength(text,'utf8')<=MAX_BYTES,`${path} response too large`);
  return JSON.parse(text);
}
function fresh(timestamp,label){
  const time=Date.parse(timestamp);
  assert(Number.isFinite(time),`${label} timestamp invalid`);
  const age=Date.now()-time;
  assert(age<=MAX_AGE_MS,`${label} observation is stale`);
  assert(age>=-MAX_FUTURE_SKEW_MS,`${label} observation timestamp is too far in the future`);
}

const provenance=await get('/v1/deployment/provenance');
const provenancePayload=verifyEnvelope(provenance.receipt,'NUMINA_DEPLOYMENT_PROVENANCE');
assert(sameJson(provenancePayload,provenance.provenance),'deployment provenance receipt mismatch');
if(EXPECTED_GIT_SHA){
  assert(/^[0-9a-f]{40}$/i.test(EXPECTED_GIT_SHA),'NUMINA_EXPECTED_GIT_SHA must be a full Git SHA');
  assert(String(provenancePayload.git_commit_sha||'').toLowerCase()===EXPECTED_GIT_SHA.toLowerCase(),`production Git SHA ${provenancePayload.git_commit_sha} does not match expected ${EXPECTED_GIT_SHA}`);
}

const response=await get('/v1/execution/providers?mode=health-all');
const signedSetPayload=verifyEnvelope(response.receipt,'NUMINA_PROVIDER_OBSERVATION_SET');
assert(sameJson(signedSetPayload,response.observation_set),'provider observation set receipt mismatch');
const projected=Boolean(signedSetPayload&&typeof signedSetPayload==='object'&&signedSetPayload.payload&&typeof signedSetPayload.payload==='object');
if(projected){
  assert(signedSetPayload.source==='NUMINA','provider observation projection source drift');
  assert(signedSetPayload.authority==='NUMINA','provider observation projection authority drift');
  assert(signedSetPayload.productionSource==='NUMINA','provider observation projection production source drift');
  assert(signedSetPayload.surface==='provider-observations','provider observation projection surface drift');
}
const setPayload=projected?signedSetPayload.payload:signedSetPayload;
assert(setPayload.schema==='numina.provider-observation-set.v1',`provider observation set schema drift: ${String(setPayload?.schema??'missing')}`);
assert(setPayload.release===RUNTIME_VERSION,`provider observation release drift: ${String(setPayload?.release??'missing')}`);
assert(setPayload.mode==='public-read-only-health','provider observation mode drift');
assert(setPayload.source_authority==='provider_public_endpoints','provider source authority drift');
assert(setPayload.credentialed===false,'provider observation unexpectedly credentialed');
assert(setPayload.partnership_status==='not_asserted','provider observation asserts partnership');
assert(setPayload.external_execution_performed===false,'provider observation reports external execution');
assert(setPayload.status==='HEALTHY'&&setPayload.all_healthy===true,'provider observation set is degraded');
fresh(setPayload.observed_at,'provider set');
assert(Array.isArray(setPayload.providers)&&setPayload.providers.join(',')==='arc,circle','provider observation set identity drift');
assert(Array.isArray(setPayload.observations)&&setPayload.observations.length===2&&setPayload.observation_count===2,'provider observation count drift');
const byProvider=new Map(setPayload.observations.map(item=>[item.provider,item]));
for(const provider of ['arc','circle']){
  const observation=byProvider.get(provider);
  assert(observation,`${provider} observation missing`);
  assert(observation.schema==='numina.provider-observation.v1',`${provider} observation schema drift`);
  assert(observation.mode==='public-read-only-health'&&observation.source_authority==='provider_public_endpoint',`${provider} observation scope drift`);
  assert(observation.credentialed===false&&observation.partnership_status==='not_asserted'&&observation.external_execution_performed===false,`${provider} observation boundary drift`);
  assert(observation.healthy===true&&observation.http_status===200,`${provider} provider is not healthy`);
  fresh(observation.observed_at,provider);
}
const circle=byProvider.get('circle');
assert(circle.endpoint==='https://api.circle.com/ping','Circle endpoint drift');
assert(circle.observed?.message==='pong','Circle ping response drift');
const arc=byProvider.get('arc');
assert(arc.endpoint==='https://rpc.testnet.arc.network','Arc endpoint drift');
assert(arc.network==='Arc Testnet'&&arc.observed?.chain_id===5042002,'Arc network identity drift');
assert(Number.isSafeInteger(arc.observed?.latest_block)&&arc.observed.latest_block>=0,'Arc latest block invalid');
assert(arc.observed?.currency==='USDC','Arc currency identity drift');

let evidenceArchive=null;
if(EVIDENCE_PATH){
  const base={
    schema:'numina.provider-evidence-archive.v1',
    archived_at:new Date().toISOString(),
    deployment:provenancePayload,
    deployment_receipt:provenance.receipt,
    observation_set:response.observation_set,
    observation_receipt:response.receipt,
    observation_receipt_sha256:digest(response.receipt),
    signing_key_id:PINNED_RUNTIME_KEY_ID,
    credentialed:false,
    partnership_status:'not_asserted',
    external_execution_performed:false,
    hash_scope:'canonical JSON of this archive excluding archive_sha256'
  };
  const archive_sha256=digest(base);
  const archive={...base,archive_sha256};
  const target=resolve(EVIDENCE_PATH);
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,JSON.stringify(archive,null,2)+'\n',{encoding:'utf8',mode:0o600});
  evidenceArchive={path:EVIDENCE_PATH,archive_sha256,observation_receipt_sha256:base.observation_receipt_sha256};
}

console.log(JSON.stringify({ok:true,deployment_id:provenancePayload.deployment_id,git_commit_sha:provenancePayload.git_commit_sha,expected_git_commit_sha:EXPECTED_GIT_SHA||null,provider_status:setPayload.status,providers:{circle:{healthy:circle.healthy,latency_ms:circle.latency_ms},arc:{healthy:arc.healthy,chain_id:arc.observed.chain_id,latest_block:arc.observed.latest_block,latency_ms:arc.latency_ms}},signing_key_id:PINNED_RUNTIME_KEY_ID,credentialed:false,partnership_status:'not_asserted',external_execution_performed:false,evidence_archive:evidenceArchive},null,2));
