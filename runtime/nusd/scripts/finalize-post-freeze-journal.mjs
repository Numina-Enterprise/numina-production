import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stable} from '../../../src/control.js';

async function numinaControlToken(){
  const authUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const authRequestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if(authUrl&&authRequestToken){
    const endpoint=new URL(authUrl);
    endpoint.searchParams.set('audience','numina-control');
    const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+authRequestToken},signal:AbortSignal.timeout(15000)});
    const text=await response.text();
    let body=null;try{body=JSON.parse(text);}catch{}
    if(!response.ok||typeof body?.value!=='string'||body.value.split('.').length!==3)throw Error('NUMINA_CONTROL_AUTH_TOKEN_FAILED');
    return body.value;
  }
  const fallback=process.env.NUMINA_CONTROL_API_KEY;
  if(fallback)return fallback;
  throw Error('NUMINA_CONTROL_AUTH_REQUIRED');
}

const origin=process.env.NUMINA_APPLICATION_ORIGIN||'https://numinalabs.xyz';
const planFile=path.resolve(process.argv[2]||'artifacts/post-freeze-journal-plan.json');
const receiptFile=path.resolve(process.argv[3]||'deployment-receipt.json');
const outputFile=path.resolve(process.argv[4]||'artifacts/post-freeze-journal-finalization.json');
const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
const receiptBytes=fs.readFileSync(receiptFile);
const receipt=JSON.parse(receiptBytes.toString('utf8'));
const txHash=receipt?.token?.transactionHash;
if(!/^0x[0-9a-fA-F]{64}$/.test(txHash||''))throw Error('NUMINA_6D_MINT_RECEIPT_REQUIRED');
if(receipt?.issuance?.decimals!==6||receipt?.issuance?.amountNusd!=='1500000000000000')throw Error('NUMINA_6D_MINT_RECEIPT_MISMATCH');
const digest='sha256:'+createHash('sha256').update(receiptBytes).digest('hex');

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
  const event={id,expectedRevision:current.revision,expectedHead:current.head,Principal:current.root,Authority:'NUMINA',Objective,Intent};
  const written=await request('/api/control/v1/treasury',{method:'POST',body:event});
  if(written.status!=='FINAL')throw Error('NUMINA_TREASURY_WRITE_NOT_FINAL');
  return read();
}
function find(current){return current.projection?.transaction_requests?.find(r=>r.id===plan.mintRequest.id)??null;}

let current=await read();
let mint=find(current);
if(!mint)throw Error('NUMINA_MINT_REQUEST_NOT_FOUND');
if(mint.status==='PREPARED'){
  current=await write(current,'treasury.external.receipt.bind',{
    operation:'BIND_EXTERNAL_RECEIPT',requestId:mint.id,provider:'NUMINA_CHAIN',providerReference:txHash,evidenceDigest:digest,
    reason:'Bind the verified 6-decimal NuminaUSD deployment receipt to the canonical post-freeze mint request'
  },'bind_'+mint.id);
  mint=find(current);
}
if(mint.status==='EVIDENCE_BOUND'){
  current=await write(current,'treasury.receipt.confirm',{
    operation:'CONFIRM_NUMINA_RECEIPT',requestId:mint.id,
    reason:'Confirm the canonical NUMINA chain receipt for the post-freeze 6-decimal mint request'
  },'confirm_'+mint.id);
  mint=find(current);
}
if(mint.status!=='RECONCILED'||mint.receipt?.provider_reference?.toLowerCase()!==txHash.toLowerCase())throw Error('NUMINA_MINT_JOURNAL_RECONCILIATION_FAILED');
const usdc=current.projection?.transaction_requests?.find(r=>r.id===plan.usdcDepositRequest.id)??null;
if(!usdc||usdc.status!=='PREPARED'||usdc.submission_performed!==false||usdc.receipt!==null)throw Error('NUMINA_USDC_PROVIDER_BOUNDARY_VIOLATED');
const result={
  schema:'numina.post-freeze-journal-finalization.v1',identity:'NUMINA',
  mintRequest:{id:mint.id,status:mint.status,providerReference:mint.receipt.provider_reference,evidenceDigest:mint.receipt.evidence_digest},
  usdcDepositRequest:{id:usdc.id,status:usdc.status,submissionPerformed:false,providerReceipt:null},
  projection:{balance:current.projection.balance,unit:current.projection.unit,revision:current.revision,head:current.head}
};
fs.mkdirSync(path.dirname(outputFile),{recursive:true});
fs.writeFileSync(outputFile,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
