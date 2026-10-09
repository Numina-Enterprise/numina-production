import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transferReceiptCanonical,transferReceiptStatusLabel,TRANSFER_RECEIPT_CLIENT_ROUTE} from '../public/transfer-receipts.js';
import {stable} from '../src/control.js';
import worker from '../src/worker.js';
test('client canonical encoding agrees with authenticated request format and labels scoped evidence',()=>{
 const sample={z:[{b:2,a:'quoted"\\value'}],a:{d:false,c:null}};
 assert.equal(transferReceiptCanonical(sample),stable(sample));
 assert.equal(TRANSFER_RECEIPT_CLIENT_ROUTE,'/api/financial/v1/receipts');
 assert.match(transferReceiptStatusLabel('VERIFIED_PROVIDER_REPORT'),/bank settlement unverified/);
 assert.match(transferReceiptStatusLabel('VERIFIED_ONCHAIN_TRANSFER'),/scope limited/);
 assert.equal(transferReceiptStatusLabel('SETTLED'),'Not verified');
});
test('production worker dispatches receipt routes and anonymous reads fail before storage',async()=>{
 let called=false;const response=await worker.fetch(new Request('https://numina.test'+TRANSFER_RECEIPT_CLIENT_ROUTE),{NUMINA_CONTROL_OWNER:'email:owner@example.test',NUMINA_TELEMETRY_LOGS:'false',BUCKET:{get(){called=true;}}});
 assert.equal(response.status,401);assert.equal(called,false);assert.equal((await response.json()).financialExecution,false);
});
test('page is accessible and does not invent payment references or client settlement controls',()=>{
 const page=readFileSync(new URL('../public/transfer-receipts.html',import.meta.url),'utf8');
 const code=readFileSync(new URL('../public/transfer-receipts.js',import.meta.url),'utf8');
 assert.match(page,/Import evidence only/);assert.match(page,/Owner authentication is required/);
 assert.match(page,/blockchain transaction hash/);assert.match(page,/six token decimals/);assert.match(page,/role="status"/);
 assert.doesNotMatch(page,/<script[^>]*>[^<]+<\/script>/);assert.doesNotMatch(code,/innerHTML|eth_send|eth_sign|sendRawTransaction/);
 assert.match(code,/pagehide/);assert.match(code,/scope.reset/);assert.match(code,/scope.isCurrent/);
});
