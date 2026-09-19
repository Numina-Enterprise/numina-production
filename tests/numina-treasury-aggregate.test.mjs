import test from 'node:test';
import assert from 'node:assert/strict';
import {alignTreasuryAccounts,NUMINA_FUNDABLE_TARGET_AMOUNT,NUMINA_AGGREGATE_MODELED_VALUE} from '../src/treasury-alignment.js';

test('one NUMINA treasury exposes three additive 500T modeled components totaling 1,500T',()=>{
  const view=alignTreasuryAccounts({
    revision:1,
    head:'a'.repeat(64),
    verification_scope:'Numina-native model and journal integrity',
    projection:{balance:'500000000000000',unit:'NUSD'}
  },{accounts:[]});
  assert.equal(NUMINA_FUNDABLE_TARGET_AMOUNT,'500000000000000');
  assert.equal(NUMINA_AGGREGATE_MODELED_VALUE,'1500000000000000');
  assert.equal(view.fundableTargets.aggregateModeledValue,'1500000000000000');
  assert.equal(view.fundableTargets.aggregateModeledUnit,'NUSD');
  assert.equal(view.fundableTargets.additive,true);
  assert.equal(view.fundableTargets.aggregation,'SINGULAR_NUMINA_TREASURY_ADDITIVE_COMPONENTS');
  assert.equal(view.fundableTargets.singularBalanceCount,3);
  assert.equal(view.fundableTargets.externalBalancesAggregated,false);
  assert.deepEqual(view.fundableTargets.targets.map(x=>[x.amount,x.unit]),[
    ['500000000000000','USD'],
    ['500000000000000','USDC'],
    ['500000000000000','NUSD']
  ]);
  assert.equal(view.treasuryAlignmentPlan.aggregateModeledValue,'1500000000000000');
  assert.equal(view.treasuryAlignmentPlan.additive,true);
  assert.equal(view.treasuryAlignmentPlan.nonAdditive,false);
  assert.equal(view.treasuryAlignmentPlan.aggregation,'SINGULAR_NUMINA_TREASURY_ADDITIVE_COMPONENTS');
  assert.equal(view.treasuryAlignmentPlan.singularBalanceCount,3);
  assert.equal(view.treasuryAlignmentPlan.externalBalancesAggregated,false);
  assert.equal(view.treasuryAlignmentPlan.externalEvidenceStatus,'PENDING_PROVIDER_EVIDENCE');
  assert.equal(view.singular,true);
  assert.equal(view.canonicalTreasury.accounting.balanceCount,1);
  assert.equal(view.treasury.projection.balance,'500000000000000');
  assert.equal(view.nativeFundingView.nativeTarget.amount,'500000000000000');
  assert.equal(view.fundableTargets.targets.reduce((sum,target)=>sum+BigInt(target.amount),0n).toString(),NUMINA_AGGREGATE_MODELED_VALUE);
  assert.deepEqual(view.fundableTargets.targets.map(target=>target.routePurpose),['BANK_OF_AMERICA_SAVINGS_ACH','STRIPE_TREASURY_USDC_ADDRESS','NUMINA_NATIVE_TREASURY']);
  assert.ok(view.fundableTargets.targets.every(target=>target.classification==='TREASURY_ADDITIVE_COMPONENT'&&target.providerBalance===false&&target.providerObservationVerified===false&&target.fundingPerformed===false&&target.observedProviderAmount===null));
});
