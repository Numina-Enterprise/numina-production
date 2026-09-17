import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EXPECTED_RELEASE} from '../public/runtime-contract.js';
import {stable} from '../src/control.js';
import {NUMINA_TREASURY_INITIAL_BALANCE} from '../src/native-treasury-model.js';

const origin=process.env.NUMINA_APPLICATION_ORIGIN;
const token=process.env.NUMINA_CONTROL_API_KEY;
const target=NUMINA_TREASURY_INITIAL_BALANCE;

if(!['https://numinalabs.xyz','https://www.numinalabs.xyz'].includes(origin)||!token){
  throw Error('Set the canonical application origin and owner API key');
}

// This operator intentionally targets 500T when invoked. The 500T amount is the
// current modeled Numina-native projection, not an immutable treasury invariant;
// the canonical ADJUST_PROJECTION path remains authorized to change it later.
// Verify the current signed production contract before touching the canonical journal.
// This gate intentionally checks runtime/canonical convergence rather than requiring
// the Vercel deployment SHA to equal the workflow SHA; deployment freshness is enforced
// separately by production smoke CI and may be rate-limit blocked.
const gate=spawnSync(process.execPath,[fileURLToPath(new URL('./smoke-production.mjs',import.meta.url))],{
  encoding:'utf8',
  env:{...process.env,NUMINA_CONTROL_API_KEY:'',NUMINA_EXPECTED_GIT_SHA:''}
});
if(gate.status!==0){
  if(gate.stdout)console.error(gate.stdout.trim());
  if(gate.stderr)console.error(gate.stderr.trim());
  console.error('configured signed production verification failed; no treasury write attempted.');
  process.exit(1);
}

async function read(path){
  const response=await fetch(origin+path,{
    redirect:'error',
    signal:AbortSignal.timeout(15000),
    headers:{Accept:'application/json',Authorization:'Bearer '+token}
  });
  if(!response.ok)throw Error('Treasury read failed: HTTP '+response.status);
  return response.json();
}

const application=await (async()=>{
  const response=await fetch(origin+'/v4/release/manifest',{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('Release manifest unavailable: HTTP '+response.status);
  return response.json();
})();
if(application.runtime_dependency?.version!==EXPECTED_RELEASE.production_version||application.runtime_dependency?.release!==EXPECTED_RELEASE.release){
  throw Error('Application does not target configured production');
}

const current=await read('/api/control/v1/treasury');
if(current.schema!=='numina.treasury.v1'||typeof current.root!=='string'||!current.root||!Number.isSafeInteger(current.revision)||!/^[a-f0-9]{64}$/.test(current.head)){
  throw Error('Canonical treasury root and head could not be established');
}

if(current.status==='READY'){
  if(current.projection?.unit!=='NUSD'||typeof current.projection.balance!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(current.projection.balance)){
    throw Error('Canonical treasury projection is invalid');
  }
  if(current.projection.balance===target){
    console.log(JSON.stringify({status:'ALIGNED',balance:target,unit:'NUSD',revision:current.revision,head:current.head,writePerformed:false,modeledAmount:true,invariant:false},null,2));
    process.exit(0);
  }
}else if(current.status!=='NOT_INITIALIZED'){
  throw Error('Canonical treasury status is not writable');
}

const id=`treasury_align_500t_${current.revision}_${current.head.slice(0,16)}`;
let Objective,Intent;
if(current.status==='NOT_INITIALIZED'){
  Objective='treasury.initialize';
  Intent={operation:'INITIALIZE',reason:'Initialize the canonical Numina-native treasury at the current modeled 500T NUSD amount; this is a mutable projection, not an invariant'};
}else{
  const delta=(BigInt(target)-BigInt(current.projection.balance)).toString();
  if(delta==='0')throw Error('Unexpected zero treasury delta');
  Objective='treasury.project';
  Intent={operation:'ADJUST_PROJECTION',delta,reason:'Apply the approved force-to-500T operator to the current mutable Numina-native treasury projection'};
}

const event={
  id,
  expectedRevision:current.revision,
  expectedHead:current.head,
  Principal:current.root,
  Authority:'NUMINA',
  Objective,
  Intent
};

const response=await fetch(origin+'/api/control/v1/treasury',{
  method:'POST',
  redirect:'error',
  signal:AbortSignal.timeout(15000),
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},
  body:stable(event)
});
if(!response.ok)throw Error('Treasury alignment was not confirmed: HTTP '+response.status);
const written=await response.json();
if(written.status!=='FINAL'||written.projection?.balance!==target||written.projection?.unit!=='NUSD'||written.projection?.last_event_id!==id){
  throw Error('Treasury alignment response failed verification');
}

const confirmed=await read('/api/control/v1/treasury');
if(confirmed.status!=='READY'||confirmed.projection?.balance!==target||confirmed.projection?.unit!=='NUSD'||confirmed.projection?.last_event_id!==id||confirmed.revision!==current.revision+1||confirmed.head!==written.current_head?.head){
  throw Error('Treasury alignment readback failed verification');
}

console.log(JSON.stringify({
  status:'ALIGNED',
  balance:confirmed.projection.balance,
  unit:confirmed.projection.unit,
  revision:confirmed.revision,
  head:confirmed.head,
  eventId:id,
  writePerformed:true,
  replayed:written.replayed===true,
  modeledAmount:true,
  invariant:false
},null,2));
