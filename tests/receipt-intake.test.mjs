import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evidence} from './fixtures/receipt-observation-fixture.mjs';
import {MAX_RECEIPT_BYTES,RECEIPT_INPUT_SCHEMA,RECEIPT_PROFILE,reviewReceiptText,receiptEvidenceTemplate} from '../public/receipt-intake-model.js';
const input=()=>({schema:RECEIPT_INPUT_SCHEMA,profile:RECEIPT_PROFILE,...evidence()});

test('checks synthetic supplied observations without wallet, network, mint or settlement effects',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('Unexpected network access');});
 const value=input();value.extraUntrustedText='<img src=x onerror=alert(1)>';
 const text=JSON.stringify(value),report=await reviewReceiptText(text);
 assert.equal(report.result.valid,true);assert.equal(report.inputSha256,createHash('sha256').update(text).digest('hex'));
 assert.equal(report.profile.initialSupplyBaseUnits,'1500000000000000000000');
 assert.equal(report.result.candidateDeployment.supplyBaseUnits,'1500000000000000000000');
 assert.equal(JSON.stringify(report).includes(value.extraUntrustedText),false);
 for(const key of ['receiptAuthenticityVerified','signatureCreated','broadcast','treasuryWritePerformed','mintPerformed','depositPerformed'])assert.equal(report[key],false);
 for(const key of ['independentNetworkVerification','fundsVerified','settlementVerified','reservesVerified','productionMetadataUpdated'])assert.equal(report.result[key],false);
});

test('rejects wrong schema, profile, malformed input and private material',async()=>{
 for(const [text,code]of [['','RECEIPT_REQUIRED'],['[1]','RECEIPT_STRUCTURE_INVALID'],['{','RECEIPT_JSON_INVALID'],[JSON.stringify({...input(),schema:'review-output'}),'RECEIPT_SCHEMA_UNSUPPORTED'],[JSON.stringify({...input(),profile:'500T'}),'RECEIPT_PROFILE_MISMATCH'],[JSON.stringify({...input(),extra:{private_key:'not-a-real-key'}}),'PRIVATE_MATERIAL_NOT_ACCEPTED'],[JSON.stringify({crypto:{ciphertext:'synthetic'}}),'PRIVATE_MATERIAL_NOT_ACCEPTED']])await assert.rejects(reviewReceiptText(text),{code});
});

test('rejects oversized UTF-8 input and excessive nesting',async()=>{
 await assert.rejects(reviewReceiptText('x'.repeat(MAX_RECEIPT_BYTES+1)),{code:'RECEIPT_TOO_LARGE'});
 await assert.rejects(reviewReceiptText(JSON.stringify({...input(),note:'€'.repeat(MAX_RECEIPT_BYTES/2)})),{code:'RECEIPT_TOO_LARGE'});
 let nested={};for(let i=0;i<132;i++)nested={nested};
 await assert.rejects(reviewReceiptText(JSON.stringify({...input(),nested})),{code:'RECEIPT_STRUCTURE_INVALID'});
});

test('a failed receipt, wrong mint amount and eleven confirmations cannot become a passing review',async()=>{
 for(const change of [v=>v.receipt.status='0x0',v=>v.receipt.logs[0].data='0x'+'0'.repeat(64),v=>v.headBlock.number='0x6e',v=>v.candidate.genesisHash='0x'+'f'.repeat(64)]){
  const value=input();change(value);const report=await reviewReceiptText(JSON.stringify(value));
  assert.equal(report.result.valid,false);assert.equal(report.result.candidateDeployment,null);assert.equal(report.mintPerformed,false);
 }
});

test('required-fields template contains no receipt, result, fee observation or mint evidence',async()=>{
 const value=receiptEvidenceTemplate();assert.equal(value.profile,RECEIPT_PROFILE);
 assert.equal(value.receipt,null);assert.equal(value.transaction,null);assert.equal(value.candidate.submittedHash,null);assert.equal(value.candidate.data,null);
 assert.equal(value.candidate.gasPrice,null);assert.equal(value.calls.length,14);assert.ok(value.calls.every(call=>call.result===null));
 const report=await reviewReceiptText(JSON.stringify(value));assert.equal(report.result.valid,false);assert.equal(report.result.candidateDeployment,null);
});
