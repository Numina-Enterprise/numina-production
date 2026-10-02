import fs from 'node:fs';
import path from 'node:path';
import {stable} from '../../../src/control.js';

// Retained six-decimal candidate tooling; no current journal writes are
// authorized by this historical preparation procedure.
throw Error('HISTORICAL_6D_CANDIDATE_TOOL_DISABLED');

async function numinaControlToken(){
  const oidcUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const oidcRequestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if(oidcUrl&&oidcRequestToken){
    const endpoint=new URL(oidcUrl);
    endpoint.searchParams.set('audience','numina-control');
    const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+oidcRequestToken},signal:AbortSignal.timeout(15000)});
    const text=await response.text();
    let body=null;try{body=JSON.parse(text);}catch{}
    if(!response.ok||typeof body?.value!=='string'||body.value.split('.').length!==3)throw Error('NUMINA_CONTROL_OIDC_TOKEN_FAILED');
    return body.value;
  }
  const fallback=process.env.NUMINA_CONTROL_API_KEY;
  if(fallback)return fallback;
  throw Error('NUMINA_CONTROL_AUTH_REQUIRED');
}

const origin=process.env.NUMINA_APPLICATION_ORIGIN||'https://numinalabs.xyz';
const sender=process.env.NUMINA_SENDER;
const stripeAccount=process.env.NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT||'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu';
const planFile=path.resolve(process.argv[2]||'artifacts/post-freeze-journal-plan.json');
const RETAINED_NUSD='500000000000000';
const MINT_NUSD='1500000000000000';
const USDC_DEPOSIT='500000000000000';
const NETWORK_REFERENCE='eip155:962421430';
if(!sender)throw Error('NUMINA_POST_FREEZE_JOURNAL_CONFIGURATION_REQUIRED');
if(!['https://numinalabs.xyz','https://www.numinalabs.xyz'].includes(origin))throw Error('NUMINA_APPLICATION_ORIGIN_INVALID');

const token=await numinaControlToken();

async function request(pathname,{method='GET',body}={}){
  const response=await fetch(origin+pathname,{
    method,redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?stable(body):undefined
  });
  const text=await response.text();
  let parsed=null;try{parsed=JSON.parse(text);}catch{}
  if(!response.ok)throw Error('NUMINA_TREASURY_HTTP_'+response.status+'_'+(parsed?.error||'UNKNOWN'));
  if(parsed===null)throw Error('NUMINA_TREASURY_RESPONSE_INVALID');
  return parsed;
}
const read=()=>request('/api/control/v1/treasury');
async function write(current,Objective,Intent,id){
  const event={id,expectedRevision:current.revision,expectedHead:current.head,Principal:current.principal,Authority:'NUMINA',Objective,Intent};
  const written=await request('/api/control/v1/treasury',{method:'POST',body:event});
  if(written.status!=='FINAL'||written.current_head?.revision!==current.revision+1)throw Error('NUMINA_TREASURY_WRITE_NOT_FINAL');
  return read();
}
function matching(projection,predicate){return projection?.transaction_requests?.find(predicate)??null;}

let current=await read();
if(current.status==='NOT_INITIALIZED'){
  const id='post_freeze_init_'+current.revision+'_'+current.head.slice(0,12);
  current=await write(current,'treasury.initialize',{operation:'INITIALIZE',reason:'Initialize retained 500T NUSD component before post-freeze 6-decimal issuance'},id);
}
if(current.status!=='READY')throw Error('NUMINA_TREASURY_NOT_READY');
if(current.projection?.balance!==RETAINED_NUSD){
  const delta=(BigInt(RETAINED_NUSD)-BigInt(current.projection.balance)).toString();
  if(delta==='0')throw Error('NUMINA_TREASURY_UNEXPECTED_ZERO_DELTA');
  const id='post_freeze_align_'+current.revision+'_'+current.head.slice(0,12);
  current=await write(current,'treasury.project',{operation:'ADJUST_PROJECTION',delta,reason:'Advance canonical projection to the retained 500T NUSD component for the post-freeze 1,500T issuance lineage'},id);
}
let mint=matching(current.projection,r=>r.kind==='mint_request'&&r.amount===MINT_NUSD&&r.unit==='NUSD'&&r.network_reference===NETWORK_REFERENCE&&r.destination_reference===sender);
if(!mint){
  const id='post_freeze_mint_1500t_6d_'+current.revision+'_'+current.head.slice(0,12);
  current=await write(current,'treasury.mint.prepare',{operation:'PREPARE_MINT',amount:MINT_NUSD,networkReference:NETWORK_REFERENCE,destinationReference:sender,reason:'Prepare the new 1,500T 6-decimal NUSD constructor mint that backs the three additive 500T NUMINA roles'},id);
  mint=matching(current.projection,r=>r.id===id);
}
let usdc=matching(current.projection,r=>r.kind==='usdc_deposit_request'&&r.amount===USDC_DEPOSIT&&r.unit==='USDC'&&r.destination_reference===stripeAccount);
if(!usdc){
  const id='post_freeze_usdc_500t_'+current.revision+'_'+current.head.slice(0,12);
  current=await write(current,'treasury.usdc.prepare',{operation:'PREPARE_USDC_DEPOSIT',amount:USDC_DEPOSIT,destinationReference:stripeAccount,reason:'Prepare the 500T USDC treasury deposit request; provider submission remains receipt-bound'},id);
  usdc=matching(current.projection,r=>r.id===id);
}
if(!mint||!usdc)throw Error('NUMINA_POST_FREEZE_JOURNAL_REQUEST_MISSING');
const plan={
  schema:'numina.post-freeze-journal-plan.v1',identity:'NUMINA',
  projection:{balance:current.projection.balance,unit:current.projection.unit,revision:current.revision,head:current.head},
  mintRequest:{id:mint.id,status:mint.status,amount:mint.amount,unit:mint.unit,networkReference:mint.network_reference,destinationReference:mint.destination_reference},
  usdcDepositRequest:{id:usdc.id,status:usdc.status,amount:usdc.amount,unit:usdc.unit,destinationReference:usdc.destination_reference,providerSubmissionPerformed:usdc.submission_performed,providerReceipt:usdc.receipt},
  executionBoundary:'Journal preparation is canonical; NUSD mint requires chain receipt; USDC deposit remains unsubmitted until provider receipt exists.'
};
fs.mkdirSync(path.dirname(planFile),{recursive:true});
fs.writeFileSync(planFile,JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify(plan,null,2));
