import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {SIGNING_REVIEW_PATH,SIGNING_PINS,QUOTE_TTL_MS,validateSigningReview,loadSigningReview,createWalletSigningControls} from '../public/wallet-signing-model.js';

const bytes=readFileSync(new URL('../public/wallet-signing-review.json',import.meta.url));
const review=await validateSigningReview(bytes),sender=SIGNING_PINS.sender;
const allowed=new Set(['eth_requestAccounts','eth_accounts','eth_chainId','eth_getBlockByNumber','eth_estimateGas','eth_gasPrice','eth_getBalance']);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
class Wallet extends EventEmitter{
 constructor(){super();this.calls=[];this.accounts=[sender];this.chain='0x'+BigInt(SIGNING_PINS.chainId).toString(16);this.genesis={number:'0x0',hash:SIGNING_PINS.genesisHash};this.gas='0x5208';this.price='0x2';this.balance='0x186a0';this.overrides={};this.before=null;}
 async request({method,params}){
  this.calls.push(structuredClone({method,params}));this.before?.(method,params);
  if(this.overrides[method])return this.overrides[method](params);
  switch(method){
   case 'eth_requestAccounts':case 'eth_accounts':return [...this.accounts];
   case 'eth_chainId':return this.chain;
   case 'eth_getBlockByNumber':return {...this.genesis};
   case 'eth_estimateGas':return this.gas;
   case 'eth_gasPrice':return this.price;
   case 'eth_getBalance':return this.balance;
   default:throw Error('Unexpected provider method: '+method);
  }
 }
}
function setup(t,options={}){
 const provider=new Wallet(),reasons=[];let clock=100000;
 const controls=createWalletSigningControls({provider,onInvalidated:reason=>reasons.push(reason),now:()=>clock,...options});
 t.after(()=>controls.dispose());return {provider,controls,reasons,setClock:value=>{clock=value;}};
}
async function ready(t,options){const result=setup(t,options);await result.controls.connect();return result;}
async function quoted(t,options){const result=await ready(t,options);result.quote=await result.controls.estimate(review);return result;}

test('1500T review pins the exact bytes, constructor, revised policy and eight unresolved reviews',async()=>{
 assert.equal(createHash('sha256').update(bytes).digest('hex'),SIGNING_PINS.review);
 assert.equal(review.constructor.initialSupplyBaseUnits,'1500000000000000000000');
 assert.equal(review.constructor.initialRecipient,sender);assert.equal(review.requestHashBasis,'raw_request_file_bytes');
 const creation=Buffer.from(review.constructorData.slice(2),'hex');assert.equal(creation.length,10746);assert.equal(createHash('sha256').update(creation).digest('hex'),SIGNING_PINS.creation);
 const words=review.constructorArguments.slice(2).match(/.{64}/g);assert.equal(words.length,8);assert.equal(BigInt('0x'+words[0]),1500000000000000000000n);assert.equal('0x'+words[1].slice(24),sender.toLowerCase());assert.equal(words[7],SIGNING_PINS.policy);assert.equal(review.constructorData.endsWith(review.constructorArguments.slice(2)),true);
 assert.equal(review.unresolvedReviews.length,8);assert.equal(review.policyReviewVerified,false);assert.equal(review.productionReady,false);
 assert.equal(Object.isFrozen(review),true);assert.equal(Object.isFrozen(review.constructor),true);assert.equal(Object.isFrozen(review.unresolvedReviews),true);
 assert.throws(()=>{review.constructor.initialSupplyBaseUnits='0';});
});
test('validation snapshots input bytes and rejects tampered amounts, fabricated verification and unpinned files',async()=>{
 const copied=new Uint8Array(bytes),pending=validateSigningReview(copied);copied.fill(0);assert.equal((await pending).constructorDataSha256,SIGNING_PINS.creation);
 for(const change of [{productionReady:true,reviewEvidenceVerified:true},{constructor:{...review.constructor,initialSupplyBaseUnits:'500000000000000000000'}},{issuerPolicySha256:'95f806c9c64fd2cee955eb0c05ffcb6653f4cdeab33a85b993e1bd4c60f3092c'},{receipt:{status:'success'}}])await assert.rejects(validateSigningReview(new TextEncoder().encode(JSON.stringify({...review,...change}))),{code:'REVIEW_MISMATCH'});
 for(const input of ['',null,{},new Uint8Array(65537),new Uint8Array()])await assert.rejects(validateSigningReview(input),{code:'INVALID_REVIEW'});
});
test('original 500T package pins remain separate from this 1500T handoff',()=>{
 const template=JSON.parse(readFileSync(new URL('../public/deployment-readiness-inputs.json',import.meta.url)));
 assert.equal(template.request.constructor[0].value,'500000000000000000000');
 assert.equal(template.request.preparationPolicy.sha256,'95f806c9c64fd2cee955eb0c05ffcb6653f4cdeab33a85b993e1bd4c60f3092c');
 assert.notEqual(template.request.preparationPolicy.sha256,SIGNING_PINS.policy);
 assert.equal(template.request.broadcast,false);assert.equal(template.package.productionReady,false);
});
test('connect observes the selected treasury account, chain and genesis without claiming key control',async t=>{
 const {provider,controls}=setup(t);assert.equal(provider.calls.length,0);
 const result=await controls.connect();assert.deepEqual(result,{account:sender,chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,networkChecked:true,networkIdentityVerified:false,signingControlVerified:false});
 assert.deepEqual(provider.calls.map(call=>call.method),['eth_requestAccounts','eth_chainId','eth_accounts','eth_getBlockByNumber']);
 assert.deepEqual(provider.calls.at(-1).params,['0x0',false]);
});
test('expected initial account notification during permission prompt still requires and passes identity checks',async t=>{
 const {provider,controls}=setup(t);provider.before=method=>{if(method==='eth_requestAccounts')provider.emit('accountsChanged',[sender]);};
 const result=await controls.connect();assert.equal(result.account,sender);assert.equal(provider.calls.filter(call=>call.method==='eth_getBlockByNumber').length,1);
});
test('initial permission notification cannot mask a wrong account, chain or disposed operation',async t=>{
 for(const mode of ['wrong_account','wrong_chain','dispose']){
  const {provider,controls}=setup(t);
  provider.before=method=>{if(method!=='eth_requestAccounts')return;provider.emit('accountsChanged',[sender]);if(mode==='wrong_account')provider.accounts=['0x'+'1'.repeat(40)];if(mode==='wrong_chain')provider.chain='0x1';if(mode==='dispose')controls.dispose();};
  await assert.rejects(controls.connect(),error=>['ACCOUNT_MISMATCH','CHAIN_MISMATCH','WALLET_CHANGED'].includes(error.code));
 }
});
test('wrong selected account including target as a later account fails',async t=>{
 for(const accounts of [[],['0x'+'1'.repeat(40)],['0x'+'1'.repeat(40),sender],[sender,'malformed']]){const {provider,controls}=setup(t);provider.accounts=accounts;await assert.rejects(controls.connect(),{code:'ACCOUNT_MISMATCH'});assert.equal(provider.calls.some(call=>call.method==='eth_estimateGas'),false);}
});
test('chain and genesis identities are independently required',async t=>{
 for(const change of [{chain:'0x1'},{genesis:{number:'0x0',hash:'0x'+'1'.repeat(64)}},{genesis:{number:'0x1',hash:SIGNING_PINS.genesisHash}}]){const {provider,controls}=setup(t);Object.assign(provider,change);await assert.rejects(controls.connect(),error=>['CHAIN_MISMATCH','GENESIS_MISMATCH'].includes(error.code));}
});
test('estimate binds exact creation data, does exact arithmetic and leaves fee currency unverified',async t=>{
 const {provider,controls}=await ready(t),quote=await controls.estimate(review);
 assert.equal(quote.gasLimit,'21000');assert.equal(quote.gasPrice,'2');assert.equal(quote.calculatedTotalBaseUnits,'42000');assert.equal(quote.balanceBaseUnits,'100000');assert.equal(quote.balanceSufficient,true);
 assert.equal(quote.observedAt,new Date(100000).toISOString());assert.equal(quote.expiresAt,new Date(100000+QUOTE_TTL_MS).toISOString());
 assert.equal(quote.feeAsset,null);assert.equal(quote.feeAssetVerified,false);assert.equal(quote.estimateVerified,false);assert.equal(quote.productionReady,false);
 assert.deepEqual(provider.calls.find(call=>call.method==='eth_estimateGas').params,[{from:sender,value:'0x0',data:review.constructorData},'pending']);
 assert.equal(provider.calls.filter(call=>call.method==='eth_getBlockByNumber').length,3);assert.equal(Object.isFrozen(quote),true);
});
test('an untrusted review clone cannot be estimated even if its verification claims are injected',async t=>{
 const {provider,controls}=await ready(t);await assert.rejects(controls.estimate({...review,productionReady:true}),{code:'UNTRUSTED_REVIEW'});assert.equal(provider.calls.some(call=>call.method==='eth_estimateGas'),false);
});
test('unsafe RPC quantities and zero gas estimates cannot create a quote',async t=>{
 for(const bad of [null,9007199254740992,'1','0x','0x00','0X1','0x-1','0x1.1','0x'+'1'.repeat(65)]){
  const {provider,controls}=await ready(t);provider.price=bad;await assert.rejects(controls.estimate(review),{code:'INVALID_RPC_QUANTITY'});
 }
 const {provider,controls}=await ready(t);provider.gas='0x0';await assert.rejects(controls.estimate(review),{code:'INVALID_GAS_ESTIMATE'});
});
test('fee multiplication remains exact above safe JavaScript integer and rejects uint256 overflow',async t=>{
 const {provider,controls}=await ready(t);provider.gas='0x20000000000001';provider.price='0x3';provider.balance='0xffffffffffffffff';const quote=await controls.estimate(review);assert.equal(quote.calculatedTotalBaseUnits,'27021597764222979');
 provider.gas='0x'+'f'.repeat(64);provider.price='0x2';await assert.rejects(controls.estimate(review),{code:'FEE_OVERFLOW'});
});
test('a network reporting zero gas price preserves zero cost and accepts a zero budget',async t=>{
 const {provider,controls}=await ready(t);provider.price='0x0';provider.balance='0x0';const quote=await controls.estimate(review);assert.equal(quote.calculatedTotalBaseUnits,'0');assert.equal(quote.balanceSufficient,true);
 const handoff=await controls.handoff({maximumFeeBaseUnits:'0'});assert.equal(handoff.fee.maximumTotalBaseUnits,'0');assert.equal(handoff.transaction.gasPrice,'0');
});
test('handoff is exact, hashed, unsigned, fee-capped and omits nonce and contract destination',async t=>{
 const {controls}=await quoted(t),handoff=await controls.handoff({maximumFeeBaseUnits:'50000'});
 assert.deepEqual(handoff.transaction,{type:0,chainId:SIGNING_PINS.chainId,from:sender,value:'0',gasLimit:'21000',gasPrice:'2',data:review.constructorData});
 assert.equal(Object.hasOwn(handoff.transaction,'nonce'),false);assert.equal(Object.hasOwn(handoff.transaction,'to'),false);assert.equal(handoff.noncePolicy,'wallet_assigned_before_signing');assert.equal(handoff.transactionComplete,false);
 assert.equal(handoff.requestHashBasis,'raw_request_file_bytes');assert.equal(handoff.issuerPolicySha256,SIGNING_PINS.policy);assert.equal(handoff.fee.maximumTotalBaseUnits,'50000');assert.equal(handoff.fee.assetLabel,null);assert.equal(handoff.fee.assetIdentityVerified,false);assert.equal(handoff.network.identityVerified,false);
 for(const field of ['productionReady','reviewEvidenceVerified','policyReviewVerified','fundsVerified','signed','broadcast','minted','deposited','feeDeductionPerformed','treasuryWritesPerformed'])assert.equal(handoff[field],false,field);
 assert.equal(handoff.receipt,null);assert.equal(handoff.unresolvedReviews.length,8);assert.equal(handoff.draftSha256.length,64);assert.equal(Object.isFrozen(handoff.transaction),true);
 const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
 const {draftSha256,...unsigned}=handoff;assert.equal(createHash('sha256').update(canonical(unsigned)).digest('hex'),draftSha256);
 const roundTrip=JSON.parse(JSON.stringify(handoff)),{draftSha256:exportedHash,...exportedDraft}=roundTrip;
 assert.deepEqual(roundTrip,handoff);assert.equal(createHash('sha256').update(canonical(exportedDraft)).digest('hex'),exportedHash);
 assert.deepEqual(roundTrip.unresolvedReviews,review.unresolvedReviews);assert.deepEqual(roundTrip.remainingBeforeSigning,review.remainingBeforeSigning);
});
test('fee budget must be exact and cover cost without exceeding fresh native balance',async t=>{
 for(const bad of [undefined,null,42000,'042000','4.2e4',' 42000','-1','1.1',(1n<<256n).toString()]){const {controls}=await quoted(t);await assert.rejects(controls.handoff({maximumFeeBaseUnits:bad}),{code:'INVALID_QUANTITY'});}
 {const {controls}=await quoted(t);await assert.rejects(controls.handoff({maximumFeeBaseUnits:'41999'}),{code:'FEE_BUDGET_EXCEEDED'});}
 {const {provider,controls}=await quoted(t);provider.balance='0xa40f';await assert.rejects(controls.handoff({maximumFeeBaseUnits:'42000'}),{code:'INSUFFICIENT_FEE_BALANCE'});}
 {const {provider,controls}=await quoted(t);provider.balance='0xafc8';await assert.rejects(controls.handoff({maximumFeeBaseUnits:'50000'}),{code:'FEE_BUDGET_EXCEEDS_BALANCE'});}
});
test('expired or backward-clock quotes cannot become handoffs and are cleared',async t=>{
 for(const clock of [99999,100000+QUOTE_TTL_MS,100001+QUOTE_TTL_MS]){const {controls,setClock}=await quoted(t);setClock(clock);await assert.rejects(controls.handoff({maximumFeeBaseUnits:'50000'}),{code:'QUOTE_EXPIRED'});await assert.rejects(controls.handoff({maximumFeeBaseUnits:'50000'}),{code:'QUOTE_REQUIRED'});}
});
test('quote expiration during final network check rejects handoff',async t=>{
 const {provider,controls,setClock}=await quoted(t);provider.before=method=>{if(method==='eth_getBalance')setClock(100000+QUOTE_TTL_MS);};await assert.rejects(controls.handoff({maximumFeeBaseUnits:'50000'}),{code:'QUOTE_EXPIRED'});
});
test('silent account, chain and genesis changes while estimating are detected by final identity reads',async t=>{
 for(const mutation of [provider=>{provider.accounts=['0x'+'1'.repeat(40)];},provider=>{provider.chain='0x1';},provider=>{provider.genesis.hash='0x'+'1'.repeat(64);}]){
  const {provider,controls}=await ready(t);provider.before=method=>{if(method==='eth_estimateGas')mutation(provider);};await assert.rejects(controls.estimate(review),error=>['ACCOUNT_MISMATCH','CHAIN_MISMATCH','GENESIS_MISMATCH'].includes(error.code));await assert.rejects(controls.handoff({maximumFeeBaseUnits:'50000'}),{code:'QUOTE_REQUIRED'});
 }
});
test('handoff rechecks identity even without a provider event and after its fresh balance read',async t=>{
 {const {provider,controls}=await quoted(t);provider.accounts=['0x'+'1'.repeat(40)];await assert.rejects(controls.handoff({maximumFeeBaseUnits:'50000'}),{code:'ACCOUNT_MISMATCH'});}
 {const {provider,controls}=await quoted(t);provider.before=method=>{if(method==='eth_getBalance')provider.chain='0x1';};await assert.rejects(controls.handoff({maximumFeeBaseUnits:'50000'}),{code:'CHAIN_MISMATCH'});}
});
test('account, chain and disconnect events cancel in-flight estimates and prevent late results or further RPC',async t=>{
 for(const event of ['accountsChanged','chainChanged','disconnect']){
  const {provider,controls,reasons}=await ready(t),held=deferred();provider.overrides.eth_estimateGas=()=>held.promise;
  const pending=controls.estimate(review);await nextTurn();assert.equal(provider.calls.at(-1).method,'eth_estimateGas');const calls=provider.calls.length;
  provider.emit(event,event==='accountsChanged'?[sender]:'0x1');await assert.rejects(pending,{code:'WALLET_CHANGED'});held.resolve('0x5208');await nextTurn();assert.equal(provider.calls.length,calls);assert.equal(reasons.length,1);
  await assert.rejects(controls.handoff({maximumFeeBaseUnits:'50000'}),{code:'QUOTE_REQUIRED'});
 }
});
test('local disconnect and disposal cancel pending observations; disposal removes every listener',async t=>{
 for(const action of ['disconnect','dispose']){
  const {provider,controls}=await ready(t),held=deferred();provider.overrides.eth_estimateGas=()=>held.promise;const pending=controls.estimate(review);await nextTurn();controls[action]();await assert.rejects(pending,{code:'WALLET_CHANGED'});const calls=provider.calls.length;held.resolve('0x5208');await nextTurn();assert.equal(provider.calls.length,calls);
  if(action==='dispose'){for(const event of ['accountsChanged','chainChanged','disconnect'])assert.equal(provider.listenerCount(event),0);await assert.rejects(controls.connect(),{code:'WALLET_DISPOSED'});}
 }
});
test('timeout invalidates a stalled provider request, ignores its late result and permits explicit reconnect',async t=>{
 const {provider,controls,reasons}=await ready(t,{timeoutMs:20}),held=deferred();provider.overrides.eth_estimateGas=()=>held.promise;await assert.rejects(controls.estimate(review),{code:'WALLET_TIMEOUT'});assert.ok(reasons.includes('timeout'));
 const calls=provider.calls.length;held.resolve('0x5208');await nextTurn();assert.equal(provider.calls.length,calls);delete provider.overrides.eth_estimateGas;await controls.connect();assert.equal((await controls.estimate(review)).gasLimit,'21000');
});
test('concurrent clicks do not start overlapping observations or discard the valid in-flight result',async t=>{
 const {provider,controls}=await ready(t),held=deferred();provider.overrides.eth_estimateGas=()=>held.promise;const pending=controls.estimate(review);await nextTurn();await assert.rejects(controls.estimate(review),{code:'WALLET_BUSY'});assert.equal(provider.calls.filter(call=>call.method==='eth_estimateGas').length,1);held.resolve('0x5208');assert.equal((await pending).calculatedTotalBaseUnits,'42000');
});
test('provider errors never expose arbitrary upstream details or issue a signing or sending method',async t=>{
 const {provider,controls}=await quoted(t);await controls.handoff({maximumFeeBaseUnits:'50000'});assert.ok(provider.calls.every(call=>allowed.has(call.method)));assert.equal(provider.calls.filter(call=>call.method==='eth_requestAccounts').length,1);
 provider.overrides.eth_gasPrice=()=>{throw Error('secret upstream credential value');};await assert.rejects(controls.estimate(review),error=>error.code==='WALLET_REQUEST_FAILED'&&!error.message.includes('secret'));
 assert.ok(provider.calls.every(call=>allowed.has(call.method)));assert.equal(Object.keys(controls).sort().join(','),'connect,disconnect,dispose,estimate,handoff');
});
test('review loader uses one fixed credential-free read and enforces raw review pin',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(path,options)=>{calls.push({path,options});return new Response(bytes);};
 try{assert.equal((await loadSigningReview()).constructorDataSha256,SIGNING_PINS.creation);assert.equal(calls.length,1);assert.equal(calls[0].path,SIGNING_REVIEW_PATH);assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.cache,'no-store');
  globalThis.fetch=async()=>new Response(new Uint8Array([...bytes,32]));await assert.rejects(loadSigningReview(),{code:'REVIEW_MISMATCH'});
 }finally{globalThis.fetch=original;}
});
test('review loader rejects overlarge declared or streamed responses and body-inclusive cancellation',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(bytes,{headers:{'Content-Length':'65537'}});await assert.rejects(loadSigningReview(),{code:'INVALID_REVIEW'});
  globalThis.fetch=async()=>new Response(new Uint8Array(65537));await assert.rejects(loadSigningReview(),{code:'INVALID_REVIEW'});
  globalThis.fetch=async(_path,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error('aborted')),{once:true});}}));
  const controller=new AbortController(),pending=loadSigningReview(controller.signal);await nextTurn();controller.abort();await assert.rejects(pending,{code:'REVIEW_CANCELLED'});
  const aborted=new AbortController();aborted.abort();let called=false;globalThis.fetch=async()=>{called=true;return new Response(bytes);};await assert.rejects(loadSigningReview(aborted.signal),{code:'REVIEW_CANCELLED'});assert.equal(called,false);
 }finally{globalThis.fetch=original;}
});
test('review loading deadline covers a stalled body after successful headers',async()=>{
 const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout;
 try{
  globalThis.setTimeout=(callback,ms,...args)=>originalTimer(callback,ms===15000?5:ms,...args);
  globalThis.fetch=async(_path,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error('aborted')),{once:true});}}));
  await assert.rejects(loadSigningReview(),{code:'REVIEW_TIMEOUT'});
 }finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;}
});
test('unsupported providers and invalid clock readings cannot authorize a handoff',async t=>{
 for(const provider of [undefined,{}, {request:async()=>[]}])assert.throws(()=>createWalletSigningControls({provider}),{code:'WALLET_UNAVAILABLE'});
 const {controls}=await ready(t,{now:()=>NaN});await assert.rejects(controls.estimate(review),{code:'INVALID_CLOCK'});
});
