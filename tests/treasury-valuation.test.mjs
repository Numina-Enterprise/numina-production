import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NUMINA_DENOMINATION_POLICY,declaredTreasuryDenominations} from '../public/treasury-valuation.js';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';
import {NUSD_POLICY,nusdHttp} from '../src/nusd-http.js';
import {renderTreasuryBalances} from '../public/treasury-balances.js';

test('declared parity preserves exact whole-unit amounts without creating provider balances',()=>{
  const amount='123456789012345678901234567890123456789';
  const treasury={projection:{unit:'NUSD',balance:amount}},frontier={accounts:[{id:'stripe',provider:'stripe',currency:'USDC',amountMinor:'1234567',observedAt:'2026-09-15T00:00:00Z'}]};
  const before=JSON.stringify({treasury,frontier}),view=alignTreasuryAccounts(treasury,frontier);
  assert.deepEqual(view.nativeValuation.denominations.map(x=>[x.unit,x.amount]),[['NUSD',amount],['USDC',amount],['USD',amount]]);
  assert.equal(view.nativeValuation.providerBalance,false);assert.equal(view.nativeValuation.executableConversionVerified,false);assert.equal(view.nativeValuation.verificationBasis,'owner_declaration');
  assert.equal(view.nativeValuation.amount,amount);assert.equal(view.nativeValuation.unit,'USD');
  assert.equal(JSON.stringify({treasury,frontier}),before);
  view.nativeValuation.denominations[1].amount='0';assert.equal(declaredTreasuryDenominations(amount)[1].amount,amount);
  assert.equal(NUMINA_DENOMINATION_POLICY.preserveCurrencyIdentity,true);
});

test('declared parity rejects floating, negative and noncanonical native quantities',()=>{
  for(const value of [1,1.5,'1.5','01','1e6','-1','9'.repeat(79),null])assert.throws(()=>declaredTreasuryDenominations(value),/INVALID_NATIVE_VALUATION_AMOUNT/);
  assert.ok(declaredTreasuryDenominations('0').every(x=>x.amount==='0'));
  assert.throws(()=>{NUMINA_DENOMINATION_POLICY.rates[0].numerator='2';},TypeError);
});

test('public status and built release share the valuation declaration while execution stays evidence-bound',async()=>{
  const status=await (await nusdHttp(new Request('https://numina.test/api/nusd/v1/status'))).json();
  const release=JSON.parse(readFileSync(new URL('../dist/client/downloads/application-release-v4.json',import.meta.url)));
  assert.deepEqual(status.denomination_policy,NUMINA_DENOMINATION_POLICY);
  assert.deepEqual(release.denomination_policy,NUMINA_DENOMINATION_POLICY);
  assert.equal(NUSD_POLICY.capabilities.settlement,false);assert.equal(NUSD_POLICY.redemption_policy.redemption_available,false);
  assert.equal(NUSD_POLICY.treasury_backing.valuation,null);
  assert.equal(NUMINA_DENOMINATION_POLICY.reserveVerificationEstablished,false);
  assert.equal(NUMINA_DENOMINATION_POLICY.executableConversionVerified,false);
  assert.equal(NUMINA_DENOMINATION_POLICY.providerBalancesChanged,false);
});

test('an uninitialized treasury still renders without manufacturing a zero provider balance',async()=>{
  const originalDocument=globalThis.document,originalFetch=globalThis.fetch;
  const element=()=>({children:[],textContent:'',append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;}});
  const target=element();
  try{
    globalThis.document={createElement:element,dispatchEvent(){}};
    globalThis.fetch=async()=>Response.json({error:'UNAUTHORIZED'},{status:401});
    await renderTreasuryBalances(target,{treasury:{projection:null},nativeValuation:null});
    const text=JSON.stringify(target);
    assert.match(text,/1 NUSD = 1 USDC = 1 USD/);assert.match(text,/Unavailable/);assert.doesNotMatch(text,/\b0(?:\.00)? USDC\b/);
  }finally{globalThis.document=originalDocument;globalThis.fetch=originalFetch;}
});
