// Owner-wallet observations and unsigned handoff only. No signing or sending method is available.
export const SIGNING_REVIEW_PATH='/wallet-signing-review.json';
export const SIGNING_PINS=Object.freeze({
 review:'ee2aaf226f9f6e843aac8f1d1ad222045db8bb3b83cd5fe23f7f2bc7c217dde8',
 creation:'bdaf4313f68b97d504ef3796096814d41b3002bffcf9ed75b78a939de6049401',
 policy:'1d24f311a34a28d9560db1f32eb3efc4241701c5ae7233b97c2527006623b13d',
 request:'0af2b7e72cd18f9676f85356da95f8deee8788eac0dee3d587a1278342a401ca',
 artifact:'a77132febebe10172a7fe3ee1814ed124ea5503b93f1e2e4ffdfb218889a262a',
 source:'87755643e690b82b11a9f5744f1dd9803965b0f38fa9ac4d18542e72b4bb80cc',
 chainId:'962421430',genesisHash:'0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1',
 sender:'0x1a45671AE2ee3E52264116151924FAAcb80Fc02E',initialSupplyBaseUnits:'1500000000000000000000'
});
export const QUOTE_TTL_MS=60000;
const MAX_REVIEW_BYTES=65536,MAX_UINT256=(1n<<256n)-1n,trustedReviews=new WeakSet();
const READ_METHODS=new Set(['eth_requestAccounts','eth_accounts','eth_chainId','eth_getBlockByNumber','eth_estimateGas','eth_gasPrice','eth_getBalance']);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
const failure=(code,message)=>Object.assign(new Error(message),{code});
function decimal(value){if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(value)||BigInt(value)>MAX_UINT256)throw failure('INVALID_QUANTITY','Use an exact unsigned integer in the network fee asset’s smallest unit.');return BigInt(value);}
function quantity(value){if(typeof value!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value))throw failure('INVALID_RPC_QUANTITY','The wallet returned an invalid network quantity.');return BigInt(value);}
function selectedAccount(accounts){
 if(!Array.isArray(accounts)||accounts.length===0||accounts.length>64||accounts.some(account=>typeof account!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(account))||accounts[0].toLowerCase()!==SIGNING_PINS.sender.toLowerCase())throw failure('ACCOUNT_MISMATCH','Select the owner-approved Numina treasury account in your wallet.');
 return SIGNING_PINS.sender;
}
function reviewBytes(value){
 const bytes=value instanceof Uint8Array?new Uint8Array(value):value instanceof ArrayBuffer?new Uint8Array(value.slice(0)):null;
 if(!bytes||bytes.length===0||bytes.length>MAX_REVIEW_BYTES)throw failure('INVALID_REVIEW','Choose the published 1,500T unsigned review.');
 return bytes;
}
export async function validateSigningReview(input){
 const bytes=reviewBytes(input);
 if(await digest(bytes)!==SIGNING_PINS.review)throw failure('REVIEW_MISMATCH','The 1,500T review bytes differ from the published request.');
 let review;try{review=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw failure('INVALID_REVIEW','The published unsigned review could not be read.');}
 const c=review?.constructor;
 if(review?.schema!=='numina.nusd.unsigned-constructor-review.v1'||review.status!=='UNSIGNED_CONSTRUCTOR_REVIEW'||review.requestHashBasis!=='raw_request_file_bytes'||review.requestSha256!==SIGNING_PINS.request||review.artifactSha256!==SIGNING_PINS.artifact||review.sourceSha256!==SIGNING_PINS.source||review.issuerPolicySha256!==SIGNING_PINS.policy||c?.initialSupplyBaseUnits!==SIGNING_PINS.initialSupplyBaseUnits||c.initialRecipient!==SIGNING_PINS.sender||c.approvedIssuerPolicyHash!=='0x'+SIGNING_PINS.policy||review.constructorDataSha256!==SIGNING_PINS.creation||typeof review.constructorData!=='string'||!/^0x[0-9a-f]{21492}$/.test(review.constructorData)||review.creationBytes!==10746||review.productionReady!==false||review.reviewEvidenceVerified!==false||review.policyReviewVerified!==false||review.signed!==false||review.broadcast!==false||review.minted!==false||review.deposited!==false||review.receipt!==null||review.walletTransaction!==null||review.unresolvedReviews?.length!==8)throw failure('INVALID_REVIEW','The published 1,500T review is inconsistent.');
 const creation=new Uint8Array(review.creationBytes);for(let i=0;i<creation.length;i++)creation[i]=parseInt(review.constructorData.slice(2+i*2,4+i*2),16);
 if(await digest(creation)!==SIGNING_PINS.creation)throw failure('CREATION_MISMATCH','The creation data differs from the reviewed 1,500T constructor.');
 const result=freeze(review);trustedReviews.add(result);return result;
}
export function isValidatedSigningReview(value){return trustedReviews.has(value);}
export async function loadSigningReview(signal){
 const controller=new AbortController();let timer,onAbort;
 try{return await Promise.race([
  new Promise((_,reject)=>{onAbort=()=>{controller.abort();reject(failure('REVIEW_CANCELLED','Review loading was cancelled.'));};if(signal?.aborted){onAbort();return;}signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{controller.abort();reject(failure('REVIEW_TIMEOUT','The published review took too long to load.'));},15000);}),
  (async()=>{
   if(controller.signal.aborted)throw failure('REVIEW_CANCELLED','Review loading was cancelled.');
   const response=await fetch(SIGNING_REVIEW_PATH,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
   if(!response.ok||response.redirected||!response.body?.getReader)throw failure('REVIEW_UNAVAILABLE','The published review is unavailable.');
   const length=response.headers.get('Content-Length');if(length!==null&&(!/^[0-9]+$/.test(length)||BigInt(length)>BigInt(MAX_REVIEW_BYTES)))throw failure('INVALID_REVIEW','The published review exceeds its size limit.');
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{while(true){if(controller.signal.aborted)throw failure('REVIEW_CANCELLED','Review loading was cancelled.');const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||(size+=value.length)>MAX_REVIEW_BYTES)throw failure('INVALID_REVIEW','The published review exceeds its size limit.');chunks.push(value);}}
   finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   if(controller.signal.aborted)throw failure('REVIEW_CANCELLED','Review loading was cancelled.');
   const result=await validateSigningReview(bytes);if(controller.signal.aborted)throw failure('REVIEW_CANCELLED','Review loading was cancelled.');return result;
  })()
 ]);}finally{controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
export function createWalletSigningControls({provider,onInvalidated=()=>{},now=()=>Date.now(),timeoutMs=30000}={}){
 if(!provider||typeof provider.request!=='function'||typeof provider.on!=='function'||typeof provider.removeListener!=='function')throw failure('WALLET_UNAVAILABLE','Connect an installed wallet that supports account and network notifications.');
 if(typeof onInvalidated!=='function'||typeof now!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw failure('INVALID_CONFIGURATION','Wallet observation settings are invalid.');
 let generation=0,disposed=false,active=null,connection=null,quote=null,quotedReview=null,quoteTime=null,connectingAccounts=null;
 const timestamp=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0||value>8640000000000000-QUOTE_TTL_MS)throw failure('INVALID_CLOCK','The observation clock is unavailable.');return value;};
 function invalidate(reason){generation++;connection=null;quote=null;quotedReview=null;quoteTime=null;connectingAccounts=null;const pending=active;active=null;pending?.reject(failure('WALLET_CHANGED','Wallet state changed. Reconnect and estimate again.'));try{onInvalidated(reason);}catch{}}
 function guard(token){if(disposed||token!==generation)throw failure('WALLET_CHANGED','Wallet state changed. Reconnect and estimate again.');}
 async function rpc(method,params,token){
  guard(token);if(!READ_METHODS.has(method))throw failure('METHOD_NOT_ALLOWED','This control only observes the wallet.');
  let result;try{result=await provider.request({method,params});}catch{guard(token);throw failure('WALLET_REQUEST_FAILED','The wallet request was declined or unavailable.');}
  guard(token);return result;
 }
 async function identity(token){
  const chainId=quantity(await rpc('eth_chainId',[],token)).toString();
  if(chainId!==SIGNING_PINS.chainId)throw failure('CHAIN_MISMATCH','Select the configured Numina network in your wallet.');
  const account=selectedAccount(await rpc('eth_accounts',[],token));
  const genesis=await rpc('eth_getBlockByNumber',['0x0',false],token);
  if(!genesis||typeof genesis!=='object'||Array.isArray(genesis)||quantity(genesis.number)!==0n||typeof genesis.hash!=='string'||genesis.hash.toLowerCase()!==SIGNING_PINS.genesisHash)throw failure('GENESIS_MISMATCH','The wallet network genesis does not match the configured Numina network.');
  return freeze({account,chainId,genesisHash:SIGNING_PINS.genesisHash,networkChecked:true,networkIdentityVerified:false,signingControlVerified:false});
 }
 async function run(work){
  if(disposed)throw failure('WALLET_DISPOSED','This wallet control is closed.');
  if(active)throw failure('WALLET_BUSY','Wait for the current wallet observation to finish.');
  const token=++generation;let timer,rejectPending;
  const cancelled=new Promise((_,reject)=>{rejectPending=reject;});active={token,reject:rejectPending};
  timer=setTimeout(()=>{if(active?.token!==token)return;const pending=active;active=null;generation++;connection=null;quote=null;quotedReview=null;quoteTime=null;connectingAccounts=null;pending.reject(failure('WALLET_TIMEOUT','The wallet observation timed out. Reconnect before trying again.'));try{onInvalidated('timeout');}catch{}},timeoutMs);
  try{const result=await Promise.race([work(token),cancelled]);guard(token);return result;}
  catch(error){if(generation===token)invalidate(error?.code||'observation_failed');throw error;}
  finally{clearTimeout(timer);if(active?.token===token)active=null;}
 }
 function freshQuote(){
  if(!connection||!quote||!quotedReview||quoteTime===null)throw failure('QUOTE_REQUIRED','Connect the treasury wallet and estimate this request first.');
  const current=timestamp();if(current<quoteTime||current>=quoteTime+QUOTE_TTL_MS)throw failure('QUOTE_EXPIRED','The estimate expired. Request a new estimate.');
 }
 const events={accountsChanged:accounts=>{
  // Permission approval may announce the expected account before its request resolves.
  // Nothing is connected yet; the full identity is still re-read after that request.
  if(connectingAccounts!==null&&connectingAccounts===generation&&active?.token===connectingAccounts&&!disposed){try{selectedAccount(accounts);return;}catch{}}
  invalidate('accounts_changed');
 },chainChanged:()=>invalidate('chain_changed'),disconnect:()=>invalidate('wallet_disconnected')};
 for(const [event,handler] of Object.entries(events))provider.on(event,handler);
 return Object.freeze({
  connect:()=>run(async token=>{
   connection=null;quote=null;quotedReview=null;quoteTime=null;
   connectingAccounts=token;
   try{selectedAccount(await rpc('eth_requestAccounts',[],token));}finally{if(connectingAccounts===token)connectingAccounts=null;}
   const checked=await identity(token);guard(token);connection=checked;return connection;
  }),
  estimate:review=>run(async token=>{
   if(!trustedReviews.has(review))throw failure('UNTRUSTED_REVIEW','Load the exact published 1,500T review before estimating.');
   if(!connection)throw failure('CONNECTION_REQUIRED','Connect the selected treasury wallet first.');
   quote=null;quotedReview=null;quoteTime=null;
   await identity(token);
   const gasLimit=quantity(await rpc('eth_estimateGas',[{from:SIGNING_PINS.sender,value:'0x0',data:review.constructorData},'pending'],token));
   if(gasLimit===0n)throw failure('INVALID_GAS_ESTIMATE','The wallet returned an empty gas estimate.');
   const gasPrice=quantity(await rpc('eth_gasPrice',[],token)),balance=quantity(await rpc('eth_getBalance',[SIGNING_PINS.sender,'pending'],token));
   const total=gasLimit*gasPrice;if(total>MAX_UINT256)throw failure('FEE_OVERFLOW','The estimated total fee is outside the supported range.');
   const checked=await identity(token);guard(token);
   const observed=timestamp();guard(token);connection=checked;
   quote=freeze({account:SIGNING_PINS.sender,chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,constructorDataSha256:SIGNING_PINS.creation,initialSupplyBaseUnits:SIGNING_PINS.initialSupplyBaseUnits,gasLimit:gasLimit.toString(),gasPrice:gasPrice.toString(),calculatedTotalBaseUnits:total.toString(),balanceBaseUnits:balance.toString(),balanceSufficient:balance>=total,observedAt:new Date(observed).toISOString(),expiresAt:new Date(observed+QUOTE_TTL_MS).toISOString(),feeAsset:null,feeAssetVerified:false,estimateObserved:true,estimateVerified:false,observationSource:'connected_wallet_provider',productionReady:false});
   quotedReview=review;quoteTime=observed;return quote;
  }),
  handoff:({maximumFeeBaseUnits}={})=>run(async token=>{
   freshQuote();const maximum=decimal(maximumFeeBaseUnits),snapshot=quote,review=quotedReview;
   if(maximum<BigInt(snapshot.calculatedTotalBaseUnits))throw failure('FEE_BUDGET_EXCEEDED','The observed network cost exceeds your maximum total fee.');
   await identity(token);
   const balance=quantity(await rpc('eth_getBalance',[SIGNING_PINS.sender,'pending'],token));
   if(balance<BigInt(snapshot.calculatedTotalBaseUnits))throw failure('INSUFFICIENT_FEE_BALANCE','The wallet does not report enough native network balance for this estimate.');
   if(maximum>balance)throw failure('FEE_BUDGET_EXCEEDS_BALANCE','Your maximum total fee exceeds the wallet’s observed native network balance.');
   await identity(token);guard(token);freshQuote();
   const draft={schema:'numina.nusd.wallet-unsigned-handoff.v1',status:'UNSIGNED_UNVERIFIED_HANDOFF',noncePolicy:'wallet_assigned_before_signing',transactionComplete:false,requestSha256:SIGNING_PINS.request,requestHashBasis:'raw_request_file_bytes',reviewFileSha256:SIGNING_PINS.review,artifactSha256:SIGNING_PINS.artifact,sourceSha256:SIGNING_PINS.source,issuerPolicySha256:SIGNING_PINS.policy,constructorDataSha256:SIGNING_PINS.creation,initialSupplyBaseUnits:SIGNING_PINS.initialSupplyBaseUnits,recipient:SIGNING_PINS.sender,transaction:{type:0,chainId:SIGNING_PINS.chainId,from:SIGNING_PINS.sender,value:'0',gasLimit:snapshot.gasLimit,gasPrice:snapshot.gasPrice,data:review.constructorData},network:{chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,identityChecked:true,identityVerified:false,observationSource:'connected_wallet_provider'},fee:{model:'legacy',assetLabel:null,assetIdentityVerified:false,maximumTotalBaseUnits:maximum.toString(),calculatedTotalBaseUnits:snapshot.calculatedTotalBaseUnits,balanceBaseUnits:balance.toString(),balanceObservedAt:new Date(timestamp()).toISOString(),estimateObservedAt:snapshot.observedAt,expiresAt:snapshot.expiresAt,estimateObserved:true,estimateVerified:false,balanceVerified:false},unresolvedReviews:review.unresolvedReviews,remainingBeforeSigning:review.remainingBeforeSigning,policyReviewVerified:false,productionReady:false,reviewEvidenceVerified:false,fundsVerified:false,signed:false,broadcast:false,minted:false,deposited:false,feeDeductionPerformed:false,treasuryWritesPerformed:false,receipt:null};
   draft.draftSha256=await digest(new TextEncoder().encode(canonical(draft)));guard(token);freshQuote();return freeze(draft);
  }),
  disconnect:()=>{if(!disposed)invalidate('local_disconnect');},
  dispose:()=>{if(disposed)return;disposed=true;for(const [event,handler] of Object.entries(events))provider.removeListener(event,handler);invalidate('disposed');}
 });
}
