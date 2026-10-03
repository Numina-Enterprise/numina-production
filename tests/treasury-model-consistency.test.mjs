import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NUMINA_CANONICAL_TREASURY_VALUES,NUMINA_NATIVE_TREASURY_SYNC,NUMINA_TREASURY_CONNECTION as model} from '../public/treasury-connection-model.js';
import {NUMINA_DENOMINATION_POLICY} from '../public/treasury-valuation.js';
import {alignTreasuryAccounts,NUMINA_FUNDABLE_TARGETS} from '../src/treasury-alignment.js';
import {NUSD_CONTRACT_RECORD} from '../public/nusd-contract-record.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('website targets and owner API preserve the one live NUSD projection',()=>{
  const projection={unit:'NUSD',balance:'500000000000000',transaction_requests:[]};
  const treasury={revision:142,head:'67b45a040374d944f42f26830c4a9142e26fa194d5149b7cfad2604aef351368',projection};
  const before=structuredClone(treasury),result=alignTreasuryAccounts(treasury,{accounts:[]});
  const allocations=values=>values.map(({id,amount,unit})=>({id,amount,unit}));
  assert.deepEqual(allocations(NUMINA_FUNDABLE_TARGETS),allocations(model.allocations));
  assert.deepEqual(allocations(result.fundableTargets.targets),allocations(model.allocations));
  assert.equal(model.balanceCount,1);assert.equal(model.sourceOfRecord,'NUMINA_NATIVE_TREASURY');
  assert.equal(model.aggregateModeledValue,null);
  assert.equal(model.softwareBalanceModel.bankUsd.current,null);
  assert.equal(model.softwareBalanceModel.stripeUsdc.available,null);
  assert.equal(model.softwareBalanceModel.nativeNusd.current,projection.balance);
  assert.equal(model.softwareBalanceModel.nativeNusd.available,null);
  assert.equal(model.softwareBalanceModel.aggregate.current,projection.balance);
  assert.equal(model.historicalAggregateModeledValue,'1500000000000000');
  assert.equal(result.canonicalTreasury.accounting.balanceCount,1);
  assert.equal(result.fundableTargets.externalBalancesAggregated,false);
  assert.deepEqual(treasury,before);
  for(const target of result.fundableTargets.targets){
    assert.equal(target.fundingPerformed,false);assert.equal(target.providerObservationVerified,false);
  }
});

test('current treasury metadata distinguishes journal balance from historical targets',()=>{
  const canonical=structuredClone(NUMINA_CANONICAL_TREASURY_VALUES);
  assert.equal(canonical.status,'JOURNAL_SNAPSHOT');
  assert.equal(canonical.canonical,false);
  assert.equal(canonical.components.USD.current,null);
  assert.equal(canonical.components.USDC.available,null);
  assert.equal(canonical.components.NUSD.current,'500000000000000');
  assert.equal(canonical.components.NUSD.available,null);
  assert.equal(canonical.aggregate.current,'500000000000000');
  assert.equal(canonical.aggregate.modeledTarget,'1500000000000000');
  assert.equal(canonical.settlementStatus,'UNVERIFIED');
  assert.equal(canonical.settlementReceiptId,null);
  assert.equal(canonical.historicalSettlementReceipt.historicalRecord,true);
  assert.equal(canonical.observation.observedRevision,142);
  for(const holding of model.nativeHoldings){
    assert.equal(holding.settlementStatus,'UNVERIFIED');
    assert.equal(holding.historicalSettlementReceiptId,canonical.historicalSettlementReceipt.id);
  }
  for(const path of [
    'config/numina-metadata-overrides.v1.json','config/numina-manifest.v2.json','config/numina-architecture.json',
    'public/business-core.json','package.json'
  ]){
    assert.deepEqual(JSON.parse(read(path)).canonicalTreasuryValues,canonical,path);
  }
  assert.deepEqual(NUSD_CONTRACT_RECORD.canonicalTreasuryValues,canonical);
});

test('validation companion binds the retained receipt without relabeling authorization as execution',()=>{
  const validation=JSON.parse(read('runtime/nusd/treasury-settlement-receipt-validation.json'));
  const retained=JSON.parse(read('runtime/nusd/treasury-settlement-receipt.json'));
  assert.equal(validation.evaluatedReceipt.id,retained.id);
  assert.equal(validation.classification,'NUMINA_VERIFIED_ASSERTION');
  assert.equal(validation.assertionVerifiedBy,'NUMINA');
  assert.equal(validation.status,'NOT_SETTLED');
  assert.equal(validation.journalAuthentication.authenticated,false);
  assert.equal(validation.executionVerification.executionVerified,false);
  assert.equal(validation.executionVerification.submissionPerformed,false);
  assert.equal(validation.executionVerification.settlementPerformed,false);
  assert.equal(validation.authorization.executionAuthorized,true);
  assert.equal(validation.externalStatus.providerSettlementVerified,false);
  assert.equal(validation.executionVerification.onChainReceipt,null);
  assert.equal(validation.executionVerification.stripeReceivedCredit,null);
  assert.equal(validation.executionVerification.bankProviderReceiptForAssertedAmount,null);
});

test('one shared backing statement preserves its declared policy and verification boundaries',()=>{
  const result=alignTreasuryAccounts({projection:{unit:'NUSD',balance:'500000000000000'}},{accounts:[]});
  assert.strictEqual(result.denominationPolicy,NUMINA_DENOMINATION_POLICY);
  assert.equal(model.declaredRate,NUMINA_DENOMINATION_POLICY.expression);
  assert.equal(NUMINA_DENOMINATION_POLICY.basis,'owner_authorized_denomination_policy');
  assert.equal(NUMINA_DENOMINATION_POLICY.reserveVerificationEstablished,false);
  assert.equal(NUMINA_DENOMINATION_POLICY.executableConversionVerified,false);
  assert.equal(NUSD_CONTRACT_RECORD.issuance.decimals,18);
  assert.equal(NUSD_CONTRACT_RECORD.issuance.amountNusd,'1500000000000000');
});

test('historical simulation is labeled separately without changing either treasury model',()=>{
  const page=read('public/treasury-simulation.html'),ui=read('public/treasury-simulation-ui.js');
  assert.match(page,/HISTORICAL SIMULATION/);assert.match(page,/500,000,000,000,000\.00/);
  assert.match(page,/existing deployed NUSD contract retains 18 decimals/);
  assert.match(page,/href="\/treasury"/);assert.match(ui,/Historical review matched/);
  assert.doesNotMatch(ui,/Current review matched/);
});

test('quantum observation retains actual counts without claiming financial execution',()=>{
  const observation=JSON.parse(read('release-evidence/quantum-job-observation-2026-09-18.json'));
  assert.equal(observation.source.jobId,'dakfqqvi3e6s738rfnqg');
  assert.equal(observation.providerReported.status,'Completed');
  assert.equal(Object.values(observation.providerReported.measurementCounts).reduce((sum,n)=>sum+n,0),observation.providerReported.shots);
  for(const field of ['newJobSubmitted','signedProviderReceiptImported','treasuryModelChanged','nusdDeploymentEstablishedByThisJob','reserveBackingVerifiedByThisJob','achTransferEstablishedByThisJob','usdcTransferEstablishedByThisJob'])assert.equal(observation[field],false);
  assert.equal(observation.source.instanceDetailsOmitted,true);
});
