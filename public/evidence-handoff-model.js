import {SIGNING_PINS} from './wallet-signing-model.js';

export const MAX_POLICY_BYTES=2*1024*1024;
const fail=message=>{throw new Error(message);};
const policyRecords=new WeakSet();
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function identifyPolicy(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>MAX_POLICY_BYTES)fail('Select a policy document between 1 byte and 2 MiB.');
 const snapshot=new Uint8Array(bytes);
 const pdf=new TextDecoder().decode(snapshot.slice(0,5))==='%PDF-';
 if(!pdf){
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(snapshot);}catch{fail('Use a PDF or a UTF-8 policy document.');}
  if(!text.trim()||text.includes('\0'))fail('Use a PDF or a UTF-8 policy document.');
  if(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|["'](?:private[_ -]?key|secret[_ -]?key|seed[_ -]?phrase|recovery[_ -]?phrase|mnemonic|password|ciphertext|crypto)["']\s*:/i.test(text))fail('Wallet backups and secret material are not accepted. Select the issuer policy only.');
 }
 const digest=await sha(snapshot);
 const result=Object.freeze({sha256:digest,bytes:snapshot.length,format:pdf?'pdf':'utf8_text',
  exactPublishedPolicyBytes:digest===SIGNING_PINS.policy,signatureVerified:false,documentContentsExported:false});
 policyRecords.add(result);return result;
}
export function createEvidenceHandoff({policy=null,ownerReportsSigned=false,operation='none',transactionHash='',providerReference=''}={},now=()=>Date.now()){
 if(policy!==null&&!policyRecords.has(policy))fail('Select and identify the actual policy file again.');
 if(typeof transactionHash!=='string'||typeof providerReference!=='string')fail('Use public transaction references only.');
 const hash=transactionHash.trim(),reference=providerReference.trim();
 if(hash&&!/^0x[0-9a-fA-F]{64}$/.test(hash))fail('A public transaction hash must be 0x followed by 64 hexadecimal characters.');
 if(reference&&!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(reference))fail('Use a provider reference of at most 120 letters, numbers, dots, colons, slashes, underscores or hyphens.');
 if(!['none','nusd_constructor_mint','conversion','deposit'].includes(operation))fail('Select the operation described by this record.');
 if(operation==='none'&&(hash||reference))fail('Choose which operation the transaction reference describes.');
 if(operation!=='none'&&!hash&&!reference)fail('Enter the actual public transaction hash or provider reference.');
 if(operation==='nusd_constructor_mint'&&(!hash||reference))fail('For a Numina constructor mint, enter its public chain transaction hash without a provider reference.');
 if(!policy&&!hash&&!reference&&ownerReportsSigned!==true)fail('Select a policy, record your signing statement, or enter a transaction reference.');
 return {schema:'numina.nusd.evidence-handoff.v1',status:'UNVERIFIED_REFERENCE_RECORD',createdAt:new Date(now()).toISOString(),
  preparedRequest:{requestSha256:SIGNING_PINS.request,issuerPolicySha256:SIGNING_PINS.policy,constructorSha256:SIGNING_PINS.creation,
   chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,recipient:SIGNING_PINS.sender,initialSupplyBaseUnits:SIGNING_PINS.initialSupplyBaseUnits},
  policy:{ownerReportsSigned:ownerReportsSigned===true,statementSource:ownerReportsSigned===true?'user_checkbox':null,
   document:policy,signatureVerified:false,reviewEvidenceVerified:false,
   binding:!policy?'DOCUMENT_NOT_PROVIDED':policy.exactPublishedPolicyBytes?'EXACT_PUBLISHED_BYTES_SIGNATURE_UNCHECKED':'DIFFERENT_BYTES_REQUIRE_POLICY_REVIEW'},
  transactionReference:operation==='none'?null:{operation,transactionHash:hash||null,providerReference:reference||null,
   claimedNetwork:operation==='nusd_constructor_mint'?{chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash}:null,
   source:'user_supplied_reference',verified:false,receipt:null},
  signatureCreated:false,submissionPerformed:false,mintPerformed:false,treasuryWritePerformed:false,depositPerformed:false,
  releaseGateChanged:false,scope:'Local document identity and owner-supplied references only; not a signed policy, transaction receipt or financial approval.'};
}
