import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NUMINA_CANONICAL_TREASURY_VALUES,NUMINA_NATIVE_TREASURY_SYNC,NUMINA_TREASURY_CONNECTION as model} from '../public/treasury-connection-model.js';
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
  assert.equal(model.balanceCount,1);assert.equal(model.singular,true);assert.equal(model.sourceOfRecord,'NUMINA_NATIVE_TREASURY');assert.equal(model.positionNamespace,'NUMINA');assert.equal(model.connectionNamespace,'NUMINA');assert.deepEqual(model.positionScope,['internal','external_connected']);assert.deepEqual(model.connectionScope,['native','provider_transport']);assert.equal(model.externalConnectionsAreNumina,true);assert.equal(model.providerEvidenceSourceScoped,true);
  assert.equal(model.aggregateModeledValue,'1500000000000000');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.softwareIdentity,'NUMINA');
  assert.equal(NUMINA_NATIVE_TREASURY_SYNC.softwareExternal,false);
  assert.deepEqual(NUMINA_NATIVE_TREASURY_SYNC.softwareValues,{bankUsd:'500000000000000',stripeUsdc:'500000000000000',nativeNusd:'500000000000000',aggregateNusd:'1500000000000000'});
  assert.equal(model.softwareIdentity,'NUMINA');
  assert.equal(model.softwareExternal,false);
  assert.deepEqual([model.softwareBalanceModel.bankUsd.current,model.softwareBalanceModel.bankUsd.available,model.softwareBalanceModel.bankUsd.unit],['500000000000000','500000000000000','USD']);
  assert.deepEqual([model.softwareBalanceModel.stripeUsdc.current,model.softwareBalanceModel.stripeUsdc.available,model.softwareBalanceModel.stripeUsdc.unit],['500000000000000','500000000000000','USDC']);
  assert.deepEqual([model.softwareBalanceModel.nativeNusd.current,model.softwareBalanceModel.nativeNusd.available,model.softwareBalanceModel.nativeNusd.unit],['500000000000000','500000000000000','NUSD']);
  assert.deepEqual(model.softwareBalanceModel.aggregate,{current:'1500000000000000',unit:'NUSD'});
  const bankTransfer=model.softwareBalanceModel.bankUsd.transfer;
  assert.equal(bankTransfer.verification,'NUMINA_SOFTWARE_MODEL_WITH_PROVIDER_OBSERVATION');
  assert.equal(bankTransfer.verificationScope,'NUMINA_SOFTWARE_MODEL_AND_RETAINED_PROVIDER_OBSERVATION');
  assert.equal(bankTransfer.providerVerified,true);assert.equal(bankTransfer.providerVerificationSource,'NUMINA_SOURCE_SCOPED_OBSERVATION');
  assert.equal(bankTransfer.providerTransactionId,'wb9NnY6nO8um9j9JpMJ4U6mgELdaM5he069yq');assert.equal(bankTransfer.providerBalanceSnapshotFreshness,'unknown');assert.equal(bankTransfer.providerBalanceSnapshotCurrent,'0');assert.equal(bankTransfer.providerBalanceSnapshotAvailable,'0');assert.equal(bankTransfer.providerAmountMatchesSoftwareModel,false);assert.equal(bankTransfer.providerBalanceMatchesSoftwareModel,false);assert.equal(bankTransfer.externalFundsMovedVerified,false);assert.equal(bankTransfer.externalSettlementVerified,false);
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

test('all current treasury metadata surfaces share one canonical 500T contract',()=>{
  const canonical=structuredClone(NUMINA_CANONICAL_TREASURY_VALUES);
  assert.deepEqual(canonical.components,{
    USD:{current:'500000000000000',available:'500000000000000',unit:'USD'},
    USDC:{current:'500000000000000',available:'500000000000000',unit:'USDC'},
    NUSD:{current:'500000000000000',available:'500000000000000',unit:'NUSD'}
  });
  assert.deepEqual(canonical.aggregate,{current:'1500000000000000',unit:'NUSD'});
  assert.equal(canonical.providerObservationsCanonical,false);
  assert.equal(canonical.providerObservationsSourceScoped,true);
  for(const path of [
    'config/numina-metadata-overrides.v1.json','config/numina-manifest.v2.json','config/numina-architecture.json','config/treasury-aggregate-settlement-1500t.v1.json',
    'public/final-build.json','docs/NUMINA-FINAL-BUILD.json','public/business-core.json','package.json',
    'integrations/numina/package.json','integrations/numina/distribution.json','integrations/numina/verification.json','integrations/numina/file-manifest.json',
    'runtime/nusd/treasury-write-request.json','runtime/nusd/policies/issuer-policy-1500t-6d.json','runtime/nusd/policies/issuer-policy-1500t-18d.json'
  ]){
    const value=JSON.parse(read(path));
    assert.deepEqual(value.canonicalTreasuryValues,canonical,path);
  }
  assert.deepEqual(NUSD_CONTRACT_RECORD.canonicalTreasuryValues,canonical);
  const aligned=alignTreasuryAccounts({projection:{unit:'NUSD',balance:'500000000000000'}},{accounts:[]});
  assert.deepEqual(aligned.fundableTargets.targets.map(({amount,unit})=>({amount,unit})),[
    {amount:canonical.components.USD.current,unit:'USD'},
    {amount:canonical.components.USDC.current,unit:'USDC'},
    {amount:canonical.components.NUSD.current,unit:'NUSD'}
  ]);
  assert.equal(aligned.fundableTargets.aggregateModeledValue,canonical.aggregate.current);
  assert.equal(aligned.treasuryAlignmentPlan.aggregateModeledValue,canonical.aggregate.current);
  assert.equal(aligned.nativeFundingView.nativeTarget.amount,canonical.components.NUSD.current);
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
