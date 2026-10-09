import test from 'node:test';
import assert from 'node:assert/strict';
import {NUMINA_CANONICAL_TREASURY_VALUES as canonical,NUMINA_TREASURY_CONNECTION as model} from '../public/treasury-connection-model.js';
import {NUMINA_DENOMINATION_POLICY} from '../public/treasury-valuation.js';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';
import {readStripeTreasury,STRIPE_TREASURY_FINANCIAL_ACCOUNT} from '../src/stripe-treasury.js';
const amount='500000000000000';
const config={NUMINA_STRIPE_TREASURY_READ_KEY:'rk_live_'+ 'synthetic'.repeat(3),NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:STRIPE_TREASURY_FINANCIAL_ACCOUNT};
const account={id:STRIPE_TREASURY_FINANCIAL_ACCOUNT,object:'v2.money_management.financial_account',display_name:'Fixture',status:'open',type:'storage',livemode:true,balance:{available:{usdc:{currency:'usdc',value:0}},inbound_pending:{},outbound_pending:{}}};
test('modeled allocations never establish current available funds or conversion backing',()=>{
 assert.deepEqual(model.allocations.map(({amount,unit})=>[amount,unit]),[[amount,'USD'],[amount,'USDC'],[amount,'NUSD']]);
 for(const unit of ['USD','USDC','NUSD']){const value=canonical.components[unit];assert.equal(value.modeledValue,amount);assert.equal(value.current,null);assert.equal(value.available,null);assert.equal(value.verified,false);}
 assert.equal(canonical.modelInferredProviderBalances,false);assert.equal(canonical.signed1To1BackingVerified,false);assert.equal(canonical.usdcConversion,false);
 assert.equal(model.settlementPerformed,false);assert.equal(model.submissionPerformed,false);assert.equal(model.settlementStatus,'UNVERIFIED');
 assert.equal(NUMINA_DENOMINATION_POLICY.executableConversionVerified,false);assert.equal(NUMINA_DENOMINATION_POLICY.providerBalancesChanged,false);
});
test('account alignment leaves unobserved provider balances unknown',()=>{
 const result=alignTreasuryAccounts({projection:{unit:'NUSD',balance:amount}},{accounts:[{id:'stripe',provider:'stripe',legalEntity:'SK Consulting LLC'}]});
 assert.equal(result.accounts[0].current,null);assert.equal(result.accounts[0].available,null);assert.equal(result.nativeValuation.executableConversionVerified,false);
 for(const value of result.fundableTargets.targets){assert.equal(value.amount,amount);assert.equal(value.backingVerified,false);assert.equal(value.providerObservationVerified,false);assert.equal(value.observedProviderAmount,null);}
});
test('zero provider USDC never becomes modeled 500T available funds',async()=>{
 const result=await readStripeTreasury(config,{fetcher:async()=>new Response(JSON.stringify(account))});
 assert.equal(result.modeledValue,amount);assert.equal(result.current,null);assert.equal(result.available,null);assert.equal(result.inferredProviderBalance.current,null);assert.equal(result.inferredProviderBalance.available,null);assert.equal(result.inferredProviderBalance.verified,false);assert.equal(result.backingVerified,false);
 assert.equal(result.balances.available.usdc.value,0);assert.equal(result.balances.inbound_pending.usdc,null);assert.equal(result.transfer_execution,false);
});
test('unavailable and failed reads return no modeled replacement provider amount',async()=>{
 for(const [env,fetcher] of [[{},async()=>{throw Error('should not call');}],[config,async()=>new Response('{}',{status:401})],[config,async()=>{throw Error('offline');}]]){
  await assert.rejects(readStripeTreasury(env,{fetcher}),error=>{assert.ok(['STRIPE_TREASURY_NOT_CONNECTED','STRIPE_TREASURY_UNAVAILABLE'].includes(error.code));assert.equal(error.balances,undefined);assert.equal(error.current,undefined);return true;});
 }
});

import {NUMINA_TREASURY_CURRENT_POLICY,NUMINA_TREASURY_POLICY_V3} from '../src/treasury-policy.js';
test('current policy cannot activate redemption from owner allocation alone and preserves historical policy',()=>{
 assert.equal(NUMINA_TREASURY_CURRENT_POLICY.version,4);assert.equal(NUMINA_TREASURY_CURRENT_POLICY.reserveDesignation.allocationVerified,false);assert.equal(NUMINA_TREASURY_CURRENT_POLICY.reserveDesignation.eligibleReserveValue,null);assert.equal(NUMINA_TREASURY_CURRENT_POLICY.redemption.executionEnabled,false);assert.equal(NUMINA_TREASURY_CURRENT_POLICY.redemption.providerRedemptionRightsVerified,false);assert.equal(NUMINA_TREASURY_CURRENT_POLICY.verification.backing,'NOT_VERIFIED');assert.equal(NUMINA_TREASURY_CURRENT_POLICY.verification.settlementPerformed,false);
 assert.equal(NUMINA_TREASURY_POLICY_V3.id,'numina-one-singular-treasury-2026-09-19');
});

import {NUMINA_OWNER_DECLARED_STATE} from '../src/frontier.js';
import {NUSD_POLICY} from '../src/nusd-http.js';
test('public NUSD and owner declarations cannot substitute for current provider execution',()=>{
 assert.equal(NUMINA_OWNER_DECLARED_STATE.executableConversionVerified,false);assert.equal(NUMINA_OWNER_DECLARED_STATE.providerBalancesChanged,false);assert.equal(NUMINA_OWNER_DECLARED_STATE.stripeSubmission,false);
 assert.equal(NUSD_POLICY.provider_routing.current,null);assert.equal(NUSD_POLICY.provider_routing.available,null);assert.equal(NUSD_POLICY.provider_routing.modeledValue,amount);assert.equal(NUSD_POLICY.asset_verification.paused,null);assert.equal(NUSD_POLICY.transfersEnabled,null);
});

import fs from 'node:fs';
test('active generated metadata preserves modeled aliases without current provider or transfer claims',()=>{
 const read=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'));
 const architecture=read('config/numina-architecture.json'),manifest=read('config/numina-manifest.v2.json'),pkg=read('package.json'),verification=read('integrations/numina/verification.json');
 for(const alias of [architecture.treasury.canonicalValues,manifest.software_treasury.canonicalValues]){
  assert.deepEqual(alias,canonical);
  for(const value of Object.values(alias.components)){assert.equal(value.current,null);assert.equal(value.available,null);assert.equal(value.verified,false);assert.equal(value.modeledValue,amount);}
 }
 assert.equal(manifest.software_treasury.bankUsd.current,null);assert.equal(manifest.software_treasury.bankUsd.available,null);
 assert.equal(manifest.software_treasury.bankUsd.modeledValue,amount);
 for(const flag of [architecture.transfersEnabled,manifest.mechanics.build_model.transfersEnabled,pkg.transfersEnabled,pkg.numina.transfersEnabled])assert.equal(flag,null);
 assert.equal(verification.nusdContracts.conversionPerformed,false);assert.equal(verification.nusdContracts.paused,null);
});

import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('legacy treasury projection also retains targets without provider balance or clearing assertions',()=>{
 const {NUMINA_MANIFEST:legacy}=require('../runtime/vercel-production/lib/numina-manifest.js');
 assert.equal(legacy.transfersEnabled,null);assert.equal(legacy.provider_verification,true);assert.equal(legacy.provider_verification_scope,'SIGNED_RUNTIME_RELEASE_IDENTITY_ONLY');assert.equal(legacy.financial_provider_verification,false);assert.equal(legacy.financial_execution_ready,false);
 for(const [key,unit] of [['bankUsd','USD'],['stripeUsdc','USDC'],['nativeNusd','NUSD']]){
  const value=legacy.softwareTreasury[key];assert.equal(value.current,null);assert.equal(value.available,null);assert.equal(value.modeledValue,amount);assert.equal(value.unit,unit);
 }
 assert.equal(legacy.softwareTreasury.bankUsd.transfer.verified,false);assert.equal(legacy.softwareTreasury.bankUsd.transfer.cleared,false);
 assert.equal(legacy.softwareTreasury.bankUsd.transfer.status,'MODEL_RECORDED');
 assert.equal(legacy.mechanics.treasury.providerVerification,false);
 assert.equal(legacy.mechanics.providerVerification.verified,false);
});

import {CORE_MANIFEST} from '../src/core-generated.js';
import worker from '../src/worker.js';
import {NUMINA_SOFTWARE_ALIGNMENT} from '../public/treasury-connection-model.js';
test('served current core manifest derives the shared modeled allocation without provider current funds',async()=>{
 const response=await worker.fetch(new Request('https://numina.test/api/core/v1.8/manifest'),{});
 assert.equal(response.status,200);
 const current=await response.json();
 assert.deepEqual(current,CORE_MANIFEST);
 assert.deepEqual(current.treasuryModel,NUMINA_SOFTWARE_ALIGNMENT.treasuryModel);
 assert.equal(current.treasuryModelScope,'OWNER_DESIGNATED_MODEL_CURRENT_PROVIDER_STATE_UNKNOWN');
 for(const unit of ['USD','USDC','NUSD']){assert.equal(current.treasuryModel[unit].current,null);assert.equal(current.treasuryModel[unit].available,null);assert.equal(current.treasuryModel[unit].modeledValue,amount);}
});
