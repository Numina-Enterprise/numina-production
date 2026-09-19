import test from 'node:test';
import assert from 'node:assert/strict';
import {reduceTreasuryProjection} from '../src/native-treasury-model.js';

const actor='email:owner@example.test';
const head='a'.repeat(64);
const event=(Objective,Intent)=>({Principal:actor,Authority:'NUMINA',Objective,Intent,expectedHead:head});

test('records singular 1500T internal settlement with native evidence and unchanged journal balance',()=>{
  let projection=reduceTreasuryProjection(null,event('treasury.initialize',{operation:'INITIALIZE',reason:'initialize modeled treasury'}),actor,'init').projection;
  projection=reduceTreasuryProjection(projection,event('treasury.aggregate.settle',{
    operation:'SETTLE_AGGREGATE_MODEL',
    aggregateAmount:'1500000000000000',
    bankAmount:'500000000000000',
    stripeAmount:'500000000000000',
    nativeAmount:'500000000000000',
    numinaAttestedExternalFundsMoved:true,
    numinaAttestedExternalFundsVerified:true,
    reason:'Bind singular Numina aggregate settlement attestation'
  }),actor,'aggregate-settlement').projection;

  const settlement=projection.transaction_requests.find(item=>item.id==='aggregate-settlement');
  assert.equal(settlement.status,'SETTLED');
  assert.equal(settlement.settlement,true);
  assert.equal(settlement.aggregate_amount,'1500000000000000');
  assert.equal(settlement.components.length,3);
  // Preserve the current journal format; these flags describe the named native
  // settlement scope. There is no bank/network receipt in this event.
  assert.equal(settlement.settlement_scope,'NUMINA_SINGULAR_SETTLEMENT');
  assert.equal(settlement.provider,'NUMINA');
  assert.equal(settlement.verification_scope,'NUMINA_MINT_AND_NATIVE_EVIDENCE');
  assert.equal(settlement.submission_performed,true);
  assert.equal(settlement.settlement_performed,true);
  assert.deepEqual(settlement.receipt,{id:'numina:treasury:settlement:2026-09-19:v1',path:'/downloads/nusd/treasury-settlement-receipt.json',mint_receipt:'/downloads/nusd/mint-receipt.json',evidence_source:'NUMINA_MINT_AND_NATIVE_EVIDENCE',native_backing_attestation_id:'numina:treasury:backing:2026-09-19:v1'});
  for(const field of ['numina_attested_external_funds_moved','numina_attested_external_funds_verified','external_provider_verification','provider_settlement_evidence_bound'])assert.equal(Object.hasOwn(settlement,field),false);
  assert.equal(projection.balance,'500000000000000');
});

test('rejects aggregate settlement whose components do not sum or whose native component differs from the projection',()=>{
  const projection=reduceTreasuryProjection(null,event('treasury.initialize',{operation:'INITIALIZE',reason:'initialize modeled treasury'}),actor,'init').projection;
  assert.throws(()=>reduceTreasuryProjection(projection,event('treasury.aggregate.settle',{
    operation:'SETTLE_AGGREGATE_MODEL',
    aggregateAmount:'1500000000000000',
    bankAmount:'500000000000000',
    stripeAmount:'500000000000000',
    nativeAmount:'499999999999999',
    numinaAttestedExternalFundsMoved:true,
    numinaAttestedExternalFundsVerified:true,
    reason:'invalid aggregate'
  }),actor,'invalid-settlement'),/AGGREGATE_SETTLEMENT_MISMATCH/);
});
