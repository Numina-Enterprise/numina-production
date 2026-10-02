import test from 'node:test';
import assert from 'node:assert/strict';
import {alignTreasuryAccounts,NUMINA_FUNDABLE_TARGET_AMOUNT,NUMINA_AGGREGATE_MODELED_VALUE} from '../src/treasury-alignment.js';
import {NUMINA_NATIVE_TREASURY_SYNC,NUMINA_NATIVE_TREASURY_HOLDINGS} from '../public/treasury-connection-model.js';

test('one NUMINA treasury exposes three additive 500T native locations totaling 1,500T',()=>{
  const view=alignTreasuryAccounts({
    revision:1,
    head:'a'.repeat(64),
    verification_scope:'Numina-native model and journal integrity',
    projection:{balance:'500000000000000',unit:'NUSD'}
  },{accounts:[]});
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,'NUMINA_NATIVE_TREASURY');
  assert.equal(NUMINA_FUNDABLE_TARGET_AMOUNT,NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue);
  assert.equal(NUMINA_AGGREGATE_MODELED_VALUE,NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue);
  assert.equal(view.fundableTargets.aggregateModeledValue,'1500000000000000');
  assert.equal(view.fundableTargets.aggregateModeledUnit,'NUSD');
  assert.equal(view.fundableTargets.additive,true);
  assert.equal(view.fundableTargets.aggregation,'ONE_SINGULAR_NUMINA_TREASURY_THREE_ADDITIVE_COMPONENT_ROLES');
  assert.equal(view.fundableTargets.singular,true);
  assert.equal(view.fundableTargets.treasuryCount,1);
  assert.equal(view.fundableTargets.accountCount,1);
  assert.equal(view.fundableTargets.componentCount,3);
  assert.equal(view.fundableTargets.holdingsCount,3);
  assert.equal(view.fundableTargets.accountModel,'ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS');
  assert.equal(NUMINA_NATIVE_TREASURY_HOLDINGS.length,3);
  assert.deepEqual(NUMINA_NATIVE_TREASURY_HOLDINGS.map(holding=>holding.displayLabel),['NUMINA Native Treasury · Bank of America Savings 3486 · 500T USD / 500T NUSD','NUMINA Native Treasury · Stripe USDC 0x736bd8…018e · 500T USDC / 500T NUSD','NUMINA Native Treasury · 500T NUSD']);
  assert.equal(view.fundableTargets.singularBalanceCount,1);
  assert.equal(view.fundableTargets.externalBalancesAggregated,false);
  assert.ok(NUMINA_NATIVE_TREASURY_HOLDINGS.every(holding=>holding.amount==='500000000000000'));
  assert.equal(NUMINA_NATIVE_TREASURY_HOLDINGS.reduce((sum,holding)=>sum+BigInt(holding.amount),0n).toString(),'1500000000000000');
  assert.deepEqual(view.fundableTargets.targets.map(x=>[x.amount,x.unit]),[
    ['500000000000000','USD'],
    ['500000000000000','USDC'],
    ['500000000000000','NUSD']
  ]);
  assert.equal(view.treasuryAlignmentPlan.aggregateModeledValue,'1500000000000000');
  assert.equal(view.treasuryAlignmentPlan.additive,true);
  assert.equal(view.treasuryAlignmentPlan.nonAdditive,false);
  assert.equal(view.treasuryAlignmentPlan.aggregation,'ONE_SINGULAR_NUMINA_TREASURY_THREE_ADDITIVE_COMPONENT_ROLES');
  assert.equal(view.treasuryAlignmentPlan.singular,true);
  assert.equal(view.treasuryAlignmentPlan.treasuryCount,1);
  assert.equal(view.treasuryAlignmentPlan.accountCount,1);
  assert.equal(view.treasuryAlignmentPlan.componentCount,3);
  assert.equal(view.treasuryAlignmentPlan.holdingsCount,3);
  assert.equal(view.treasuryAlignmentPlan.accountModel,'ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS');
  assert.equal(view.treasuryAlignmentPlan.singularBalanceCount,1);
  assert.equal(view.treasuryAlignmentPlan.externalBalancesAggregated,false);
  assert.equal(view.treasuryAlignmentPlan.providerIdentity,'NUMINA');
  assert.equal(view.treasuryAlignmentPlan.contractsActive,true);
  assert.equal(view.treasuryAlignmentPlan.confirmationSource,'NUMINA_NATIVE_TREASURY');
  assert.equal(view.singular,true);
  assert.equal(view.canonicalTreasury.accounting.balanceCount,1);
  assert.equal(view.treasury.projection.balance,'500000000000000');
  assert.equal(view.nativeFundingView.nativeTarget.amount,'500000000000000');
  assert.equal(view.fundableTargets.targets.reduce((sum,target)=>sum+BigInt(target.amount),0n).toString(),NUMINA_AGGREGATE_MODELED_VALUE);
  assert.deepEqual(view.fundableTargets.targets.map(target=>target.routePurpose),['BANK_OF_AMERICA_SAVINGS_LOCATION','STRIPE_USDC_NATIVE_LOCATION','NUMINA_NATIVE_TREASURY']);
  assert.ok(view.fundableTargets.targets.every(target=>target.classification==='TREASURY_ROUTE_VIEW'&&target.identity==='NUMINA'&&target.provider==='NUMINA'&&target.treasuryIdentity==='NUMINA'&&target.singular===true&&typeof target.holdingRef==='string'&&target.internalAmountConfirmed===true&&target.confirmationSource==='NUMINA_NATIVE_TREASURY'&&target.nativeBalance===true&&target.backingVerified===true&&target.fundingPerformed===false&&target.providerBalance===false&&target.providerObservationVerified===false&&target.internalSettlementStatus==='SETTLED'));
  assert.equal(view.fundableTargets.providerIdentity,'NUMINA');
  assert.equal(view.fundableTargets.contractsActive,true);
  assert.equal(view.fundableTargets.settlementStatus,'UNVERIFIED');
  for(const record of [view.fundableTargets,view.treasuryAlignmentPlan,view.nativeFundingView]){
    assert.equal(record.settlementPerformed,false);assert.equal(record.submissionPerformed,false);
    assert.equal(record.internalSettlementStatus,'SETTLED');assert.equal(record.internalSettlementEvidenceScope,'NUMINA_MANIFEST_FINAL');
  }
  assert.equal(view.fundableTargets.singularSettlementReceiptId,'numina:treasury:settlement:2026-09-19:v1');
  assert.equal(view.treasuryAlignmentPlan.status,'ALIGNED_NATIVE_MODEL');
  assert.equal(view.treasuryAlignmentPlan.singularSettlementReceipt,'/downloads/nusd/treasury-settlement-receipt.json');
  assert.equal(view.nativeFundingView.status,'NOT_RECORDED');
  assert.equal(view.nativeFundingView.singularSettlementReceiptId,'numina:treasury:settlement:2026-09-19:v1');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.providerIdentity,'NUMINA');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.contractsActive,true);
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.nusdMinted,'1500000000000000');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.nusdBurned,'0');
  assert.equal(NUMINA_NATIVE_TREASURY_HOLDINGS[0].conversionContract,'NuminaUSDRedemption');
  assert.equal(NUMINA_NATIVE_TREASURY_HOLDINGS[1].conversionContract,'NuminaUSDCConversion');
  assert.equal(NUMINA_NATIVE_TREASURY_HOLDINGS[1].usdcAddress,'0x736bd8f274dce00a8bb374edd85df0d2e631018e');
});
