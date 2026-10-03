import test from 'node:test';
import assert from 'node:assert/strict';
import {alignTreasuryAccounts,NUMINA_FUNDABLE_TARGET_AMOUNT,NUMINA_AGGREGATE_MODELED_VALUE} from '../src/treasury-alignment.js';
import {NUMINA_NATIVE_TREASURY_SYNC,NUMINA_NATIVE_TREASURY_HOLDINGS} from '../public/treasury-connection-model.js';

test('one NUMINA journal balance keeps three historical location targets separate',()=>{
  const view=alignTreasuryAccounts({
    revision:142,
    head:'67b45a040374d944f42f26830c4a9142e26fa194d5149b7cfad2604aef351368',
    verification_scope:'Numina-native model and journal integrity',
    projection:{balance:'500000000000000',unit:'NUSD',transaction_requests:[]}
  },{accounts:[]});
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.sourceOfTruth,'NUMINA_NATIVE_TREASURY_JOURNAL');
  assert.equal(NUMINA_FUNDABLE_TARGET_AMOUNT,'500000000000000');
  assert.equal(NUMINA_AGGREGATE_MODELED_VALUE,null);
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue,null);
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.historicalAggregateModeledValue,'1500000000000000');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.nusdMinted,null);
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.contractsActive,null);
  assert.equal(NUMINA_NATIVE_TREASURY_HOLDINGS.length,3);
  assert.deepEqual(NUMINA_NATIVE_TREASURY_HOLDINGS.map(holding=>[holding.unit,holding.targetOnly]),[
    ['USD',true],['USDC',true],['NUSD',false]
  ]);
  assert.ok(NUMINA_NATIVE_TREASURY_HOLDINGS.every(holding=>holding.backingVerified===null));
  assert.equal(NUMINA_NATIVE_TREASURY_HOLDINGS[1].usdcAddress,'0x736bd8f274dce00a8bb374edd85df0d2e631018e');
  assert.equal(view.singular,true);
  assert.equal(view.canonicalTreasury.accounting.balanceCount,1);
  assert.equal(view.treasury.projection.balance,'500000000000000');
  assert.equal(view.fundableTargets.aggregateModeledValue,null);
  assert.equal(view.fundableTargets.additive,false);
  assert.equal(view.fundableTargets.aggregation,'ONE_JOURNAL_NUSD_PROJECTION_WITH_HISTORICAL_ALLOCATION_TARGETS');
  assert.equal(view.fundableTargets.externalBalancesAggregated,false);
  assert.deepEqual(view.fundableTargets.targets.map(target=>[target.amount,target.unit,target.internalAmountConfirmed]),[
    ['500000000000000','USD',false],
    ['500000000000000','USDC',false],
    ['500000000000000','NUSD',true]
  ]);
  assert.equal(view.fundableTargets.targets[1].providerAccountReference,'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu');
  assert.equal(view.treasuryAlignmentPlan.aggregateModeledValue,null);
  assert.equal(view.treasuryAlignmentPlan.additive,false);
  assert.equal(view.treasuryAlignmentPlan.nonAdditive,true);
  assert.equal(view.treasuryAlignmentPlan.aggregation,'ONE_JOURNAL_NUSD_PROJECTION_WITH_HISTORICAL_ALLOCATION_TARGETS');
  for(const record of [view.fundableTargets,view.treasuryAlignmentPlan,view.nativeFundingView]){
    assert.equal(record.settlementStatus,'UNVERIFIED');
    assert.equal(record.settlementPerformed,false);
    assert.equal(record.submissionPerformed,false);
    assert.equal(record.singularSettlementReceiptId,null);
    assert.equal(record.externalProviderSettlementVerified,null);
  }
  assert.equal(view.nativeFundingView.externalReceipt,null);
  assert.equal(view.nativeFundingView.nativeTarget.amount,'500000000000000');
});
