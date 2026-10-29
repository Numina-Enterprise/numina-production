import {walletBackup} from './local-wallet-policy.js';
import {SIGNING_PINS,QUOTE_TTL_MS,isValidatedSigningReview} from './wallet-signing-model.js';

export const LOCAL_ESTIMATE_PATH='/v2/network/deployment-estimate';
const MAX_UINT256=(1n<<256n)-1n,MAX_RESPONSE_BYTES=16384,quotes=new WeakSet(),backups=new WeakSet();
const fail=code=>{throw Object.assign(new Error(code),{code});};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const decimal=value=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(value)||BigInt(value)>MAX_UINT256)fail('INVALID_ESTIMATE');return BigInt(value);};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
function fresh(quote,now){
 if(!Number.isSafeInteger(now)||now<0)fail('INVALID_CLOCK');
 const observed=Date.parse(quote.observedAt),expires=Date.parse(quote.expiresAt);
 if(!Number.isSafeInteger(observed)||!Number.isSafeInteger(expires)||new Date(observed).toISOString()!==quote.observedAt||new Date(expires).toISOString()!==quote.expiresAt||expires-observed!==QUOTE_TTL_MS||observed>now+5000||now>=expires)fail('QUOTE_EXPIRED');
}
// A keystore's unencrypted address is metadata, not evidence of password or key control.
export function inspectLocalWalletBackup(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>8192)fail('INVALID_BACKUP');
 let value;try{value=JSON.parse(text);walletBackup({address:'0x'+value.address,keystore:text});}catch{fail('INVALID_BACKUP');}
 if(('0x'+value.address).toLowerCase()!==SIGNING_PINS.sender.toLowerCase())fail('BACKUP_ACCOUNT_MISMATCH');
 const result=Object.freeze({address:SIGNING_PINS.sender,backupFormatChecked:true,signingControlVerified:false});backups.add(result);return result;
}
export function validateLocalEstimate(value,now=Date.now()){
 if(!value||value.schema!=='numina.deployment-estimate.v1'||value.status!=='observed')fail('ESTIMATE_UNAVAILABLE');
 const expected={account:SIGNING_PINS.sender.toLowerCase(),chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,constructorDataSha256:SIGNING_PINS.creation,reviewSha256:SIGNING_PINS.review,requestSha256:SIGNING_PINS.request,requestHashBasis:'raw_request_file_bytes',issuerPolicySha256:SIGNING_PINS.policy,artifactSha256:SIGNING_PINS.artifact,sourceSha256:SIGNING_PINS.source,initialSupplyBaseUnits:SIGNING_PINS.initialSupplyBaseUnits,observationSource:'configured_numina_rpc'};
 for(const [key,wanted] of Object.entries(expected))if((key==='account'?value[key]?.toLowerCase():value[key])!==wanted)fail('ESTIMATE_MISMATCH');
 for(const key of ['feeAssetVerified','productionReady','estimateVerified','signingControlVerified','networkIdentityVerified','reviewEvidenceVerified','policyReviewVerified','reservesVerified','settlementVerified','feeDeducted','treasuryWritePerformed','signed','broadcast','minted','deposited'])if(value[key]!==false)fail('INVALID_ESTIMATE');
 if(value.feeAsset!==null||value.receipt!==null||value.networkChecked!==true||value.estimateObserved!==true||Object.hasOwn(value,'error'))fail('INVALID_ESTIMATE');
 const gas=decimal(value.gasLimit),price=decimal(value.gasPrice),total=decimal(value.calculatedTotalBaseUnits),balance=decimal(value.balanceBaseUnits);
 if(gas===0n||gas*price!==total||value.balanceSufficient!==(balance>=total))fail('INVALID_ESTIMATE');
 fresh(value,now);
 // Copy only the defined observation; arbitrary server metadata never enters an export.
 const result=freeze({schema:value.schema,status:value.status,...expected,account:SIGNING_PINS.sender,gasLimit:gas.toString(),gasPrice:price.toString(),calculatedTotalBaseUnits:total.toString(),balanceBaseUnits:balance.toString(),balanceSufficient:balance>=total,observedAt:value.observedAt,expiresAt:value.expiresAt,feeAsset:null,feeAssetVerified:false,productionReady:false,estimateVerified:false,signingControlVerified:false,signed:false,broadcast:false,minted:false,deposited:false,receipt:null});
 quotes.add(result);return result;
}
export async function loadLocalEstimate(signal){
 const controller=new AbortController();let timer,onAbort,reader;
 try{return await Promise.race([
  new Promise((_,reject)=>{onAbort=()=>{controller.abort();reject(Object.assign(new Error('ESTIMATE_CANCELLED'),{code:'ESTIMATE_CANCELLED'}));};if(signal?.aborted){onAbort();return;}signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('ESTIMATE_TIMEOUT'),{code:'ESTIMATE_TIMEOUT'}));},15000);}),
  (async()=>{
   if(controller.signal.aborted)fail('ESTIMATE_CANCELLED');
   const response=await fetch(LOCAL_ESTIMATE_PATH,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
   if(!response.ok||response.redirected||!response.headers.get('Content-Type')?.toLowerCase().includes('application/json')||!response.body?.getReader)fail('ESTIMATE_UNAVAILABLE');
   const length=response.headers.get('Content-Length');if(length!==null&&(!/^[0-9]+$/.test(length)||BigInt(length)>BigInt(MAX_RESPONSE_BYTES)))fail('INVALID_ESTIMATE');
   reader=response.body.getReader();const chunks=[];let size=0;
   while(true){if(controller.signal.aborted)fail('ESTIMATE_CANCELLED');const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||(size+=value.length)>MAX_RESPONSE_BYTES)fail('INVALID_ESTIMATE');chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   if(controller.signal.aborted)fail('ESTIMATE_CANCELLED');
   return validateLocalEstimate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  })()
 ]);}finally{controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',onAbort);if(reader){void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}}
}
export async function prepareLocalWalletHandoff({review,quote,backup,maximumFeeBaseUnits,now=()=>Date.now()}){
 if(!backups.has(backup))fail('BACKUP_REQUIRED');
 if(!isValidatedSigningReview(review))fail('UNTRUSTED_REVIEW');
 if(!quotes.has(quote))fail('UNTRUSTED_ESTIMATE');
 fresh(quote,now());const maximum=decimal(maximumFeeBaseUnits);
 if(maximum<BigInt(quote.calculatedTotalBaseUnits))fail('FEE_BUDGET_EXCEEDED');
 if(!quote.balanceSufficient)fail('INSUFFICIENT_FEE_BALANCE');
 if(maximum>BigInt(quote.balanceBaseUnits))fail('FEE_BUDGET_EXCEEDS_BALANCE');
 const draft={schema:'numina.nusd.local-wallet-unsigned-handoff.v1',status:'UNSIGNED_UNVERIFIED_HANDOFF',noncePolicy:'wallet_assigned_before_signing',transactionComplete:false,requestSha256:SIGNING_PINS.request,requestHashBasis:'raw_request_file_bytes',reviewFileSha256:SIGNING_PINS.review,artifactSha256:SIGNING_PINS.artifact,sourceSha256:SIGNING_PINS.source,issuerPolicySha256:SIGNING_PINS.policy,constructorDataSha256:SIGNING_PINS.creation,initialSupplyBaseUnits:SIGNING_PINS.initialSupplyBaseUnits,recipient:SIGNING_PINS.sender,transaction:{type:0,chainId:SIGNING_PINS.chainId,from:SIGNING_PINS.sender,value:'0',gasLimit:quote.gasLimit,gasPrice:quote.gasPrice,data:review.constructorData},wallet:{source:'numina_encrypted_backup_public_address',backupFormatChecked:true,signingControlVerified:false,unlocked:false},network:{chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,identityChecked:true,identityVerified:false,observationSource:'configured_numina_rpc'},fee:{model:'legacy',assetLabel:null,assetIdentityVerified:false,maximumTotalBaseUnits:maximum.toString(),calculatedTotalBaseUnits:quote.calculatedTotalBaseUnits,balanceBaseUnits:quote.balanceBaseUnits,balanceObservedAt:quote.observedAt,estimateObservedAt:quote.observedAt,expiresAt:quote.expiresAt,estimateObserved:true,estimateVerified:false,balanceVerified:false},unresolvedReviews:review.unresolvedReviews,remainingBeforeSigning:review.remainingBeforeSigning,policyReviewVerified:false,productionReady:false,reviewEvidenceVerified:false,fundsVerified:false,signed:false,broadcast:false,minted:false,deposited:false,feeDeductionPerformed:false,treasuryWritesPerformed:false,receipt:null};
 draft.draftSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(draft)))),byte=>byte.toString(16).padStart(2,'0')).join('');
 fresh(quote,now());return freeze(draft);
}
