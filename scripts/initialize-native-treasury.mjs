import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EXPECTED_RELEASE} from '../public/runtime-contract.js';
import {stable} from '../src/control.js';
const origin=process.env.NUMINA_APPLICATION_ORIGIN;
const token=process.env.NUMINA_CONTROL_API_KEY;
const id=process.env.NUMINA_TREASURY_EVENT_ID;
if(!['https://numinalabs.xyz','https://www.numinalabs.xyz'].includes(origin)||!token||!/^[A-Za-z0-9_-]{1,100}$/.test(id??''))throw Error('Set the canonical application origin, owner API key and stable treasury event ID');
const gate=spawnSync(process.execPath,[fileURLToPath(new URL('./check-runtime.mjs',import.meta.url))],{encoding:'utf8'});
if(gate.status!==0){console.error('rc26 runtime verification failed; no treasury write attempted.');process.exit(1);}
async function read(path,authorized=false){
  const response=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json',...(authorized?{Authorization:'Bearer '+token}:{})}});
  if(!response.ok)throw Error('Treasury preparation failed: HTTP '+response.status);
  return response.json();
}
const application=await read('/v2/release/manifest');
if(application.runtime_dependency?.version!==EXPECTED_RELEASE.production_version||application.runtime_dependency?.release!==EXPECTED_RELEASE.release)throw Error('Application does not target rc26');
const current=await read('/api/control/v1/treasury',true);
if(current.status==='READY'){console.log('Canonical treasury is already initialized; no write attempted.');process.exit(0);}
if(current.schema!=='numina.treasury.v1'||current.status!=='NOT_INITIALIZED'||typeof current.root!=='string'||!Number.isSafeInteger(current.revision)||!/^[a-f0-9]{64}$/.test(current.head))throw Error('Existing canonical root and head could not be established');
const event={id,expectedRevision:current.revision,expectedHead:current.head,Principal:current.root,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Apply the frozen Numina-native treasury model to the existing canonical journal'}};
const response=await fetch(origin+'/api/control/v1/treasury',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:stable(event)});
if(!response.ok)throw Error('Initialization was not confirmed: HTTP '+response.status+'; read the canonical treasury before retrying');
const confirmed=await read('/api/control/v1/treasury',true);
if(confirmed.status!=='READY'||confirmed.projection?.last_event_id!==id)throw Error('Initialization needs journal review');
console.log(JSON.stringify({status:confirmed.status,scope:confirmed.verification_scope,projection:confirmed.projection,head:confirmed.head,revision:confirmed.revision},null,2));
