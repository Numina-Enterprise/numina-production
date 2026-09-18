import test from 'node:test';
import assert from 'node:assert/strict';
import {reduceTreasuryProjection} from '../src/native-treasury-model.js';

const actor='email:owner@example.test';
const head='a'.repeat(64);
const event=(Objective,Intent)=>({Principal:actor,Authority:'NUMINA',Objective,Intent,expectedHead:head});

test('settles singular 1500T aggregate as Numina attestation without changing native balance',()=>{
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
  assert.equal(settlement.numina_attested_external_funds_moved,true);
  assert.equal(settlement.numina_attested_external_funds_verified,true);
  assert.equal(settlement.verification_scope,'NUMINA_ATTESTATION');
  assert.equal(settlement.external_provider_verification,false);
  assert.equal(settlement.provider_settlement_evidence_bound,false);
  assert.equal(settlement.submission_performed,false);
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
