import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inspectLocalWalletBackup,validateLocalEstimate,prepareLocalWalletHandoff,loadLocalEstimate,LOCAL_ESTIMATE_PATH} from '../public/local-wallet-signing-model.js';
import {SIGNING_PINS,validateSigningReview} from '../public/wallet-signing-model.js';
import {routeRuntime} from '../src/runtime-http.js';

const now=Date.now(),review=await validateSigningReview(readFileSync(new URL('../public/wallet-signing-review.json',import.meta.url)));
// Public structural fixture only: its unencrypted address deliberately proves no key control.
const backup=()=>JSON.stringify({address:SIGNING_PINS.sender.slice(2),version:3,id:'11111111-1111-1111-1111-111111111111',Crypto:{cipher:'aes-128-ctr',cipherparams:{iv:'11'.repeat(16)},ciphertext:'22'.repeat(32),mac:'33'.repeat(32),kdf:'scrypt',kdfparams:{salt:'44'.repeat(32),n:131072,r:8,p:1,dklen:32}}});
const observation=()=>({schema:'numina.deployment-estimate.v1',status:'observed',account:SIGNING_PINS.sender,chainId:SIGNING_PINS.chainId,genesisHash:SIGNING_PINS.genesisHash,constructorDataSha256:SIGNING_PINS.creation,reviewSha256:SIGNING_PINS.review,requestSha256:SIGNING_PINS.request,requestHashBasis:'raw_request_file_bytes',artifactSha256:SIGNING_PINS.artifact,sourceSha256:SIGNING_PINS.source,issuerPolicySha256:SIGNING_PINS.policy,initialSupplyBaseUnits:SIGNING_PINS.initialSupplyBaseUnits,gasLimit:'9007199254740993',gasPrice:'11',calculatedTotalBaseUnits:'99079191802150923',balanceBaseUnits:'99079191802150925',balanceSufficient:true,observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+59000).toISOString(),feeAsset:null,receipt:null,observationSource:'configured_numina_rpc',networkChecked:true,estimateObserved:true,...Object.fromEntries(['feeAssetVerified','productionReady','estimateVerified','signingControlVerified','networkIdentityVerified','reviewEvidenceVerified','policyReviewVerified','reservesVerified','settlementVerified','feeDeducted','treasuryWritePerformed','signed','broadcast','minted','deposited'].map(key=>[key,false]))});
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);

test('backup inspection retains only the approved public address, never key material or control claims',()=>{
 const result=inspectLocalWalletBackup(backup());assert.deepEqual(result,{address:SIGNING_PINS.sender,backupFormatChecked:true,signingControlVerified:false});assert.ok(Object.isFrozen(result));
 const value=JSON.parse(backup());value.address='12'.repeat(20);assert.throws(()=>inspectLocalWalletBackup(JSON.stringify(value)),{code:'BACKUP_ACCOUNT_MISMATCH'});
 for(const bad of ['',null,'x'.repeat(8193),'{}',backup().replace('131072','1')])assert.throws(()=>inspectLocalWalletBackup(bad),{code:'INVALID_BACKUP'});
});
test('every pinned identity and all success/evidence flags are checked',()=>{
 const base=observation();
 for(const key of ['account','chainId','genesisHash','constructorDataSha256','reviewSha256','requestSha256','requestHashBasis','artifactSha256','sourceSha256','issuerPolicySha256','initialSupplyBaseUnits','observationSource'])assert.throws(()=>validateLocalEstimate({...base,[key]:'wrong'},now),{code:'ESTIMATE_MISMATCH'});
 for(const [key,value] of Object.entries(base))if(typeof value==='boolean')assert.throws(()=>validateLocalEstimate({...base,[key]:!value},now));
 assert.throws(()=>validateLocalEstimate({...base,error:{}},now));assert.throws(()=>validateLocalEstimate({...base,receipt:{}},now));
});
test('exact fee integers, overflow, malformed quantities and stale observations fail closed',()=>{
 const value=observation();assert.equal(validateLocalEstimate(value,now).calculatedTotalBaseUnits,'99079191802150923');
 for(const bad of ['1e5','01','-1',1,'9'.repeat(79)])assert.throws(()=>validateLocalEstimate({...value,gasPrice:bad},now));
 for(const change of [{gasLimit:'0'},{calculatedTotalBaseUnits:'99079191802150924'},{gasLimit:((1n<<256n)-1n).toString(),gasPrice:'2'},{observedAt:new Date(now+6000).toISOString(),expiresAt:new Date(now+66000).toISOString()},{expiresAt:new Date(now+58000).toISOString()}])assert.throws(()=>validateLocalEstimate({...value,...change},now));
 assert.throws(()=>validateLocalEstimate(value,now+59000),{code:'QUOTE_EXPIRED'});
});
test('unsigned handoff uses exact constructor and a canonical digest, retains reviews and no secrets',async()=>{
 const quote=validateLocalEstimate(observation(),now),draft=await prepareLocalWalletHandoff({review,quote,backup:inspectLocalWalletBackup(backup()),maximumFeeBaseUnits:'99079191802150924',now:()=>now});
 assert.equal(draft.transaction.data,review.constructorData);assert.equal(draft.transaction.gasLimit,'9007199254740993');assert.equal(draft.unresolvedReviews.length,8);
 for(const key of ['productionReady','reviewEvidenceVerified','fundsVerified','signed','broadcast','minted','deposited','treasuryWritesPerformed'])assert.equal(draft[key],false);
 assert.equal(draft.wallet.unlocked,false);assert.equal(draft.receipt,null);assert.equal(draft.transaction.nonce,undefined);assert.equal(draft.transaction.to,undefined);
 const {draftSha256,...body}=draft;assert.equal(draftSha256,createHash('sha256').update(canonical(body)).digest('hex'));assert.ok(!JSON.stringify(draft).includes('ciphertext'));
});
test('cloned reviews/quotes, insufficient funds, fee limits and expiry cannot export',async()=>{
 const quote=validateLocalEstimate(observation(),now),args={review,quote,backup:inspectLocalWalletBackup(backup()),maximumFeeBaseUnits:'99079191802150924',now:()=>now};
 for(const changes of [{backup:undefined},{backup:{...args.backup}},{review:{...review}},{quote:{...quote}},{maximumFeeBaseUnits:'99079191802150922'},{maximumFeeBaseUnits:'99079191802150926'},{now:()=>now+59000}])await assert.rejects(prepareLocalWalletHandoff({...args,...changes}));
 const poor=validateLocalEstimate({...observation(),balanceBaseUnits:'0',balanceSufficient:false},now);await assert.rejects(prepareLocalWalletHandoff({...args,quote:poor}),{code:'INSUFFICIENT_FEE_BALANCE'});
 let ticks=0;await assert.rejects(prepareLocalWalletHandoff({...args,now:()=>++ticks===1?now:now+59000}),{code:'QUOTE_EXPIRED'});
});
test('estimate transport sends only fixed read and bounds the response',async()=>{
 const previous=globalThis.fetch;const calls=[];
 try{
  globalThis.fetch=async(url,options)=>{calls.push([url,options]);return Response.json(observation());};
  await loadLocalEstimate();assert.equal(calls[0][0],LOCAL_ESTIMATE_PATH);assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].credentials,'omit');assert.equal(calls[0][1].body,undefined);assert.equal(calls[0][1].headers,undefined);
  globalThis.fetch=async()=>new Response('x'.repeat(16385),{headers:{'Content-Type':'application/json'}});await assert.rejects(loadLocalEstimate());
  globalThis.fetch=async()=>new Response('{}',{headers:{'Content-Type':'text/html'}});await assert.rejects(loadLocalEstimate());
  const abort=new AbortController();abort.abort();await assert.rejects(loadLocalEstimate(abort.signal),{code:'ESTIMATE_CANCELLED'});
 }finally{globalThis.fetch=previous;}
});
test('canonical estimate route remains local, credential-free and unavailable without a current estimate',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json(observation());};
 const response=await routeRuntime(new Request('https://numinalabs.xyz'+LOCAL_ESTIMATE_PATH+'?account=other',{headers:{Cookie:'owner=secret',Authorization:'secret'}}),fetcher);
 assert.equal(response.status,503);assert.equal((await response.json()).error,'NETWORK_ESTIMATE_UNAVAILABLE');
 for(const method of ['POST','PUT','DELETE'])assert.equal((await routeRuntime(new Request('https://numinalabs.xyz'+LOCAL_ESTIMATE_PATH,{method}),fetcher)).status,405);
 const head=await routeRuntime(new Request('https://numinalabs.xyz'+LOCAL_ESTIMATE_PATH,{method:'HEAD'}),fetcher);assert.equal(head.status,503);
 assert.equal(calls,0);
});
