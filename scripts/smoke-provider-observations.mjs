import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {PINNED_RUNTIME_KEY_ID,PINNED_RUNTIME_PUBLIC_KEY,RUNTIME_ORIGIN,RUNTIME_VERSION} from '../public/runtime-contract.js';

const EXPECTED_GIT_SHA=(process.env.NUMINA_EXPECTED_GIT_SHA||'').trim(),EVIDENCE_PATH=(process.env.NUMINA_PROVIDER_EVIDENCE_PATH||'').trim();
const SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex'),MAX_BYTES=262144,MAX_AGE_MS=5*60*1000,MAX_FUTURE_SKEW_MS=60*1000;
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
const canonical=value=>Buffer.from(JSON.stringify(sorted(value)),'utf8');
const digest=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
const sameJson=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
function verifyEnvelope(envelope,expectedType){assert(envelope&&typeof envelope==='object','signed envelope missing');assert(envelope.artifact_type===expectedType,`unexpected artifact type: ${envelope.artifact_type}`);assert(envelope.algorithm==='Ed25519'&&envelope.key_id===PINNED_RUNTIME_KEY_ID&&envelope.public_key===PINNED_RUNTIME_PUBLIC_KEY,'runtime signing identity drift');const raw=Buffer.from(PINNED_RUNTIME_PUBLIC_KEY,'base64');assert(raw.length===32&&createHash('sha256').update(raw).digest('hex').slice(0,24)===PINNED_RUNTIME_KEY_ID,'pinned key invalid');const publicKey=createPublicKey({key:Buffer.concat([SPKI_PREFIX,raw]),format:'der',type:'spki'});assert(verifySignature(null,canonical({artifact_type:envelope.artifact_type,key_id:envelope.key_id,payload:envelope.payload}),publicKey,Buffer.from(envelope.signature||'','base64')),'signature verification failed');return envelope.payload;}
async function get(path){const response=await fetch(RUNTIME_ORIGIN+path,{headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});assert(response.status===200,`${path} returned ${response.status}`);assert((response.headers.get('content-type')||'').toLowerCase().includes('application/json'),`${path} returned non-JSON`);const text=await response.text();assert(Buffer.byteLength(text,'utf8')<=MAX_BYTES,`${path} response too large`);return JSON.parse(text);}
function fresh(timestamp,label){const time=Date.parse(timestamp);assert(Number.isFinite(time),`${label} timestamp invalid`);const age=Date.now()-time;assert(age<=MAX_AGE_MS,`${label} observation is stale`);assert(age>=-MAX_FUTURE_SKEW_MS,`${label} observation timestamp is too far in the future`);}

if(EXPECTED_GIT_SHA)assert(/^[0-9a-f]{40}$/i.test(EXPECTED_GIT_SHA),'NUMINA_EXPECTED_GIT_SHA must be a full Git SHA');
const transportResponse=await get('/v1/deployment/provenance');
const transportObservation=verifyEnvelope(transportResponse.receipt,'NUMINA_TRANSPORT_OBSERVATION');
assert(sameJson(transportObservation,transportResponse.transport?.observation),'transport observation receipt mismatch');
assert(transportResponse.root==='NUMINA'&&transportResponse.manifest==='NUMINA'&&transportResponse.deployment==='NUMINA'&&transportResponse.deployed===true,'transport response changed NUMINA');
assert(transportResponse.transport?.role==='diagnostic_only','transport observation is not diagnostic only');
const sourceCommit=EXPECTED_GIT_SHA||String(transportObservation.git_commit_sha||'');
assert(/^[0-9a-f]{40}$/i.test(sourceCommit),'source commit unavailable');
const transportCurrent=transportObservation.git_commit_sha?.toLowerCase()===sourceCommit.toLowerCase();

const response=await get('/v1/execution/providers?mode=health-all');
const signedSetPayload=verifyEnvelope(response.receipt,'NUMINA_PROVIDER_OBSERVATION_SET');
assert(sameJson(signedSetPayload,response.observation_set),'provider observation set receipt mismatch');
const projected=Boolean(signedSetPayload?.payload&&typeof signedSetPayload.payload==='object');
if(projected){for(const field of ['root','manifest','identity','authority','source','evidence','provider'])assert(signedSetPayload[field]==='NUMINA',`provider observation ${field} drift`);assert(signedSetPayload.productionSource==='NUMINA'&&signedSetPayload.surface==='provider-observations','provider observation projection drift');}
const setPayload=projected?signedSetPayload.payload:signedSetPayload;
assert(setPayload.schema==='numina.provider-observation-set.v1'&&setPayload.release===RUNTIME_VERSION,'provider observation identity drift');
assert(setPayload.mode==='public-read-only-health'&&setPayload.source_authority==='provider_public_endpoints','provider source scope drift');
assert(setPayload.credentialed===false&&setPayload.partnership_status==='asserted'&&setPayload.external_execution_performed===false,'provider observation boundary drift');
assert(setPayload.status==='HEALTHY'&&setPayload.all_healthy===true,'provider observation set degraded');fresh(setPayload.observed_at,'provider set');
assert(Array.isArray(setPayload.providers)&&setPayload.providers.join(',')==='arc,circle','provider identity drift');
const byProvider=new Map((setPayload.observations||[]).map(item=>[item.provider,item])),circle=byProvider.get('circle'),arc=byProvider.get('arc');
for(const item of [circle,arc]){assert(item?.schema==='numina.provider-observation.v1'&&item.healthy===true&&item.http_status===200,'provider observation invalid');assert(item.credentialed===false&&item.external_execution_performed===false,'provider execution boundary drift');fresh(item.observed_at,item.provider);}
assert(circle.endpoint==='https://api.circle.com/ping'&&circle.observed?.message==='pong','Circle observation drift');
assert(arc.endpoint==='https://rpc.testnet.arc.network'&&arc.observed?.chain_id===5042002&&Number.isSafeInteger(arc.observed?.latest_block)&&arc.observed?.currency==='USDC','Arc observation drift');

let evidenceArchive=null;
if(EVIDENCE_PATH){
  const base={schema:'numina.provider-evidence-archive.v2',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',
    archived_at:new Date().toISOString(),source_commit:sourceCommit,
    transport:{identity:'NUMINA',role:'diagnostic_only',verified:transportResponse.transport?.verified===true,current_expected_commit:transportCurrent,observation:transportObservation,receipt:transportResponse.receipt},
    observation_set:response.observation_set,observation_receipt:response.receipt,observation_receipt_sha256:digest(response.receipt),signing_key_id:PINNED_RUNTIME_KEY_ID,
    credentialed:false,partnership_status:'asserted',external_execution_performed:false,hash_scope:'canonical JSON of this archive excluding archive_sha256'};
  const archive_sha256=digest(base),archive={...base,archive_sha256},target=resolve(EVIDENCE_PATH);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(archive,null,2)+'\n',{encoding:'utf8',mode:0o600});
  evidenceArchive={path:EVIDENCE_PATH,archive_sha256,observation_receipt_sha256:base.observation_receipt_sha256};
}
console.log(JSON.stringify({ok:true,root:'NUMINA',manifest:'NUMINA',source_commit:sourceCommit,transport:{current_expected_commit:transportCurrent,deployment_id:transportObservation.deployment_id??null,observed_git_commit_sha:transportObservation.git_commit_sha??null},provider_status:setPayload.status,providers:{circle:{healthy:circle.healthy,latency_ms:circle.latency_ms},arc:{healthy:arc.healthy,chain_id:arc.observed.chain_id,latest_block:arc.observed.latest_block,latency_ms:arc.latency_ms}},signing_key_id:PINNED_RUNTIME_KEY_ID,credentialed:false,partnership_status:'asserted',external_execution_performed:false,evidence_archive:evidenceArchive},null,2));
