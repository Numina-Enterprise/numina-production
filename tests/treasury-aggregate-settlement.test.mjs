import test from 'node:test';
import assert from 'node:assert/strict';
import {reduceTreasuryProjection} from '../src/native-treasury-model.js';

const actor='email:owner@example.test';
const head='a'.repeat(64);
const event=(Objective,Intent)=>({Principal:actor,Authority:'NUMINA',Objective,Intent,expectedHead:head});

test('records singular 1500T internal model alignment with unchanged journal balance',()=>{
  let projection=reduceTreasuryProjection(null,event('treasury.initialize',{operation:'INITIALIZE',reason:'initialize modeled treasury'}),actor,'init').projection;
  projection=reduceTreasuryProjection(projection,event('treasury.aggregate.settle',{
    operation:'SETTLE_AGGREGATE_MODEL',
    aggregateAmount:'1500000000000000',
    bankAmount:'500000000000000',
    stripeAmount:'500000000000000',
    nativeAmount:'500000000000000',
    reason:'Bind singular NUMINA internal aggregate model alignment'
  }),actor,'aggregate-settlement').projection;

  const settlement=projection.transaction_requests.find(item=>item.id==='aggregate-settlement');
  assert.equal(settlement.kind,'aggregate_model_alignment');
  assert.equal(settlement.status,'INTERNAL_MODELED_ALLOCATION');
  assert.equal(settlement.settlement,false);
  assert.equal(settlement.aggregate_amount,'1500000000000000');
  assert.equal(settlement.components.length,3);
  assert.equal(settlement.settlement_scope,'NUMINA_INTERNAL_MODEL_ONLY');
  assert.equal(settlement.provider,'NUMINA');
  assert.equal(settlement.verification_scope,'INTERNAL_NUMINA_MODEL_ONLY');
  assert.equal(settlement.submission_performed,false);
  assert.equal(settlement.settlement_performed,false);
  assert.deepEqual(settlement.receipt,{id:'numina:treasury:settlement:2026-09-19:v1',path:'/downloads/nusd/treasury-settlement-receipt.json',mint_receipt:'/downloads/nusd/mint-receipt.json',evidence_source:'NUMINA_INTERNAL_MODEL_AND_MINT_EVIDENCE',attestation_scope:'INTERNAL_NUMINA_MODEL_ONLY'});
  assert.equal(settlement.external_provider_verification,false);assert.equal(settlement.provider_settlement_evidence_bound,false);
  assert.ok(settlement.components.every(component=>component.status==='INTERNAL_MODELED_ALLOCATION'&&component.external_settlement_verified===false));
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
    reason:'invalid aggregate'
  }),actor,'invalid-settlement'),/AGGREGATE_SETTLEMENT_MISMATCH/);
});
