import test from 'node:test';
import assert from 'node:assert/strict';
import {alignTreasuryAccounts,NUMINA_FUNDABLE_TARGET_AMOUNT,NUMINA_AGGREGATE_MODELED_VALUE} from '../src/treasury-alignment.js';

test('NUMINA counts one 500T model across three denomination views without claiming external settlement',()=>{
  const view=alignTreasuryAccounts({
    revision:1,
    head:'a'.repeat(64),
    verification_scope:'Numina-native model and journal integrity',
    projection:{balance:'500000000000000',unit:'NUSD'}
  },{accounts:[]});
  assert.equal(NUMINA_FUNDABLE_TARGET_AMOUNT,'500000000000000');
  assert.equal(NUMINA_AGGREGATE_MODELED_VALUE,'500000000000000');
  assert.equal(view.fundableTargets.aggregateModeledValue,'500000000000000');
  assert.equal(view.fundableTargets.aggregateModeledUnit,'NUSD');
  assert.equal(view.fundableTargets.additive,false);
  assert.equal(view.fundableTargets.externalBalancesAggregated,false);
  assert.deepEqual(view.fundableTargets.targets.map(x=>[x.amount,x.unit]),[
    ['500000000000000','USD'],
    ['500000000000000','USDC'],
    ['500000000000000','NUSD']
  ]);
  assert.equal(view.treasuryAlignmentPlan.aggregateModeledValue,'500000000000000');
  assert.equal(view.treasuryAlignmentPlan.externalBalancesAggregated,false);
  assert.equal(view.treasuryAlignmentPlan.externalEvidenceStatus,'PENDING_PROVIDER_EVIDENCE');
});
