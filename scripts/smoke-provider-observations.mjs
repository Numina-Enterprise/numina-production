import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {EXPECTED_RELEASE,RUNTIME_VERSION} from '../public/runtime-contract.js';

const require=createRequire(import.meta.url);
const {observeProvider,SUPPORTED_READ_ONLY_PROVIDERS}=require('../runtime/vercel-production/lib/provider-observations.js');

const EXPECTED_REPOSITORY='skott34-dot/numina-production';
const EXPECTED_GIT_SHA=(process.env.NUMINA_EXPECTED_GIT_SHA||process.env.GITHUB_SHA||'').trim();
const EVIDENCE_PATH=(process.env.NUMINA_PROVIDER_EVIDENCE_PATH||'').trim();
const MAX_AGE_MS=5*60*1000,MAX_FUTURE_SKEW_MS=60*1000;
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
const canonical=value=>Buffer.from(JSON.stringify(sorted(value)),'utf8');
const digest=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
function fresh(timestamp,label){const time=Date.parse(timestamp);assert(Number.isFinite(time),label+' timestamp invalid');const age=Date.now()-time;assert(age<=MAX_AGE_MS,label+' observation is stale');assert(age>=-MAX_FUTURE_SKEW_MS,label+' observation timestamp is too far in the future');}

assert(/^[0-9a-f]{40}$/i.test(EXPECTED_GIT_SHA),'current GitHub source commit is required');
if(process.env.GITHUB_REPOSITORY)assert(process.env.GITHUB_REPOSITORY===EXPECTED_REPOSITORY,'unexpected GitHub repository');
const gitRef=process.env.GITHUB_REF_NAME||'main';
assert(gitRef==='main','provider evidence must be bound to main');

const observations=await Promise.all(SUPPORTED_READ_ONLY_PROVIDERS.map(provider=>observeProvider(provider)));
const allHealthy=observations.every(item=>item.healthy===true);
const observedAt=new Date().toISOString();
const observationSet={
  schema:'numina.provider-observation-set.v1',
  release:RUNTIME_VERSION,
  manifest:'numina.manifest.v2',
  mode:'public-read-only-health',
  source_authority:'provider_public_endpoints',
  credentialed:false,
  partnership_status:'asserted',
  external_execution_performed:false,
  observed_at:observedAt,
  providers:SUPPORTED_READ_ONLY_PROVIDERS,
  observation_count:observations.length,
  all_healthy:allHealthy,
  status:allHealthy?'HEALTHY':'DEGRADED',
  observations
};
assert(observationSet.status==='HEALTHY','provider observation set degraded');
fresh(observationSet.observed_at,'provider set');
const byProvider=new Map(observations.map(item=>[item.provider,item])),circle=byProvider.get('circle'),arc=byProvider.get('arc');
for(const item of [circle,arc]){assert(item?.schema==='numina.provider-observation.v1'&&item.healthy===true&&item.http_status===200,'provider observation invalid');assert(item.credentialed===false&&item.external_execution_performed===false,'provider execution boundary mismatch');fresh(item.observed_at,item.provider);}
assert(circle.endpoint==='https://api.circle.com/ping'&&circle.observed?.message==='pong','Circle observation mismatch');
assert(arc.endpoint==='https://rpc.testnet.arc.network'&&arc.observed?.chain_id===5042002&&Number.isSafeInteger(arc.observed?.latest_block)&&arc.observed?.currency==='USDC','Arc observation mismatch');

const transportObservation={
  schema:'numina.transport-observation.v2',
  root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',host:'NUMINA',provenance:'NUMINA',deployment:'NUMINA',
  transport:'github',authoritative:true,environment:'production',
  host_url:'https://github.com/'+EXPECTED_REPOSITORY,
  transport_url:'https://github.com/'+EXPECTED_REPOSITORY+'/commit/'+EXPECTED_GIT_SHA,
  deployment_id:process.env.GITHUB_RUN_ID||null,
  git_commit_sha:EXPECTED_GIT_SHA,
  git_commit_ref:'main',
  runtime_release:EXPECTED_RELEASE.production_version,
  release:EXPECTED_RELEASE.release
};
const base={
  schema:'numina.provider-evidence-archive.v3',
  root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',
  archived_at:new Date().toISOString(),source_commit:EXPECTED_GIT_SHA,
  integrity_model:'github_commit_plus_release_sha256_readback',
  transport:{identity:'NUMINA',role:'diagnostic_only',verified:true,current_expected_commit:true,observation:transportObservation},
  observation_set:observationSet,
  credentialed:false,partnership_status:'asserted',external_execution_performed:false,
  hash_scope:'canonical JSON of this archive excluding archive_sha256'
};
const archive_sha256=digest(base),archive={...base,archive_sha256};
let evidenceArchive=null;
if(EVIDENCE_PATH){const target=resolve(EVIDENCE_PATH);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(archive,null,2)+'\n',{encoding:'utf8',mode:0o600});evidenceArchive={path:EVIDENCE_PATH,archive_sha256};}
console.log(JSON.stringify({ok:true,root:'NUMINA',manifest:'NUMINA',source_commit:EXPECTED_GIT_SHA,transport:{kind:'github',current_expected_commit:true,run_id:transportObservation.deployment_id},provider_status:observationSet.status,providers:{circle:{healthy:circle.healthy,latency_ms:circle.latency_ms},arc:{healthy:arc.healthy,chain_id:arc.observed.chain_id,latest_block:arc.observed.latest_block,latency_ms:arc.latency_ms}},credentialed:false,partnership_status:'asserted',external_execution_performed:false,evidence_archive:evidenceArchive},null,2));
