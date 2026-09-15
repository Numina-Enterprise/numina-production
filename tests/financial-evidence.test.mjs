import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {stable,controlHash} from '../src/control.js';
import {validateFinancialEvidence,assessFinancialEvidence,FINANCIAL_SERVICES} from '../public/financial-model.js';
import {MemoryBucket} from './helpers/memory-bucket.mjs';
import worker from '../src/worker.js';
const origin='https://numina.test',owner='email:owner@example.test',identity={'oai-authenticated-user-id':'fixture-owner','oai-authenticated-user-email':'owner@example.test'};
const sample={service:'personal_lender',kind:'loan_terms',entity:'Local test entity',provider:'Local test provider',relationship:'Software test only; not an operating relationship',jurisdictions:['US-IA'],reference:'LOCAL-TEST',sourceUrl:'https://example.test/terms',expiresOn:'2026-09-14',documentId:'a'.repeat(64),note:'Local fixture only. No financial authority.'};
const req=(path,body,headers=identity)=>new Request(origin+path,{method:body?'POST':'GET',headers:{...headers,...(body?{Origin:origin,'Content-Type':'application/json'}:{})},...(body?{body:stable(body)}:{})});
async function fixture(){const DB=database();await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));return {DB,BUCKET:new MemoryBucket(),NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash('local-fixture-key'),NUMINA_TELEMETRY_LOGS:'false'};}
async function upload(env){const response=await worker.fetch(new Request(origin+'/api/control/v1/treasury-documents',{method:'POST',headers:{...identity,Origin:origin,'Content-Type':'application/pdf','X-Document-Name':'LOCAL-TEST-not-a-license.pdf'},body:'%PDF-1.4\nLOCAL TEST ONLY\n%%EOF'}),env);assert.equal(response.status,201);return (await response.json()).document.id;}

test('document registration persists actual receipts, is idempotent and does not change treasury',async()=>{const env=await fixture();try{
 const before=await readControl(env.DB),body={...sample,documentId:await upload(env)};
 const first=await worker.fetch(req('/api/financial/v1/evidence',body),env);assert.equal(first.status,201);const record=(await first.json()).record;assert.equal(record.classification,'owner_submitted_unverified');
 const retry=await worker.fetch(req('/api/financial/v1/evidence',body),env);assert.equal(retry.status,200);assert.equal((await retry.json()).replayed,true);
 const packet=await (await worker.fetch(req('/api/financial/v1/review-packet'),env)).json();assert.equal(packet.records.length,1);assert.equal(packet.readyForPlaySubmission,false);assert.equal(packet.financialExecution,false);assert.equal(packet.records[0].id,record.id);assert.equal(packet.assessment[0].expired,1);
 const after=await readControl(env.DB);assert.equal(after.revision,before.revision);assert.equal(after.head_hash,before.head_hash);
}finally{env.DB.close();}});
test('anonymous, delegate and reviewer cannot read or write private financial evidence',async()=>{const env=await fixture();try{
 for(const body of [undefined,sample])for(const headers of [{},{'oai-authenticated-user-id':'delegate','oai-authenticated-user-email':'other@example.test'}])assert.equal((await worker.fetch(req('/api/financial/v1/evidence',body,headers),env)).status,headers['oai-authenticated-user-id']?403:401);
 assert.equal((await worker.fetch(req('/api/financial/v1/evidence'),{...env,NUMINA_REVIEW_SESSION:true})).status,403);assert.equal(env.BUCKET.calls,0);
 const forged=new Request(origin+'/api/financial/v1/evidence',{method:'POST',headers:{...identity,Origin:'https://evil.test','Content-Type':'application/json'},body:stable(sample)});assert.equal((await worker.fetch(forged,env)).status,403);
}finally{env.DB.close();}});
test('unregistered files, invented verification flags and unsafe or malformed fields are rejected',async()=>{const env=await fixture();try{
 assert.equal((await worker.fetch(req('/api/financial/v1/evidence',sample),env)).status,404);
 for(const change of [{verified:true},{service:'bank'},{jurisdictions:['all']},{expiresOn:'2026-02-30'},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://user:secret@example.test'},{sourceUrl:'https://example.test/?token=secret'},{kind:'custody_terms'},{documentId:'../secret'},{note:'bad\u0000control'}])assert.throws(()=>validateFinancialEvidence({...sample,...change}));
 assert.equal(env.BUCKET.objects.size,0);
}finally{env.DB.close();}});
test('full document coverage never becomes licensing verification or enabled execution',()=>{
 const records=FINANCIAL_SERVICES.crypto_exchange.required.map(kind=>({evidence:{...sample,service:'crypto_exchange',kind,expiresOn:'2027-01-01'}}));const assessment=assessFinancialEvidence(records,'2026-09-15').find(x=>x.id==='crypto_exchange');assert.equal(assessment.documentCoverage,'present_for_review');assert.equal(assessment.verification,'not_independently_verified');assert.equal(assessment.financialExecution,false);
});
test('public manifest is static and never leaks private provider names or evidence',async()=>{const env=await fixture();try{
 const manifest=await worker.fetch(req('/api/financial/v1/manifest',undefined,{}),env);assert.equal(manifest.status,200);const text=await manifest.text();assert.ok(text.includes('register_evidence'));assert.equal(text.includes(sample.entity),false);assert.equal(env.BUCKET.calls,0);
 assert.equal((await worker.fetch(req('/api/financial/v1/manifest?provider=secret'),env)).status,400);
}finally{env.DB.close();}});
test('storage failures and corrupted evidence fail closed; saved registration can be recovered',async()=>{const env=await fixture();try{
 const body={...sample,documentId:await upload(env)};env.BUCKET.failAfterPut=true;assert.equal((await worker.fetch(req('/api/financial/v1/evidence',body),env)).status,503);env.BUCKET.failAfterPut=false;
 assert.equal((await worker.fetch(req('/api/financial/v1/evidence',body),env)).status,200);
 const entry=[...env.BUCKET.objects].find(([key])=>key.startsWith('financial-evidence/'))[1];const damaged=JSON.parse(new TextDecoder().decode(entry.bytes));damaged.evidence.entity='Tampered';entry.bytes=new TextEncoder().encode(stable(damaged));
 const failure=await worker.fetch(req('/api/financial/v1/review-packet'),env);assert.equal(failure.status,503);assert.equal((await failure.json()).error,'EVIDENCE_INTEGRITY_FAILED');
}finally{env.DB.close();}});
