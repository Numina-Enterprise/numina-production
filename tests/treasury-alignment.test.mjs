import test from 'node:test';
import assert from 'node:assert/strict';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';
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
  assert.equal(JSON.stringify(frontier),before);assert.ok(result.accounts.every(a=>a.allocatedAmount===null));
  for(const account of result.accounts){assert.equal(account.sharedNativeTreasury.amount,'500000000000000');assert.equal(account.sharedNativeTreasury.unit,'NUSD');assert.equal(account.sharedNativeTreasury.revision,135);assert.equal(account.sharedNativeTreasury.head,'newer-head');assert.equal(account.sharedNativeTreasury.sharedAcrossAccounts,true);assert.equal(account.sharedNativeTreasury.providerBalance,false);}
  result.accounts[0].sharedNativeTreasury.amount='1';assert.equal(result.accounts[1].sharedNativeTreasury.amount,'500000000000000');assert.equal(treasury.projection.balance,'500000000000000');
});
test('unresolved references and different legal entities never merge by label',()=>{
  const accounts=[{id:'a',provider:'bank-of-america',legalEntity:'A',providerAccountReference:null},{id:'b',provider:'bank-of-america',legalEntity:'A',providerAccountReference:null},{id:'c',provider:'stripe',legalEntity:'A',providerAccountReference:'fa_fixture'},{id:'d',provider:'stripe',legalEntity:'B',providerAccountReference:'fa_fixture'}];
  const result=alignTreasuryAccounts({projection:null},{accounts});assert.equal(result.accounts.length,4);assert.ok(result.accounts.every(a=>a.sharedNativeTreasury===null));assert.equal(result.nativeValuation,null);
  assert.equal(alignTreasuryAccounts({projection:{balance:'42',unit:'USD'}},{accounts}).nativeValuation,null);
});
