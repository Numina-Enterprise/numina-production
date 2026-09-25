import test from 'node:test';
import assert from 'node:assert/strict';
import {alignTreasuryAccounts,canonicalTreasuryReference,NUMINA_FUNDABLE_TARGET_AMOUNT,NUMINA_AGGREGATE_MODELED_VALUE} from '../src/treasury-alignment.js';
test('one native target groups duplicate provider references without rewriting evidence',()=>{
  const treasury={revision:135,head:'newer-head',verification_scope:'Numina-native model and journal integrity',projection:{balance:'500000000000000',unit:'NUSD'}};
  const frontier={accounts:[{id:'stripe-first',provider:'stripe',legalEntity:'SK Consulting LLC',providerAccountReference:'fa_fixture',accountLabel:'Stripe Treasury',linkedAt:1},{id:'bank',provider:'bank-of-america',legalEntity:'SK Consulting LLC',providerAccountReference:null,accountLabel:'Savings',linkedAt:2},{id:'stripe-second',provider:'stripe',legalEntity:'SK Consulting LLC',providerAccountReference:'fa_fixture',accountLabel:'Bank of America Savings',linkedAt:3}],fundingPlan:{status:'UNFUNDED_PLAN',eventId:'plan-fixture',target:{amount:'500000000000000',unit:'NUSD'},confirmedFunding:null},fundingDeclaration:{FUNDED_PLAN:true,eventId:'declaration-fixture'}};
  const before=JSON.stringify(frontier),result=alignTreasuryAccounts(treasury,frontier);
  assert.equal(result.accounts.length,2);assert.equal(result.accountReferences.length,3);
  assert.equal(result.accounts[0].provider,'stripe');assert.equal(result.accounts[0].accountLabel,'Stripe Treasury');assert.equal(result.accounts[0].labelConflict,true);
  assert.equal(result.accounts[0].sourceReferences.length,2);
  assert.equal(result.nativeFundingView.nativeTarget.amount,'500000000000000');assert.equal(result.nativeFundingView.nativeTarget.unit,'NUSD');
  assert.equal(result.nativeFundingView.ownerDeclaredFunded,true);assert.equal(result.nativeFundingView.recordedPlanStatus,'UNFUNDED_PLAN');
  assert.equal(result.nativeFundingView.status,'FUNDED_PLAN');assert.equal(result.nativeFundingView.statusBasis,'native_owner_declaration');
  assert.equal(result.nativeFundingView.confirmedExternalFunding,null);assert.equal(result.nativeFundingView.revision,135);
  assert.equal(result.nativeValuation.amount,'500000000000000');assert.equal(result.nativeValuation.unit,'USD');assert.equal(result.nativeValuation.basis,'owner_authorized_denomination_policy');assert.equal(result.nativeValuation.providerBalance,false);assert.equal(result.nativeValuation.executableConversionVerified,false);
  assert.equal(result.fundableTargets.amount,NUMINA_FUNDABLE_TARGET_AMOUNT);assert.equal(result.fundableTargets.alignment,'JOURNAL_PROJECTION_WITH_HISTORICAL_TARGETS');assert.equal(result.fundableTargets.additive,false);assert.equal(result.fundableTargets.aggregation,'ONE_JOURNAL_NUSD_PROJECTION_WITH_HISTORICAL_ALLOCATION_TARGETS');assert.equal(result.fundableTargets.singularBalanceCount,1);assert.equal(result.fundableTargets.aggregateModeledValue,NUMINA_AGGREGATE_MODELED_VALUE);assert.equal(result.fundableTargets.aggregateModeledUnit,null);assert.equal(result.fundableTargets.externalBalancesAggregated,false);assert.equal(result.fundableTargets.targets.length,3);
  assert.equal(result.treasuryAlignmentPlan.schema,'numina.treasury.alignment-plan.v2');assert.equal(result.treasuryAlignmentPlan.status,'JOURNAL_PROJECTION_WITH_HISTORICAL_TARGETS');assert.equal(result.treasuryAlignmentPlan.modelIdentity,'NUMINA');assert.equal(result.treasuryAlignmentPlan.modelAligned,true);assert.equal(result.treasuryAlignmentPlan.externalEvidenceStatus,'PENDING_PROVIDER_EVIDENCE');assert.equal(result.treasuryAlignmentPlan.targetAmount,NUMINA_FUNDABLE_TARGET_AMOUNT);assert.equal(result.treasuryAlignmentPlan.aggregateModeledValue,NUMINA_AGGREGATE_MODELED_VALUE);assert.equal(result.treasuryAlignmentPlan.aggregateModeledUnit,null);assert.equal(result.treasuryAlignmentPlan.nonAdditive,true);assert.equal(result.treasuryAlignmentPlan.additive,false);assert.equal(result.treasuryAlignmentPlan.aggregation,'ONE_JOURNAL_NUSD_PROJECTION_WITH_HISTORICAL_ALLOCATION_TARGETS');assert.equal(result.treasuryAlignmentPlan.singularBalanceCount,1);assert.equal(result.treasuryAlignmentPlan.externalBalancesAggregated,false);assert.equal(result.treasuryAlignmentPlan.designatedLocations.length,3);
  assert.deepEqual(result.treasuryAlignmentPlan.designatedLocations.map(location=>[location.service,location.targetAmount,location.unit]),[['NUMINA','500000000000000','USD'],['NUMINA','500000000000000','USDC'],['NUMINA','500000000000000','NUSD']]);
  const bankTarget=result.fundableTargets.targets.find(target=>target.id==='bank-of-america-savings');
  const stripeTarget=result.fundableTargets.targets.find(target=>target.id==='stripe-numina-native-treasury');
  const nativeTarget=result.fundableTargets.targets.find(target=>target.id==='numina-native-treasury');
  assert.deepEqual([bankTarget.identity,bankTarget.provider,bankTarget.providerService,bankTarget.amount,bankTarget.unit,bankTarget.targetOnly,bankTarget.providerBalance,bankTarget.modelAlignmentStatus,bankTarget.alignmentStatus,bankTarget.providerObservationVerified,bankTarget.fundingPerformed],['NUMINA','NUMINA','NUMINA','500000000000000','USD',true,false,'JOURNAL_PROJECTION_WITH_HISTORICAL_TARGETS','TARGET_ONLY',false,false]);
  assert.deepEqual([stripeTarget.identity,stripeTarget.provider,stripeTarget.providerService,stripeTarget.amount,stripeTarget.unit,stripeTarget.targetOnly,stripeTarget.providerBalance,stripeTarget.modelAlignmentStatus,stripeTarget.alignmentStatus,stripeTarget.providerObservationVerified,stripeTarget.fundingPerformed],['NUMINA','NUMINA','NUMINA','500000000000000','USDC',true,false,'JOURNAL_PROJECTION_WITH_HISTORICAL_TARGETS','TARGET_ONLY',false,false]);
  assert.deepEqual([nativeTarget.amount,nativeTarget.unit,nativeTarget.currentNativeBalance,nativeTarget.targetSatisfied,nativeTarget.modelAlignmentStatus,nativeTarget.alignmentStatus],['500000000000000','NUSD','500000000000000',true,'JOURNAL_PROJECTION_WITH_HISTORICAL_TARGETS','ALIGNED_NATIVE_PROJECTION']);
  for(const record of [result.fundableTargets,result.treasuryAlignmentPlan,result.nativeFundingView,bankTarget,stripeTarget,nativeTarget]){
    assert.equal(record.settlementStatus,'UNVERIFIED');assert.equal(record.submissionPerformed,false);assert.equal(record.settlementPerformed,false);
    assert.equal(record.externalProviderSubmissionPerformed,null);assert.equal(record.externalProviderSettlementVerified,null);
  }
  assert.equal(result.fundableTargets.singularSettlementReceiptId,null);
  for(const field of ['root','manifest','identity','authority','source','evidence','provider','host','provenance'])assert.equal(result[field],'NUMINA');
  assert.equal(result.singular,true);
  assert.equal(JSON.stringify(frontier),before);assert.ok(result.accounts.every(a=>a.allocatedAmount===null));
  for(const account of result.accounts){assert.equal(account.sharedNativeTreasury.amount,'500000000000000');assert.equal(account.sharedNativeTreasury.unit,'NUSD');assert.equal(account.sharedNativeTreasury.revision,135);assert.equal(account.sharedNativeTreasury.head,'newer-head');assert.equal(account.sharedNativeTreasury.sharedAcrossAccounts,true);assert.equal(account.sharedNativeTreasury.providerBalance,false);}
  result.accounts[0].sharedNativeTreasury.amount='1';assert.equal(result.accounts[1].sharedNativeTreasury.amount,'500000000000000');assert.equal(treasury.projection.balance,'500000000000000');
});
test('one stable treasury identity spans accounts and revisions without joining roots or units',()=>{
  const treasury={root:'email:owner@example.test',revision:135,head:'a'.repeat(64),projection:{balance:'500000000000000',unit:'NUSD'}};
  const canonical=canonicalTreasuryReference(treasury),later=canonicalTreasuryReference({...treasury,revision:136,head:'b'.repeat(64)});
  assert.equal(canonical.id,later.id);assert.notEqual(canonical.head,later.head);
  assert.equal(canonical.id,canonicalTreasuryReference({...treasury,root:'email:another@example.test'}).id);
  assert.equal(canonical.id,'numina:treasury:NUMINA');assert.equal(canonical.root,'NUMINA');
  assert.equal(canonicalTreasuryReference({...treasury,root:null}).id,'numina:treasury:NUMINA');
  assert.equal(canonicalTreasuryReference({...treasury,projection:{unit:'USD',balance:'500000000000000'}}),null);
  const view=alignTreasuryAccounts(treasury,{accounts:[{id:'a',provider:'stripe',legalEntity:'A'},{id:'b',provider:'bank-of-america',legalEntity:'A'}]});
  for(const account of view.accounts){assert.equal(account.treasuryRef.id,canonical.id);assert.equal(Object.hasOwn(account.treasuryRef,'amount'),false);assert.equal(account.treasuryRef.evidenceRoute,canonical.evidence.route);}
  assert.equal(view.canonicalTreasury.accounting.balanceCount,1);assert.equal(view.canonicalTreasury.accounting.providerCurrenciesCombined,false);
  assert.equal(view.fundableTargets.targets.find(target=>target.id==='bank-of-america-savings').verificationScope,'NUMINA native holding model; provider observation and external execution remain separate evidence');
});
test('unresolved references and different legal entities never merge by label',()=>{
  const accounts=[{id:'a',provider:'bank-of-america',legalEntity:'A',providerAccountReference:null},{id:'b',provider:'bank-of-america',legalEntity:'A',providerAccountReference:null},{id:'c',provider:'stripe',legalEntity:'A',providerAccountReference:'fa_fixture'},{id:'d',provider:'stripe',legalEntity:'B',providerAccountReference:'fa_fixture'}];
  const result=alignTreasuryAccounts({projection:null},{accounts});assert.equal(result.accounts.length,4);assert.ok(result.accounts.every(a=>a.sharedNativeTreasury===null));assert.equal(result.nativeValuation,null);
  assert.equal(result.fundableTargets.targets.find(target=>target.id==='numina-native-treasury').currentNativeBalance,null);
  assert.equal(alignTreasuryAccounts({projection:{balance:'42',unit:'USD'}},{accounts}).nativeValuation,null);
  const changed=alignTreasuryAccounts({projection:{balance:'500000000000001',unit:'NUSD'}},{accounts});
  assert.equal(changed.fundableTargets.targets.find(target=>target.id==='numina-native-treasury').internalAmountConfirmed,false);
  assert.equal(changed.fundableTargets.nativeHoldings.find(holding=>holding.id==='native-nusd').internalAmountConfirmed,false);
});
