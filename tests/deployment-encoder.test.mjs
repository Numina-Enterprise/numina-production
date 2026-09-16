import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareDeployment,loadPreparationAssets,ASSET_PATHS} from '../public/deployment-encoder.js';
import {validateReadinessSource,createLocalDraft,importLocalDraft} from '../public/deployment-readiness-model.js';
import {NUSD_SIMULATION} from '../src/nusd-http.js';
const seed=await validateReadinessSource(JSON.parse(readFileSync(new URL('../public/deployment-readiness-inputs.json',import.meta.url))),NUSD_SIMULATION);
const assets=Object.fromEntries(Object.entries(ASSET_PATHS).map(([key,path])=>[key,readFileSync(new URL('../docs/'+path.slice('/downloads/'.length),import.meta.url))]));
const recipient='0x1a45671AE2ee3E52264116151924FAAcb80Fc02E';
const complete={recipient,sender:'0x1111111111111111111111111111111111111111',chainId:'962421430',genesisHash:'0x'+'1'.repeat(64),nonce:'0',maximumFee:'1000000',gasLimit:'500000',gasPrice:'2',feeAsset:'TEST'};
test('browser encoding matches exact independently decoded offline output and preserves execution boundaries',async()=>{
 const result=await prepareDeployment(seed,{recipient},assets);
 assert.equal(result.review.status,'UNSIGNED_CONSTRUCTOR_REVIEW');
 assert.equal(result.review.constructorDataSha256,'6d16a0ac9b854dc7e28914088e28193b1896201cddd0f48b5069c35f35793202');
 assert.equal(result.review.requestSha256,'8eb2b6fdf43415a931ddd183ae7c90c5a9744dc8a46ef161ddfdaacfceafa679');
 assert.equal((result.review.constructorData.length-2)/2,10746);
 assert.equal(result.transactionDraft,null);assert.ok(result.missingTransactionInputs.includes('sender'));
 assert.equal(result.signed,false);assert.equal(result.broadcast,false);assert.equal(result.receipt,null);assert.equal(result.productionReady,false);
 assert.equal(result.review.unresolvedReviews.length,8);
});
test('tampered artifact, source and policy cannot encode',async()=>{
 for(const key of Object.keys(assets)){
  const changed={...assets,[key]:new Uint8Array([...assets[key],32])};
  const result=await prepareDeployment(seed,{recipient},changed);
  assert.equal(result.review.status,'BLOCKED');assert.equal(result.review.constructorData,null);assert.equal(result.transactionDraft,null);
 }
});
test('checksum validation rejects invalid mixed-case addresses without inferring the sender',async()=>{
 const result=await prepareDeployment(seed,{recipient:recipient.replace('AE2','aE2')},assets);
 assert.equal(result.review.status,'BLOCKED');
 await assert.rejects(prepareDeployment(seed,{...complete,sender:recipient.replace('AE2','aE2')},assets));
});
test('transaction draft uses exact fee math, enforces budget and never trusts injected approvals',async()=>{
 const result=await prepareDeployment(seed,{...complete,signed:true,broadcast:true,productionReady:true},assets);
 assert.equal(result.transactionDraft.fee.calculatedTotalBaseUnits,'1000000');
 assert.equal(result.transactionDraft.transaction.from,complete.sender);assert.equal(result.transactionDraft.transaction.value,'0');assert.equal(result.transactionDraft.transaction.to,null);
 assert.equal(result.transactionDraft.signed,false);assert.equal(result.transactionDraft.network.identityVerified,false);
 assert.equal(result.transactionDraft.transaction.data,result.review.constructorData);
 await assert.rejects(prepareDeployment(seed,{...complete,maximumFee:'999999'},assets),/exceeds/);
 const free=await prepareDeployment(seed,{...complete,gasPrice:'0',maximumFee:'0'},assets);assert.equal(free.transactionDraft.fee.calculatedTotalBaseUnits,'0');
 for(const change of [{gasLimit:'0'},{gasPrice:'2e9'},{nonce:0},{feeAsset:'secret key text'},{chainId:'1'},{nonce:'9007199254740992'}]){
  if(change.nonce===0){const r=await prepareDeployment(seed,{...complete,...change},assets);assert.equal(r.transactionDraft,null);}
  else await assert.rejects(prepareDeployment(seed,{...complete,...change},assets));
 }
});
test('asset loading enforces a body-inclusive deadline and size cap',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(new ReadableStream({start(){}}));
  await assert.rejects(loadPreparationAssets(undefined,10),/timed out/);
  globalThis.fetch=async()=>new Response(new Uint8Array(2000001));
  await assert.rejects(loadPreparationAssets(),/exceeds/);
 }finally{globalThis.fetch=original;}
});
test('inputs and artifact bytes are snapshotted before async hashing',async()=>{
 const input={...complete},copied=structuredClone(assets),pending=prepareDeployment(seed,input,copied);
 input.recipient=complete.sender;input.gasPrice='999';copied.artifactBytes[0]=0;
 const result=await pending;assert.equal(result.review.constructor.initialRecipient,recipient);assert.equal(result.transactionDraft.transaction.gasPrice,'2');
});
test('v2 drafts round-trip fees and v1 imports remain supported without trusting extra fields',()=>{
 const draft=createLocalDraft(complete);assert.equal(draft.schema,'numina.deployment-readiness-draft.v2');assert.deepEqual(importLocalDraft(JSON.stringify(draft)).inputs,draft.inputs);
 const v1={...draft,schema:'numina.deployment-readiness-draft.v1',inputs:{recipient},signed:true};
 const imported=importLocalDraft(JSON.stringify(v1));assert.equal(imported.inputs.gasPrice,null);assert.equal(imported.signed,false);
});
test('asset loader uses only fixed credential-free read requests',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(path,options)=>{calls.push({path,options});return new Response(assets[Object.keys(ASSET_PATHS).find(key=>ASSET_PATHS[key]===path)]);};
 try{await loadPreparationAssets();assert.equal(calls.length,3);for(const {path,options} of calls){assert.ok(Object.values(ASSET_PATHS).includes(path));assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');}}
 finally{globalThis.fetch=original;}
});
