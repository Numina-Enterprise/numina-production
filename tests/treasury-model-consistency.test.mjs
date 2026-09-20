import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NUMINA_NATIVE_TREASURY_SYNC,NUMINA_TREASURY_CONNECTION as model} from '../public/treasury-connection-model.js';
import {NUMINA_DENOMINATION_POLICY} from '../public/treasury-valuation.js';
import {alignTreasuryAccounts,NUMINA_FUNDABLE_TARGETS} from '../src/treasury-alignment.js';
import {NUSD_CONTRACT_RECORD} from '../public/nusd-contract-record.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('website and owner API share the unchanged singular treasury allocation model',()=>{
  const projection={unit:'NUSD',balance:'500000000000000'};
  const treasury={revision:135,head:'a'.repeat(64),projection};
  const before=structuredClone(treasury),result=alignTreasuryAccounts(treasury,{accounts:[]});
  const allocations=values=>values.map(({id,amount,unit})=>({id,amount,unit}));
  assert.deepEqual(allocations(NUMINA_FUNDABLE_TARGETS),allocations(model.allocations));
  assert.deepEqual(allocations(result.fundableTargets.targets),allocations(model.allocations));
  assert.equal(model.balanceCount,1);assert.equal(model.singular,true);assert.equal(model.sourceOfRecord,'NUMINA_NATIVE_TREASURY');
  assert.equal(model.aggregateModeledValue,'1500000000000000');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.softwareIdentity,'NUMINA');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.softwareExternal,false);
  assert.deepEqual(NUMINA_NATIVE_TREASURY_SYNC.softwareValues,{bankUsd:'500000000000000',stripeUsdc:'500000000000000',nativeNusd:'500000000000000',aggregateNusd:'1500000000000000'});
  assert.equal(model.softwareIdentity,'NUMINA');
  assert.equal(model.softwareExternal,false);
  assert.deepEqual(model.softwareBalanceModel,{bankUsd:{current:'500000000000000',available:'500000000000000',unit:'USD',transfer:{id:'numina-bofa-3486-2026-08-31-8000750550',established:true,establishedStatus:'ESTABLISHED',status:'COMPLETED',cleared:true,clearingStatus:'CLEARED',clearedDate:'2026-08-31',amount:'500000000000000',unit:'USD',confirmation:'8000750550',verified:true,verification:'NUMINA_SOFTWARE_VERIFIED',verificationAuthority:'NUMINA',verificationScope:'NUMINA_SOFTWARE_MODEL',providerTransactionVisible:true,providerTransactionUnit:'USD',providerDisplayedTransactionAmount:'500000000000000',providerDisplayedTransactionAmountVerified:true,providerCleared:true,providerClearedDate:'2026-08-31',providerConfirmationVisible:true,providerConfirmation:'8000750550',providerDisplayEvidence:'USER_SUPPLIED_PROVIDER_TRANSACTION_DETAIL_SCREENSHOT',providerDisplayEvidenceScope:'PROVIDER_FACING_TRANSACTION_DETAIL',providerVerified:false}},stripeUsdc:{current:'500000000000000',available:'500000000000000',unit:'USDC'},nativeNusd:{current:'500000000000000',available:'500000000000000',unit:'NUSD'},aggregate:{current:'1500000000000000',unit:'NUSD'}});
  assert.deepEqual(model.allocations.map(({amount,unit})=>[amount,unit]),[
    ['500000000000000','USD'],['500000000000000','USDC'],['500000000000000','NUSD']
  ]);
  assert.equal(model.modeledAllocationsAdditive,true);
  assert.equal(result.fundableTargets.additive,true);
  assert.equal(result.treasuryAlignmentPlan.nonAdditive,false);
  assert.equal(model.allocations.reduce((sum,value)=>sum+BigInt(value.amount),0n).toString(),model.aggregateModeledValue);
  const page=read('public/treasury.html');
  assert.match(page,/1,500,000,000,000,000\.00 NUSD owner-designated equivalent/);
  assert.match(page,/1,500T owner-designated aggregate/);
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,'NUMINA_NATIVE_TREASURY');
  assert.equal(result.treasuryAlignmentPlan.sourceOfRecord,NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord);
  assert.equal(result.treasuryAlignmentPlan.aggregateModeledValue,model.aggregateModeledValue);
  assert.equal(result.treasuryAlignmentPlan.singularBalanceCount,model.balanceCount);
  assert.equal(result.canonicalTreasury.accounting.balanceCount,1);
  assert.equal(result.fundableTargets.externalBalancesAggregated,false);
  assert.deepEqual(treasury,before);
  for(const target of result.fundableTargets.targets){
    assert.equal(target.fundingPerformed,false);assert.equal(target.providerObservationVerified,false);
  }
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
