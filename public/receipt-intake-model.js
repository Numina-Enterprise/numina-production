import {SIGNING_PINS} from './wallet-signing-model.js';
import {verifyOwnerDeploymentReceipt,RECEIPT_CALLS,MINIMUM_CONFIRMATIONS} from './wallet-execution-receipt.js';

export const MAX_RECEIPT_BYTES=2*1024*1024;
export const RECEIPT_INPUT_SCHEMA='numina.nusd.receipt-observation-input.v1';
export const RECEIPT_PROFILE='nusd-1500t-constructor-v3';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const sensitive=new Set(['privatekey','secretkey','seedphrase','recoveryphrase','mnemonic','password','ciphertext','crypto']);
function publicOnly(value,depth=0){
 if(depth>128)fail('RECEIPT_STRUCTURE_INVALID');
 if(!value||typeof value!=='object')return;
 for(const [key,item]of Object.entries(value)){
  if(sensitive.has(key.toLowerCase().replace(/[_ -]/g,'')))fail('PRIVATE_MATERIAL_NOT_ACCEPTED');
  publicOnly(item,depth+1);
 }
}

// Only the supplied public observations are checked. No wallet, RPC, journal,
// signature or submission API is available to this module.
export async function reviewReceiptText(text,{now=()=>Date.now()}={}){
 if(typeof text!=='string'||!text.trim())fail('RECEIPT_REQUIRED');
 if(text.length>MAX_RECEIPT_BYTES)fail('RECEIPT_TOO_LARGE');
 const bytes=new TextEncoder().encode(text);
 if(bytes.length>MAX_RECEIPT_BYTES)fail('RECEIPT_TOO_LARGE');
 let evidence;try{evidence=JSON.parse(text);}catch{fail('RECEIPT_JSON_INVALID');}
 if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))fail('RECEIPT_STRUCTURE_INVALID');
 publicOnly(evidence);
 if(evidence.schema!==RECEIPT_INPUT_SCHEMA)fail('RECEIPT_SCHEMA_UNSUPPORTED');
 if(evidence.profile!==RECEIPT_PROFILE)fail('RECEIPT_PROFILE_MISMATCH');
 const reviewedAt=new Date(now()).toISOString();
 const result=await verifyOwnerDeploymentReceipt(evidence);
 return {schema:'numina.nusd.receipt-intake-review.v1',reviewedAt,
  source:'user_supplied_public_chain_observations',inputSha256:await hash(bytes),inputBytes:bytes.length,
  profile:{chainName:'Numina blockchain',chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,
   asset:'NUSD',decimals:6,initialSupplyBaseUnits:SIGNING_PINS.initialSupplyBaseUnits,
   recipient:SIGNING_PINS.sender,minimumConfirmations:MINIMUM_CONFIRMATIONS,operation:'deployment_constructor_mint'},
  result,receiptAuthenticityVerified:false,signatureCreated:false,broadcast:false,
  treasuryWritePerformed:false,mintPerformed:false,depositPerformed:false};
}

export function receiptEvidenceTemplate(){
 return {schema:RECEIPT_INPUT_SCHEMA,profile:RECEIPT_PROFILE,status:'TEMPLATE_REQUIRES_ACTUAL_OBSERVATIONS',
  instructions:'Replace null fields with actual public observations from the same Numina-chain transaction. This template contains no receipt and proves no mint.',
  candidate:{chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,from:SIGNING_PINS.sender,
   to:null,value:'0',submittedHash:null,nonce:null,gasLimit:null,gasPrice:null,maximumFeeBaseUnits:null,data:null},
  transaction:null,receipt:null,canonicalBlock:null,headBlock:null,finalBlockReread:null,
  runtimeCode:{address:null,blockHash:null,code:null},
  calls:RECEIPT_CALLS.map(call=>({name:call.name,to:null,data:call.data,blockHash:null,result:null})),
  signingPerformed:false,broadcast:false,treasuryWritePerformed:false,mintPerformed:false,depositPerformed:false};
}
