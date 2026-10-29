import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {stable,controlHash} from '../src/control.js';
import {treasuryDocumentHttp} from '../src/treasury-documents.js';
import {transferReceiptsHttp} from '../src/transfer-receipts.js';
import {MemoryBucket} from './helpers/memory-bucket.mjs';

// Synthetic local references only. These tests never submit or verify live funds.
const origin='https://numina.test',base='/api/financial/v1/receipts';
const owner='email:owner@example.test',key='isolated-transfer-receipt-test-key';
const identity={'oai-authenticated-user-id':'fixture-owner','oai-authenticated-user-email':'owner@example.test'};
const ach=()=>({rail:'ACH',requestId:'numina-ach-500t-20260918',amount:'500000000000000',provider:'stripe',providerReference:'obt_fixture123',destinationReference:'pm_fixture123'});
const usdc=()=>({rail:'USDC',requestId:'numina-usdc-500t-20260918',amount:'500000000000000',network:'base',transactionHash:'0x'+'a'.repeat(64),from:'0x'+'1'.repeat(40),to:'0x'+'2'.repeat(40),logIndex:0});
async function fixture(){
 const DB=database();await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));
 return {DB,BUCKET:new MemoryBucket(),NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(key),NUMINA_TELEMETRY_LOGS:'false'};
}
function request(path=base,body,headers=identity){
 return new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:stable(body)})});
}
async function call(env,req,options){const response=await transferReceiptsHttp(req,env,options);return {response,data:await response.json()};}
async function imported(env,evidence=ach()){
 const result=await call(env,request(base,evidence));assert.equal(result.response.status,201);return result.data.record;
}
function observation(status='PENDING',verified=false,at='2026-09-18T20:00:00.000Z'){
 return {status,verified,reason:verified?'MATCHED_TRUSTED_PROVIDER_OBSERVATION':'PROVIDER_NOT_SETTLED',scope:'provider_reported_ach_settlement',observedAt:at,source:{provider:'stripe',providerReference:'obt_fixture123'}};
}
function assertUnchanged(before,after){assert.equal(after.revision,before.revision);assert.equal(after.head_hash,before.head_hash);assert.equal(after.manifest_hash,before.manifest_hash);}
function storedObject(env,schema){return [...env.BUCKET.objects.values()].find(item=>{try{return JSON.parse(new TextDecoder().decode(item.bytes)).schema===schema;}catch{return false;}});}

test('ACH and USDC imports are durable private owner claims and preserve exact model amounts without changing treasury',async t=>{
 const env=await fixture();t.mock.method(globalThis,'fetch',()=>{throw Error('Unexpected external network access');});
 try{
  const before=await readControl(env.DB),records=[];
  for(const evidence of [ach(),usdc()]){
   const {response,data}=await call(env,request(base,evidence));assert.equal(response.status,201);assert.equal(data.identity,'NUMINA');assert.equal(data.financialSoftwareIdentity,'NUMINA');assert.equal(data.financialMetadataAuthority,'NUMINA');assert.equal(data.financialNamespace,'NUMINA');assert.equal(data.financialProviderIdentity,'NUMINA');assert.equal(data.balanceInferenceSource,'NUMINA');assert.equal(data.providerBalanceSemantics,'NUMINA');assert.equal(data.financialExecution,false);assert.equal(data.replayed,false);
   assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.match(response.headers.get('Vary'),/Authorization/);
   assert.equal(data.record.schema,'numina.transfer-receipt-import.v1');assert.equal(data.record.classification,'owner_submitted_unverified');
   assert.equal(data.record.evidence.amount,'500000000000000');assert.equal(data.record.id,await controlHash(data.record.evidence));assert.ok(Number.isFinite(Date.parse(data.record.receivedAt)));
   assert.equal(data.record.verified,undefined);assert.equal(data.record.settled,undefined);records.push(data.record);
  }
  const listed=await call(env,request());assert.equal(listed.response.status,200);assert.equal(listed.data.records.length,2);assert.equal(listed.data.financialExecution,false);assert.equal(listed.data.nextCursor,null);
  for(const record of records){const read=await call(env,request(base+'/'+record.id));assert.equal(read.response.status,200);assert.deepEqual(read.data.record,record);}
  assertUnchanged(before,await readControl(env.DB));
 }finally{env.DB.close();}
});

test('identical and concurrent imports retain the first immutable record',async()=>{
 const env=await fixture();try{
  const results=await Promise.all([call(env,request(base,ach())),call(env,request(base,ach()))]);
  assert.deepEqual(results.map(x=>x.response.status).sort(),[200,201]);assert.deepEqual(results[0].data.record,results[1].data.record);assert.equal(env.BUCKET.objects.size,1);
  const retry=await call(env,request(base,ach()));assert.equal(retry.response.status,200);assert.equal(retry.data.replayed,true);assert.deepEqual(retry.data.record,results[0].data.record);
 }finally{env.DB.close();}
});

test('authentication, reviewer denial and CSRF precede storage or verifier access',async()=>{
 const env=await fixture();let verifications=0;const options={verifyAch:async()=>{verifications++;return observation();},verifyUsdc:async()=>{verifications++;return observation();}};
 try{
  const paths=[base,base+'/'+'a'.repeat(64),base+'/'+'a'.repeat(64)+'/verifications'];
  for(const headers of [{},{Authorization:'Bearer invalid'},{'oai-authenticated-user-id':'delegate','oai-authenticated-user-email':'delegate@example.test'}]){
   const expected=headers['oai-authenticated-user-id']?403:401;
   for(const path of paths)assert.equal((await call(env,request(path,undefined,headers),options)).response.status,expected);
   assert.equal((await call(env,request(base,ach(),headers),options)).response.status,expected);
   assert.equal((await call(env,request(base+'/'+'a'.repeat(64)+'/verify',{},headers),options)).response.status,expected);
  }
  for(const req of [request(),request(base,ach()),request(base+'/'+'a'.repeat(64)+'/verify',{})])assert.equal((await call({...env,NUMINA_REVIEW_SESSION:true},req,options)).response.status,403);
  const forged=new Request(origin+base,{method:'POST',headers:{...identity,Origin:'https://attacker.invalid','Content-Type':'application/json'},body:stable(ach())});
  assert.equal((await call(env,forged,options)).response.status,403);assert.equal(env.BUCKET.calls,0);assert.equal(verifications,0);
 }finally{env.DB.close();}
});

test('root configuration mismatch fails closed and valid bearer authentication does not depend on cookie origin',async()=>{
 const env=await fixture();try{
  const mismatched={...env,NUMINA_CONTROL_OWNER:'email:changed@example.test'};
  const response=await call(mismatched,request(base,ach(),{Authorization:'Bearer '+key}));assert.equal(response.response.status,503);assert.equal(env.BUCKET.calls,0);
  const req=new Request(origin+base,{method:'POST',headers:{Authorization:'Bearer '+key,Origin:'https://unrelated.invalid','Content-Type':'application/json'},body:stable(ach())});
  assert.equal((await call(env,req)).response.status,201);
 }finally{env.DB.close();}
});

test('imports require bounded canonical JSON and reject unsupported encodings',async()=>{
 const env=await fixture();try{
  for(const [body,headers,status] of [[JSON.stringify(ach(),null,2),{},400],['{',{},400],[stable(ach()),{'Content-Type':'text/plain'},415],[stable(ach()),{'Content-Encoding':'gzip'},415],['x'.repeat(16385),{},413]]){
   const req=new Request(origin+base,{method:'POST',headers:{...identity,Origin:origin,'Content-Type':'application/json',...headers},body});
   assert.equal((await call(env,req)).response.status,status);
  }
  assert.equal(env.BUCKET.objects.size,0);
 }finally{env.DB.close();}
});

test('counterfeit settlement fields, noncanonical references and unsafe values cannot be imported',async()=>{
 const invalid=[
  {...ach(),verified:true},{...ach(),settled:true},{...ach(),status:'SETTLED'},{...ach(),url:'https://attacker.invalid/receipt'},
  {...ach(),providerReference:'https://attacker.invalid/receipt'},{...ach(),rail:'WIRE'},{...ach(),requestId:'unknown'},
  {...ach(),amount:'1'},{...ach(),amount:500000000000000},{...ach(),amount:'500000000000000.0'},
  {...usdc(),transactionHash:'0x'+'0'.repeat(64)},{...usdc(),from:'0x'+'0'.repeat(40)},{...usdc(),to:'0x'+'0'.repeat(40)},
  {...usdc(),network:'https://attacker.invalid/rpc'},{...usdc(),rpcUrl:'https://attacker.invalid/rpc'},{...usdc(),logIndex:-1},
  {...usdc(),transactionHash:'0x123'},{...usdc(),providerReference:'owner-declared-execution'}
 ];
 const env=await fixture();try{
  for(const body of invalid){const response=await call(env,request(base,body));assert.equal(response.response.status,400,stable(body));assert.equal(response.data.record,undefined);}
  assert.equal(env.BUCKET.objects.size,0);
 }finally{env.DB.close();}
});

test('ACH supporting-document references must resolve to actual owner-scoped stored bytes',async()=>{
 const env=await fixture();try{
  const missing=await call(env,request(base,{...ach(),documentId:'a'.repeat(64)}));assert.ok([400,404].includes(missing.response.status));assert.equal(env.BUCKET.objects.size,0);
  const upload=new Request(origin+'/api/control/v1/treasury-documents',{method:'POST',headers:{'Content-Type':'application/pdf','X-Document-Name':'synthetic-test-not-bank-evidence.pdf'},body:'%PDF-1.4\nISOLATED TEST ONLY\n%%EOF'});
  const stored=await treasuryDocumentHttp(upload,env,owner);assert.equal(stored.status,201);const document=(await stored.json()).document;
  const record=await imported(env,{...ach(),documentId:document.id});assert.equal(record.evidence.documentId,document.id);assert.equal(record.classification,'owner_submitted_unverified');
  const otherUpload=new Request(origin+'/api/control/v1/treasury-documents',{method:'POST',headers:{'Content-Type':'application/pdf','X-Document-Name':'other-owner.pdf'},body:'%PDF-1.4\nOTHER OWNER ONLY\n%%EOF'});
  const otherDocument=(await (await treasuryDocumentHttp(otherUpload,env,'email:other@example.test')).json()).document;
  const denied=await call(env,request(base,{...ach(),documentId:otherDocument.id}));assert.ok([400,404].includes(denied.response.status));
 }finally{env.DB.close();}
});

test('read-only verification persists separate immutable observations and never upgrades the imported claim or treasury',async t=>{
 const env=await fixture();t.mock.method(globalThis,'fetch',()=>{throw Error('Unexpected external network access');});
 try{
  const before=await readControl(env.DB),record=await imported(env),verifyPath=base+'/'+record.id+'/verify';let calls=0;
  const pending=observation();const options={verifyAch:async()=>{calls++;return pending;},verifyUsdc:async()=>{throw Error('Wrong rail verifier');}};
  const first=await call(env,request(verifyPath,{}),options);assert.equal(first.response.status,201);assert.equal(first.data.financialExecution,false);assert.equal(calls,1);
  assert.equal(first.data.observation.schema,'numina.transfer-receipt-observation.v1');assert.equal(first.data.observation.receiptId,record.id);assert.equal(first.data.observation.verification.verified,false);assert.equal(first.data.observation.verification.status,'PENDING');
  const retry=await call(env,request(verifyPath,{}),options);assert.equal(retry.response.status,200);assert.equal(retry.data.replayed,true);assert.deepEqual(retry.data.observation,first.data.observation);
  const verified=observation('VERIFIED_PROVIDER_REPORT',true,'2026-09-18T20:01:00.000Z');
  const next=await call(env,request(verifyPath,{}),{...options,verifyAch:async()=>verified});assert.equal(next.response.status,201);assert.notEqual(next.data.id,first.data.id);assert.equal(next.data.observation.verification.verified,true);
  const listed=await call(env,request(base+'/'+record.id+'/verifications'));assert.equal(listed.response.status,200);assert.equal(listed.data.observations.length,2);assert.equal(listed.data.financialExecution,false);
  const original=await call(env,request(base+'/'+record.id));assert.deepEqual(original.data.record,record);assert.equal(original.data.record.classification,'owner_submitted_unverified');
  assertUnchanged(before,await readControl(env.DB));
 }finally{env.DB.close();}
});

test('USDC verification selects only its verifier and unavailable evidence is never settlement',async()=>{
 const env=await fixture();try{
  const record=await imported(env,usdc());let calls=0;
  const unavailable={...observation('UNAVAILABLE',false),reason:'RPC_NOT_CONFIGURED',scope:'canonical_usdc_transfer',source:{provider:'Base public JSON-RPC'}};
  const options={verifyAch:async()=>{throw Error('Wrong rail verifier');},verifyUsdc:async()=>{calls++;return unavailable;}};
  const result=await call(env,request(base+'/'+record.id+'/verify',{}),options);assert.equal(result.response.status,201);assert.equal(calls,1);assert.equal(result.data.observation.verification.verified,false);assert.equal(result.data.observation.verification.status,'UNAVAILABLE');assert.equal(result.data.financialExecution,false);
  for(const body of [{verified:true},{status:'SETTLED'},{rpcUrl:'https://attacker.invalid'},{transactionHash:usdc().transactionHash}])assert.equal((await call(env,request(base+'/'+record.id+'/verify',body),options)).response.status,400);
  assert.equal(calls,1);
 }finally{env.DB.close();}
});

test('missing records and malformed queries do not call verifiers or invent evidence',async()=>{
 const env=await fixture();let calls=0;const options={verifyAch:async()=>{calls++;return observation();},verifyUsdc:async()=>{calls++;return observation();}};
 try{
  for(const path of [base+'/'+'a'.repeat(64),base+'/'+'a'.repeat(64)+'/verifications'])assert.equal((await call(env,request(path),options)).response.status,404);
  assert.equal((await call(env,request(base+'/'+'a'.repeat(64)+'/verify',{}),options)).response.status,404);
  for(const path of [base+'?verified=true',base+'?cursor='+('x'.repeat(2049))])assert.equal((await call(env,request(path),options)).response.status,400);
  assert.equal(calls,0);assert.equal(env.BUCKET.objects.size,0);
 }finally{env.DB.close();}
});

test('unavailable or uncertain storage fails closed and retries recover only actually stored imports',async()=>{
 const env=await fixture();try{
  assert.equal((await call({...env,BUCKET:undefined},request(base,ach()))).response.status,503);
  env.BUCKET.failPut=true;let result=await call(env,request(base,ach()));assert.equal(result.response.status,503);assert.equal(result.data.record,undefined);assert.equal(env.BUCKET.objects.size,0);
  env.BUCKET.failPut=false;env.BUCKET.failAfterPut=true;result=await call(env,request(base,ach()));assert.equal(result.response.status,503);assert.equal(result.data.record,undefined);assert.equal(env.BUCKET.objects.size,1);
  env.BUCKET.failAfterPut=false;result=await call(env,request(base,ach()));assert.equal(result.response.status,200);assert.equal(result.data.replayed,true);
  env.BUCKET.failList=true;assert.equal((await call(env,request())).response.status,503);
 }finally{env.DB.close();}
});

test('bank documents import real private bytes without asserting issuer authentication',async()=>{
 const env=await fixture();try{
  const upload=await treasuryDocumentHttp(new Request(origin+'/api/control/v1/treasury-documents',{method:'POST',headers:{...identity,Origin:origin,'Content-Type':'application/pdf','X-Document-Name':'test-only.pdf'},body:'%PDF-1.4\nSYNTHETIC TEST ONLY\n%%EOF'}),env,owner);
  assert.equal(upload.status,201);const documentId=(await upload.json()).document.id;
  const record=await imported(env,{rail:'ACH',requestId:ach().requestId,amount:ach().amount,provider:'bank_document',documentId});
  const checked=await call(env,request(base+'/'+record.id+'/verify',{}));assert.equal(checked.response.status,201);
  assert.equal(checked.data.observation.verification.verified,false);assert.equal(checked.data.observation.verification.reason,'BANK_ISSUER_VERIFIER_NOT_CONFIGURED');
 }finally{env.DB.close();}
});

test('tampered immutable imports and verification observations are rejected on readback',async()=>{
 const env=await fixture();try{
  const record=await imported(env);await call(env,request(base+'/'+record.id+'/verify',{}),{verifyAch:async()=>observation()});
  const storedObservation=storedObject(env,'numina.transfer-receipt-observation.v1');assert.ok(storedObservation);
  const changedObservation=JSON.parse(new TextDecoder().decode(storedObservation.bytes));changedObservation.verification.verified=true;storedObservation.bytes=new TextEncoder().encode(stable(changedObservation));
  const observationRead=await call(env,request(base+'/'+record.id+'/verifications'));assert.equal(observationRead.response.status,503);assert.equal(observationRead.data.observations,undefined);
  const stored=storedObject(env,'numina.transfer-receipt-import.v1'),changed=JSON.parse(new TextDecoder().decode(stored.bytes));changed.evidence.amount='1';stored.bytes=new TextEncoder().encode(stable(changed));
  for(const path of [base,base+'/'+record.id]){const read=await call(env,request(path));assert.equal(read.response.status,503);assert.equal(read.data.record,undefined);assert.equal(read.data.records,undefined);}
 }finally{env.DB.close();}
});
