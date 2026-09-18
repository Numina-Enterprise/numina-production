import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAchReceipt} from '../src/ach-receipt-verifier.js';
import {STRIPE_TREASURY_FINANCIAL_ACCOUNT as account} from '../src/stripe-treasury.js';
// Entirely synthetic fixtures. No live payments or live transaction references.
const evidence={rail:'ACH',amount:'500000000000000',provider:'stripe',providerReference:'obt_fixture123',destinationReference:'usba_fixture123'};
const env={NUMINA_STRIPE_TREASURY_READ_KEY:'rk_live_'+'X'.repeat(20),NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:account};
const amount=()=>({value:'EXACT_INTEGER',currency:'usd'});
function report(){return {id:evidence.providerReference,object:'v2.money_management.outbound_transfer',livemode:true,amount:amount(),from:{financial_account:account,debited:amount()},to:{payout_method:evidence.destinationReference,credited:amount()},delivery_options:{bank_account:'local'},status:'posted',status_transitions:{posted_at:'2026-09-18T00:00:00Z'},trace_id:{status:'supported',value:'fixture-trace-only'}};}
const response=value=>new Response(JSON.stringify(value).replaceAll('"EXACT_INTEGER"','50000000000000000'),{headers:{'request-id':'req_fixture'}});
test('matches exact large provider amounts with GET only without asserting bank settlement',async()=>{
 let calls=0;const result=await verifyAchReceipt(evidence,env,{fetcher:async(url,options)=>{calls++;assert.equal(url,'https://api.stripe.com/v2/money_management/outbound_transfers/obt_fixture123');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');return response(report());}});
 assert.equal(calls,1);assert.equal(result.status,'VERIFIED_PROVIDER_REPORT');assert.equal(result.verified,true);assert.equal(result.source.amountMinorUnits,'50000000000000000');assert.equal(result.source.bankSettlementVerified,false);assert.equal(result.source.achConfirmationVerified,false);assert.equal(result.source.providerTraceId,'fixture-trace-only');assert.equal(result.settled,undefined);
 assert.doesNotMatch(JSON.stringify(result),/rk_live/);
});
test('mismatched fields, unknown rail, testmode, returns and pending status never assert settlement',async()=>{
 for(const mutate of [v=>v.id='obt_other12345',v=>v.livemode=false,v=>v.from.financial_account='other',v=>v.to.payout_method='usba_other123',v=>v.amount.currency='usdc',v=>v.from.debited.value=5,v=>v.to.credited.value=2,v=>v.delivery_options.bank_account='automatic',v=>v.delivery_options.bank_account='wire',v=>v.status='returned',v=>v.status='failed',v=>v.status='canceled',v=>v.status='processing',v=>v.status_transitions.posted_at=null]){
  const data=report();mutate(data);const result=await verifyAchReceipt(evidence,env,{fetcher:async()=>response(data)});assert.equal(result.verified,false);assert.equal(result.settled,undefined);
 }
});
test('unsupported credentials and references make no request; bank documents stay unverified',async()=>{
 const options={fetcher:async()=>{throw Error('Must not request');}};
 for(const data of [{...evidence,providerReference:'https://attacker.invalid'},{...evidence,amount:500000000000000}])assert.equal((await verifyAchReceipt(data,env,options)).reason,'EVIDENCE_INVALID');
 assert.equal((await verifyAchReceipt(evidence,{},options)).status,'UNAVAILABLE');
 const doc=await verifyAchReceipt({rail:'ACH',provider:'bank_document',documentId:'a'.repeat(64)},env,options);assert.equal(doc.verified,false);assert.equal(doc.reason,'BANK_ISSUER_VERIFIER_NOT_CONFIGURED');
});
test('provider failures, redirects, malformed and overlarge data fail closed without leaking diagnostics',async t=>{
 for(const fetcher of [async()=>new Response(null,{status:302}),async()=>new Response(null,{status:404}),async()=>new Response('{'),async()=>new Response('x'.repeat(65537)),async()=>{throw Error('private key diagnostic');}]){
  const result=await verifyAchReceipt(evidence,env,{fetcher});assert.equal(result.verified,false);assert.doesNotMatch(JSON.stringify(result),/private key diagnostic/);
 }
 t.mock.timers.enable({apis:['setTimeout']});let signal;const work=verifyAchReceipt(evidence,env,{fetcher:(_u,o)=>{signal=o.signal;return new Promise(()=>{});}});t.mock.timers.tick(8001);assert.equal((await work).status,'UNAVAILABLE');assert.equal(signal.aborted,true);
});
