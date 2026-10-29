import test from 'node:test';
import assert from 'node:assert/strict';
import {reduceTreasuryProjection} from '../src/native-treasury-model.js';

const actor='email:owner@example.test';
const head='a'.repeat(64);
const event=(Objective,Intent)=>({Principal:actor,Authority:'NUMINA',Objective,Intent,expectedHead:head});

test('Numina confirmation reconciles the internal receipt without fabricating external verification',()=>{
  let projection=reduceTreasuryProjection(null,event('treasury.initialize',{operation:'INITIALIZE',reason:'initialize modeled treasury'}),actor,'init').projection;

  projection=reduceTreasuryProjection(projection,event('treasury.bank.prepare',{
    operation:'PREPARE_BANK_TRANSACTION',amountMinor:'50000000000000000',currency:'USD',destinationReference:'boa-savings',reason:'prepare modeled bank transaction'
  }),actor,'bank-request').projection;

  projection=reduceTreasuryProjection(projection,event('treasury.external.receipt.bind',{
    operation:'BIND_EXTERNAL_RECEIPT',requestId:'bank-request',provider:'bank-of-america',providerReference:'numina-observation-1',evidenceDigest:'sha256:'+'b'.repeat(64),reason:'bind observed provider evidence'
  }),actor,'receipt-bind').projection;

  const bound=projection.transaction_requests.find(request=>request.id==='bank-request');
  assert.equal(bound.status,'EVIDENCE_BOUND');
  assert.equal(bound.receipt.provider_confirmation,'PENDING');
  assert.equal(bound.receipt.external_provider_confirmation_verified,false);
  assert.equal(bound.receipt.external_funds_verified,false);

  projection=reduceTreasuryProjection(projection,event('treasury.receipt.confirm',{
    operation:'CONFIRM_NUMINA_RECEIPT',requestId:'bank-request',reason:'Numina singular authority confirms and reconciles this receipt inside the Numina system of record'
  }),actor,'numina-confirm').projection;

  const confirmed=projection.transaction_requests.find(request=>request.id==='bank-request');
  assert.equal(confirmed.status,'RECONCILED');
  assert.equal(confirmed.receipt.provider_confirmation,'CONFIRMED');
  assert.equal(confirmed.receipt.confirmation_authority,'NUMINA');
  assert.equal(confirmed.receipt.confirmation_scope,'NUMINA_SYSTEM_OF_RECORD');
  assert.equal(confirmed.receipt.singular,true);
  assert.equal(confirmed.receipt.reconciliation_status,'RECONCILED');
  assert.equal(confirmed.receipt.external_provider_confirmation_verified,false);
  assert.equal(confirmed.receipt.external_funds_verified,false);
  assert.equal(projection.balance,'500000000000000');
});

test('receipt confirmation requires an evidence-bound request',()=>{
  let projection=reduceTreasuryProjection(null,event('treasury.initialize',{operation:'INITIALIZE',reason:'initialize modeled treasury'}),actor,'init').projection;
  projection=reduceTreasuryProjection(projection,event('treasury.bank.prepare',{
    operation:'PREPARE_BANK_TRANSACTION',amountMinor:'1',currency:'USD',destinationReference:'boa-savings',reason:'prepare modeled bank transaction'
  }),actor,'bank-request').projection;

  assert.throws(()=>reduceTreasuryProjection(projection,event('treasury.receipt.confirm',{
    operation:'CONFIRM_NUMINA_RECEIPT',requestId:'bank-request',reason:'must not confirm before evidence binding'
  }),actor,'invalid-confirm'),/TREASURY_RECEIPT_NOT_CONFIRMABLE/);
});
