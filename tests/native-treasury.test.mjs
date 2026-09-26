import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl,controlManifestView,commitControl} from '../src/control-store.js';
import {controlHash,stable} from '../src/control.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {verifyNativeTreasury} from '../public/native-treasury.js';
import {verifyTreasuryRecord,verifyTreasuryAccountView} from '../public/treasury-proof.js';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';
import worker from '../src/worker.js';
import {NuminaClient} from '../integrations/numina/src/client.js';
import {EXPECTED_RELEASE} from '../public/runtime-contract.js';
const owner='email:owner@example.test',key='native-treasury-test-token';
const now=()=>Math.floor(Date.now()/1000);
async function fixture(path){const db=database(path);await bootstrapControl(db,owner,now());return db;}
const treasury=db=>createNuminaTreasury({db,root:owner,principal:owner});
async function command(db,operation='INITIALIZE',extra={},id='native-init'){
  const row=await readControl(db);
  const objectives={INITIALIZE:'treasury.initialize',ADJUST_PROJECTION:'treasury.project',PREPARE_MINT:'treasury.mint.prepare',PREPARE_BANK_TRANSACTION:'treasury.bank.prepare',PREPARE_USDC_DEPOSIT:'treasury.usdc.prepare',PREPARE_AGGREGATE_MODEL:'treasury.aggregate.prepare',SETTLE_AGGREGATE_MODEL:'treasury.aggregate.settle'};
  return {id,expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective:objectives[operation],Intent:{operation,reason:'Isolated test of the Numina-native model',...extra}};
}

test('clients bind proof to the root, command, revision and current event head',async()=>{
  const db=await fixture();try{
    const api=treasury(db);
    const empty=await api.readTreasury();assert.equal(await verifyTreasuryRecord(empty),false);assert.equal(await verifyTreasuryRecord(empty,{allowUninitialized:true}),true);
    await api.writeTreasury(await command(db));const current=await api.readTreasury();
    for(const mutate of [
      v=>v.root='OTHER',v=>v.principal='email:another-root@example.test',v=>v.revision=0,v=>v.head='a'.repeat(64),
      v=>v.canonical_proof.event.commandHash='a'.repeat(64),v=>v.canonical_proof.event.command.data.Authority='OTHER',
      v=>v.canonical_proof.event.command.expectedRevision=22,v=>v.canonical_proof.event.command.data.expectedHead='a'.repeat(64),
      v=>v.canonical_proof.event.command.data.Principal='email:other@example.test',
    ]){
      const changed=structuredClone(current);mutate(changed);
      // Even a newly computed outer event digest cannot detach its metadata binding.
      changed.canonical_proof.hash=await controlHash(changed.canonical_proof.event);
      assert.equal(await verifyTreasuryRecord(changed),false);
    }
    await commitControl(db,{id:'unrelated-event',expectedRevision:current.revision,type:'reconcile',data:{}},owner,now());
    const later=await api.readTreasury();assert.notEqual(later.head,later.canonical_proof.hash);assert.equal(await verifyTreasuryRecord(later),true);
  }finally{db.close();}
});

test('account views share one checked balance without changing stored references',async()=>{
  const db=await fixture();try{
    const api=treasury(db),frontier={accounts:[{id:'one',provider:'stripe',legalEntity:'Owner',accountLabel:'Existing label',providerAccountReference:'existing-reference'},{id:'two',provider:'bank-of-america',legalEntity:'Owner',accountLabel:'Existing bank label',providerAccountReference:null}]};
    const before=structuredClone(frontier);
    assert.equal(await verifyTreasuryAccountView(alignTreasuryAccounts(await api.readTreasury(),frontier)),true);
    await api.writeTreasury(await command(db));const view=alignTreasuryAccounts(await api.readTreasury(),frontier);
    assert.equal(await verifyTreasuryAccountView(view),true);assert.equal(view.schema,'numina.treasury.alignment.v2');assert.equal(view.identity,'NUMINA');assert.equal(view.treasuryIdentity,'NUMINA');assert.equal(view.transportVerificationChannel,'NUMINA');assert.equal(view.accountAlignment.schema,'numina.treasury.account-view.v2');assert.equal(view.accountAlignment.separateRoles,true);assert.equal(view.accountAlignment.singularIdentity,true);assert.ok(view.accounts.every(account=>account.treasuryIdentity==='NUMINA'&&account.treasuryRole==='evidence_view'&&account.providerObservationOnly===true));assert.deepEqual(frontier,before);assert.deepEqual(view.accountReferences,before.accounts);
    for(const [index,mutate] of [
      v=>v.fundableTargets.aggregateModeledValue='500000000000000',
      v=>v.fundableTargets.additive=true,
      v=>v.fundableTargets.aggregation='MODEL_ROUTE_ALLOCATIONS',
      v=>v.fundableTargets.singularBalanceCount=3,
      v=>v.treasuryAlignmentPlan.nonAdditive=false,
      v=>v.treasuryAlignmentPlan.additive=true,
      v=>v.treasuryAlignmentPlan.aggregation='MODEL_ROUTE_ALLOCATIONS',
      v=>v.treasuryAlignmentPlan.singularBalanceCount=3,
      v=>v.treasuryAlignmentPlan.aggregateModeledValue='500000000000000',
      v=>v.fundableTargets.nativeHoldings[0].amount='1',
      v=>v.treasuryAlignmentPlan.nativeHoldings[1].provider='Stripe',
      v=>v.fundableTargets.accountCount=3,
      v=>v.accountAlignment.nativeHoldingCount=1,
      v=>v.accounts[0].providerIdentity='Stripe',
      v=>v.fundableTargets.settlementPerformed=true,
      v=>v.nativeFundingView.submissionPerformed=true,
      v=>v.fundableTargets.externalProviderSettlementVerified=true,
      v=>v.nativeFundingView.externalSettlementStatus='SETTLED',
      v=>v.singular=false,
      v=>v.fundableTargets.externalBalancesAggregated=true,
      v=>v.fundableTargets.targets[0].amount='500000000000001',
      v=>v.fundableTargets.targets[1].unit='NUSD',
      v=>v.fundableTargets.targets[0].providerBalance=true,
      v=>v.fundableTargets.targets[0].providerObservationVerified=true,
      v=>v.fundableTargets.targets[0].fundingPerformed=true,
      v=>v.fundableTargets.targets[0].routePurpose='NUMINA_NATIVE_TREASURY',
      v=>v.fundableTargets.targets[0].classification='TREASURY_ROLE_TARGET',
      v=>v.treasuryAlignmentPlan.designatedLocations[1].fundingPerformed=true,
      v=>v.treasuryAlignmentPlan.designatedLocations[1].routePurpose='BANK_OF_AMERICA_SAVINGS_ACH',
      v=>v.treasuryAlignmentPlan.designatedLocations[1].modeledNusdEquivalent='1',
      v=>v.accountAlignment.aggregation='one NUMINA treasury; three modeled 500T role values compose a 1,500T NUSD aggregate; external provider balances are not added',
      v=>v.canonicalTreasury.root='wrong-root',v=>v.canonicalTreasury.head='a'.repeat(64),
      v=>v.accounts[0].treasuryRef.id='wrong-root',v=>v.accounts[0].sharedNativeTreasury.amount='1',
      v=>v.accounts[1].sharedNativeTreasury.revision++,v=>v.accounts[0].sharedNativeTreasury.providerBalance=true,
      v=>v.nativeValuation.denominations[1].amount='1',v=>v.nativeValuation.denominations[1].unit='USD',
      v=>v.nativeValuation.denominations[1].rate.numerator='2',v=>v.nativeValuation.denominations.push({...v.nativeValuation.denominations[0]}),
      v=>v.nativeValuation.denominations[1].providerBalance=true,v=>v.nativeValuation.amount='1',v=>v.nativeValuation.executableConversionVerified=true,
      v=>v.nativeFundingView.head='a'.repeat(64),v=>v.nativeFundingView.nativeTarget.unit='USD',
      v=>v.nativeFundingView.status='FUNDED_PLAN',v=>v.nativeFundingView.statusBasis='native_owner_declaration',
      v=>v.nativeFundingView.ownerDeclaredFunded=true,v=>v.nativeFundingView.ownerDeclarationEventId='unrelated',
      v=>v.nativeFundingView.recordedPlanStatus='FUNDED_PLAN',v=>v.nativeFundingView.recordedPlanEventId='unrelated',
      v=>v.nativeFundingView.confirmedExternalFunding={amount:'500000000000000',unit:'USDC'},v=>v.nativeFundingView.externalReceipt={id:'unrelated'}
    ].entries()){const changed=structuredClone(view);mutate(changed);assert.equal(await verifyTreasuryAccountView(changed),false,'mutation '+index);}
    assert.deepEqual(frontier,before);
    const funded=alignTreasuryAccounts(await api.readTreasury(),{...frontier,fundingPlan:{status:'UNFUNDED_PLAN',eventId:'original-plan'},fundingDeclaration:{FUNDED_PLAN:true,eventId:'owner-declaration'}});
    assert.equal(await verifyTreasuryAccountView(funded),true);
    assert.equal(funded.nativeFundingView.status,'FUNDED_PLAN');assert.equal(funded.fundingPlan.status,'UNFUNDED_PLAN');
    funded.nativeFundingView.status='UNFUNDED_PLAN';assert.equal(await verifyTreasuryAccountView(funded),false);
  }finally{db.close();}
});
test('browser accepts the journal-aligned view and rejects historical model substitutions',async()=>{
  const db=await fixture();try{
    const api=treasury(db);await api.writeTreasury(await command(db));
    const current=alignTreasuryAccounts(await api.readTreasury(),{accounts:[]}),historical=structuredClone(current);
    historical.accountAlignment.aggregation='one NUMINA treasury; 1,500T declared model aggregate allocated as 500T USD, 500T USDC and 500T NUSD; external provider balances are not added';
    historical.fundableTargets.aggregation='MODEL_ROUTE_ALLOCATIONS';
    historical.fundableTargets.additive=true;
    historical.fundableTargets.aggregateModeledValue='1500000000000000';
    historical.fundableTargets.alignment='ALIGNED_MODEL';
    historical.treasuryAlignmentPlan.aggregateModeledValue='1500000000000000';
    historical.treasuryAlignmentPlan.nonAdditive=false;
    historical.treasuryAlignmentPlan.aggregation='MODEL_ROUTE_ALLOCATIONS';
    historical.treasuryAlignmentPlan.additive=true;
    historical.treasuryAlignmentPlan.status='ALIGNED_MODEL';
    const roles=[['bank-of-america','bank_evidence','BANK_OF_AMERICA_SAVINGS_ACH'],['stripe','stripe_evidence','STRIPE_TREASURY_USDC_ADDRESS'],['NUMINA','canonical_projection','NUMINA_NATIVE_TREASURY']];
    for(let i=0;i<3;i++){
      const target=historical.fundableTargets.targets[i],location=historical.treasuryAlignmentPlan.designatedLocations[i],[service,role,purpose]=roles[i];
      Object.assign(target,{classification:'MODEL_ROUTE_ALLOCATION',providerService:service,treasuryRole:role,routePurpose:purpose,modelAlignmentStatus:'ALIGNED',alignmentStatus:i===2?target.alignmentStatus:'AWAITING_PROVIDER_EVIDENCE'});
      Object.assign(location,{service,treasuryRole:role,routePurpose:purpose,modelAlignmentStatus:'ALIGNED',status:target.alignmentStatus});
    }
    const historicalShared=structuredClone(historical);
    historicalShared.accountAlignment.aggregation='one NUMINA treasury; one shared 500T model expressed in USD, USDC and NUSD; denomination views are not added';
    for(const model of [historicalShared.fundableTargets,historicalShared.treasuryAlignmentPlan])Object.assign(model,{aggregation:'SINGULAR_NUMINA_TREASURY_DENOMINATION_VIEWS',additive:false,aggregateModeledValue:'500000000000000'});
    historicalShared.treasuryAlignmentPlan.nonAdditive=true;
    for(const target of historicalShared.fundableTargets.targets)target.classification='TREASURY_DENOMINATION_VIEW';
    assert.equal(await verifyTreasuryAccountView(current),true);
    assert.equal(await verifyTreasuryAccountView(historical),false);
    assert.equal(await verifyTreasuryAccountView(historicalShared),false);
    const mixed=structuredClone(current);
    mixed.fundableTargets.aggregateModeledValue='500000000000000';
    assert.equal(await verifyTreasuryAccountView(mixed),false);
    const mixedHistorical=structuredClone(historical);
    mixedHistorical.fundableTargets.additive=false;
    assert.equal(await verifyTreasuryAccountView(mixedHistorical),false);
    assert.equal(current.treasury.projection.balance,'500000000000000');
    assert.deepEqual(current.treasury,historical.treasury);
  }finally{db.close();}
});
test('current native holdings reject contradictory execution claims, substituted destinations and extra evidence fields',async()=>{
  const db=await fixture();try{
    const api=treasury(db);
    for(const initialized of [false,true]){
      if(initialized)await api.writeTreasury(await command(db));
      const view=alignTreasuryAccounts(await api.readTreasury(),{accounts:[]});
      assert.equal(await verifyTreasuryAccountView(view),true);
      const mutations=[
        ['target asserts native settlement',v=>v.fundableTargets.targets[0].settlementStatus='SETTLED'],
        ['target changes settlement scope',v=>v.fundableTargets.targets[0].settlementScope='STRIPE'],
        ['target asserts external settlement',v=>v.fundableTargets.targets[0].externalProviderSettlementVerified=true],
        ['target changes evidence scope',v=>v.fundableTargets.targets[0].internalSettlementEvidenceScope='BANK_PROVIDER_SETTLEMENT'],
        ['target changes receipt',v=>v.fundableTargets.targets[1].settlementReceipt='https://attacker.invalid/receipt'],
        ['target changes destination',v=>v.fundableTargets.targets[1].destination='https://attacker.invalid/deposit'],
        ['target changes provider binding',v=>v.fundableTargets.targets[1].providerAccountReference='fa_other'],
        ['target changes transport account',v=>v.fundableTargets.targets[1].linkedFinancialAccount='fa_other'],
        ['target changes address',v=>v.fundableTargets.targets[1].usdcAddress='0x'+'1'.repeat(40)],
        ['target adds provider claim',v=>v.fundableTargets.targets[0].providerAcceptanceVerified=true],
        ['location claims settlement',v=>v.treasuryAlignmentPlan.designatedLocations[0].settlementPerformed=true],
        ['location substitutes destination',v=>v.treasuryAlignmentPlan.designatedLocations[1].destination='https://attacker.invalid/deposit'],
        ['native holdings add provider verification',v=>{for(const x of [v.fundableTargets,v.treasuryAlignmentPlan,v.nativeFundingView])x.nativeHoldings[0].providerObservationVerified=true;}],
        ['native holdings substitute backing',v=>{for(const x of [v.fundableTargets,v.treasuryAlignmentPlan,v.nativeFundingView])x.nativeHoldings[0].verificationSource='BANK_PROVIDER';}],
        ['plan changes native account',v=>v.treasuryAlignmentPlan.nativeAccount.name='Other treasury'],
        ['all copies change native account',v=>{for(const x of [v.fundableTargets,v.treasuryAlignmentPlan,v.nativeFundingView])x.nativeAccount.name='Other treasury';}],
        ['model adds provider verification',v=>v.fundableTargets.providerObservationVerified=true],
        ['plan adds provider verification',v=>v.treasuryAlignmentPlan.providerObservationVerified=true],
        ['funding view adds provider verification',v=>v.nativeFundingView.providerObservationVerified=true],
        ['funding view changes internal receipt',v=>v.nativeFundingView.singularSettlementReceipt='https://attacker.invalid/receipt'],
        ['model changes mint evidence',v=>v.fundableTargets.mintEvidence='https://attacker.invalid/mint'],
        ['plan changes mint evidence',v=>v.treasuryAlignmentPlan.mintEvidence='https://attacker.invalid/mint']
      ];
      for(const [label,mutate] of mutations){const changed=structuredClone(view);mutate(changed);assert.equal(await verifyTreasuryAccountView(changed),false,label+' initialized='+initialized);}
    }
  }finally{db.close();}
});

test('account alignment rejects changed groups and provider claims before and after initialization',async()=>{
  const db=await fixture();try{
    const api=treasury(db),frontier={accounts:[
      {id:'stripe-alias',provider:'stripe',legalEntity:'Owner',accountLabel:'Alternate label',providerAccountReference:'fa_existing',linkedAt:3,source:'owner_designation',providerOwnershipVerified:false},
      {id:'retired',provider:'bank-of-america',legalEntity:'Owner',accountLabel:'Retired reference',providerAccountReference:'bank_old',linkedAt:0,source:'owner_designation',providerOwnershipVerified:false,supersededBy:'bank'},
      {id:'bank',provider:'bank-of-america',legalEntity:'Owner',accountLabel:'Savings',providerAccountReference:null,linkedAt:2,source:'owner_designation',providerOwnershipVerified:false},
      {id:'stripe-primary',provider:'stripe',legalEntity:'Owner',accountLabel:'Stripe Treasury',providerAccountReference:'fa_existing',linkedAt:1,source:'owner_designation',providerOwnershipVerified:false}
    ]};
    const before=structuredClone(frontier);
    for(const initialized of [false,true]){
      if(initialized)await api.writeTreasury(await command(db));
      const view=alignTreasuryAccounts(await api.readTreasury(),frontier);
      assert.equal(await verifyTreasuryAccountView(view),true);
      assert.deepEqual(view.accounts.map(a=>a.id),['stripe-primary','bank']);
      assert.deepEqual(view.accounts[0].sourceReferences.map(a=>a.id),['stripe-primary','stripe-alias']);
      assert.equal(view.accounts[0].labelConflict,true);
      assert.equal(view.accountAlignment.sourceReferenceCount,3);
      assert.equal(view.accountAlignment.distinctAccountViews,2);
      assert.equal(view.accountAlignment.duplicateReferenceCount,1);
      assert.deepEqual(view.supersededReferences,[before.accounts[1]]);
      if(!initialized){assert.equal(view.treasury.status,'NOT_INITIALIZED');assert.equal(view.canonicalTreasury,null);assert.ok(view.accounts.every(a=>a.sharedNativeTreasury===null));}
      const mutations=[
        ['duplicate account group',v=>v.accounts.push(structuredClone(v.accounts[0]))],
        ['omitted account group',v=>v.accounts.pop()],
        ['source count',v=>v.accountAlignment.sourceReferenceCount++],
        ['distinct count',v=>v.accountAlignment.distinctAccountViews++],
        ['duplicate count',v=>v.accountAlignment.duplicateReferenceCount=0],
        ['changed source reference',v=>v.accounts[0].sourceReferences[1].providerAccountReference='fa_other'],
        ['omitted source reference',v=>v.accounts[0].sourceReferences.pop()],
        ['duplicate source reference',v=>v.accounts[0].sourceReferences.push(structuredClone(v.accounts[0].sourceReferences[0]))],
        ['hidden label conflict',v=>v.accounts[0].labelConflict=false],
        ['changed provider',v=>v.accounts[0].provider='bank-of-america'],
        ['changed legal entity',v=>v.accounts[0].legalEntity='Another owner'],
        ['changed account identity',v=>v.accounts[0].providerAccountReference='fa_other'],
        ['changed ownership verification',v=>v.accounts[0].providerOwnershipVerified=true],
        ['changed designation source',v=>v.accounts[0].source='provider_confirmation'],
        ['superseded reference shown as active',v=>v.accounts.push({...structuredClone(v.accounts[1]),...structuredClone(v.supersededReferences[0])})],
        ['superseded inventory omitted',v=>v.supersededReferences=[]]
      ];
      const accepted=[];
      for(const [name,mutate]of mutations){const changed=structuredClone(view);mutate(changed);if(await verifyTreasuryAccountView(changed))accepted.push(name);}
      assert.deepEqual(accepted,[],(initialized?'READY':'NOT_INITIALIZED')+' view accepted inconsistent account metadata');
      assert.deepEqual(frontier,before);
    }
  }finally{db.close();}
});

test('treasury initializes within the existing root, persists and returns actual journal proof',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'numina-treasury-')),file=join(directory,'treasury.sqlite');let db=await fixture(file);
  try{
    const initial=await readControl(db),api=treasury(db);
    assert.equal((await api.readTreasury()).status,'NOT_INITIALIZED');
    const event=await command(db),result=await api.writeTreasury(event);
    assert.equal(result.status,'FINAL');assert.equal(result.projection.balance,'500000000000000');assert.equal(result.projection.unit,'NUSD');
    for(const field of ['authority','system_of_record'])assert.equal(result.projection[field],'NUMINA');
    assert.equal(result.projection.verification,'VERIFIED');assert.equal(result.mint_event,null);assert.equal(result.bank_transaction,null);
    assert.equal(result.head_advancement.previous,initial.head_hash);assert.equal(await controlHash(result.canonical_proof.event),result.canonical_proof.hash);
    assert.equal((await api.writeTreasury(event)).replayed,true);
    assert.equal((await readControl(db)).eventCount,2);
    db.close();db=database(file);
    const current=await treasury(db).readTreasury();assert.equal(current.root,'NUMINA');assert.equal(current.principal,initial.manifest.root);assert.equal(current.projection.balance,'500000000000000');assert.equal(await verifyNativeTreasury(current),true);
    const view=await controlManifestView(db,owner,now());assert.equal(Object.hasOwn(view.content,'nativeTreasury'),false);
    const altered=structuredClone(current);altered.projection.balance='1';assert.equal(await verifyNativeTreasury(altered),false);
  }finally{db.close();rmSync(directory,{recursive:true});}
});
test('exact integer updates, stale heads and concurrent writes preserve a single canonical balance',async()=>{
  const db=await fixture();try{
    const api=treasury(db);await api.writeTreasury(await command(db));
    const a=await command(db,'ADJUST_PROJECTION',{delta:'9007199254740993'},'a'),b={...a,id:'b',Intent:{...a.Intent,delta:'1'}};
    const results=await Promise.allSettled([api.writeTreasury(a),api.writeTreasury(b)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    const current=await api.readTreasury();assert.equal(current.projection.balance,(500000000000000n+BigInt(results[0].status==='fulfilled'?a.Intent.delta:b.Intent.delta)).toString());
    assert.equal((await readControl(db)).eventCount,3);
    await assert.rejects(api.writeTreasury({...a,id:'stale'}),/STALE_TREASURY_HEAD/);
    await assert.rejects(api.writeTreasury(await command(db,'INITIALIZE',{},'reinitialize')),/TREASURY_ALREADY_INITIALIZED/);
    for(const delta of ['-999999999999999999999','1.1',1,'-0'])await assert.rejects(api.writeTreasury(await command(db,'ADJUST_PROJECTION',{delta},'invalid-delta')),/TREASURY_BALANCE_OUT_OF_RANGE|INVALID_TREASURY_DELTA/);
  }finally{db.close();}
});
test('treasury prevents authority substitution, unknown fields, replay mutation and failed persistence',async()=>{
  const db=await fixture();try{
    const api=treasury(db),init=await command(db);
    await assert.rejects(createNuminaTreasury({db,root:owner,principal:'email:other@example.test'}).readTreasury(),/TREASURY_AUTHORITY_DENIED/);
    await assert.rejects(createNuminaTreasury({db,root:'different-root',principal:owner}).writeTreasury(init),/ROOT_CONFIGURATION_MISMATCH/);
    for(const changed of [{...init,Authority:'OTHER'},{...init,Principal:'OTHER'},{...init,Mandate:'forbidden'},{...init,Intent:{...init.Intent,balance:'1'}}])await assert.rejects(api.writeTreasury(changed),/TREASURY_AUTHORITY_DENIED|INVALID_TREASURY_FIELDS/);
    await api.writeTreasury(init);
    await assert.rejects(api.writeTreasury({...init,Intent:{...init.Intent,reason:'different request'}}),/IDEMPOTENCY_CONFLICT/);
    const next=await command(db,'ADJUST_PROJECTION',{delta:'1'},'storage-failure'),before=await readControl(db),originalBatch=db.batch;
    let calls=0;db.batch=async statements=>{calls++;if(calls===3)throw Error('simulated write failure');return originalBatch(statements);};
    await assert.rejects(api.writeTreasury(next),/simulated write failure/);db.batch=originalBatch;
    assert.equal((await readControl(db)).head_hash,before.head_hash);
  }finally{db.close();}
});
test('prepared mint, bank and Base USDC requests are journaled without changing projection or fabricating receipts',async()=>{
  const db=await fixture();try{
    const api=treasury(db);await api.writeTreasury(await command(db));
    for(const [operation,data]of [['PREPARE_MINT',{amount:'100',networkReference:'numina-main',destinationReference:'owner-wallet'}],['PREPARE_BANK_TRANSACTION',{amountMinor:'10000',currency:'USD',destinationReference:'owner-bank'}],['PREPARE_USDC_DEPOSIT',{amount:'500000000000000',destinationReference:'0x736bd8f274dce00a8bb374edd85df0d2e631018e'}]]){
      const result=await api.writeTreasury(await command(db,operation,data,operation));
      assert.equal(result.transaction_request.status,'PREPARED');assert.equal(result.transaction_request.receipt,null);assert.equal(result.transaction_request.submission_performed,false);
      assert.equal(result.projection.balance,'500000000000000');assert.equal(result.mint_event,null);assert.equal(result.bank_transaction,null);
      if(operation==='PREPARE_USDC_DEPOSIT'){
        assert.equal(result.transaction_request.kind,'usdc_transfer_request');assert.equal(result.transaction_request.network,'Base');assert.equal(result.transaction_request.chain_id,8453);
        assert.equal(result.transaction_request.token_address,'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');assert.equal(result.transaction_request.amount_base_units,'500000000000000000000');
        assert.equal(result.transaction_request.destination_reference,'0x736bd8f274dce00a8bb374edd85df0d2e631018e');assert.equal(result.transaction_request.destination_financial_account,'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu');assert.equal(result.transaction_request.destination_financial_address,'finaddr_61VNd8JyhbqklVBhF16VNcN9EZSQiQliazWdBc8FkRw8');assert.equal(result.transaction_request.destination_binding_verified,true);
        assert.equal(result.transaction_request.journal_idempotency_key,operation);assert.deepEqual(result.transaction_request.journal_replay_preconditions,['expectedRevision','expectedHead']);
        assert.equal(result.transaction_request.source_wallet,null);assert.equal(result.transaction_request.signer_control_verified,false);assert.equal(result.transaction_request.execution_performed,false);assert.equal(result.transaction_request.broadcast_performed,false);assert.equal(result.transaction_request.transaction_hash,null);
        assert.deepEqual(result.transaction_request.prerequisite_blockers,['SOURCE_WALLET_NOT_RECORDED','BASE_SIGNER_CONTROL_NOT_VERIFIED','SOURCE_USDC_BALANCE_NOT_VERIFIED','BASE_ETH_GAS_BALANCE_NOT_VERIFIED']);
      }
    }
    const row=await readControl(db);assert.equal(row.eventCount,5);
    await db.prepare('UPDATE numina_control_events SET event_json=? WHERE id=?').bind('{}','PREPARE_MINT').run();
    await assert.rejects(api.readTreasury(),/JOURNAL_CORRUPT/);
  }finally{db.close();}
});
test('aggregate preparation records one model-only request without external execution claims',async()=>{
  const db=await fixture();try{
    const api=treasury(db);await api.writeTreasury(await command(db));
    const before=await api.readTreasury();
    const intent={
      aggregateAmount:'1500000000000000',nativeAmount:'500000000000000',stripeAmount:'500000000000000',bankAmount:'500000000000000',
      reason:'Prepare the three-role aggregate model without asserting external execution'
    };
    const event=await command(db,'PREPARE_AGGREGATE_MODEL',intent,'prepare-aggregate-model');
    assert.equal(event.Objective,'treasury.aggregate.prepare');
    assert.deepEqual(event.Intent,{operation:'PREPARE_AGGREGATE_MODEL',...intent});
    const result=await api.writeTreasury(event),request=result.transaction_request;
    assert.equal(request.kind,'aggregate_model_request');
    assert.equal(request.status,'PREPARED_MODEL_ONLY');
    assert.equal(request.authority,'NUMINA');
    assert.deepEqual(request.owner_approval,{status:'OWNER_APPROVAL_RECORDED',reference:'/owner-approval.js'});
    assert.equal(request.aggregate_amount,'1500000000000000');
    assert.equal(request.aggregation,'SUM_OF_SEPARATE_ROLE_AMOUNTS');
    assert.deepEqual(request.components.map(component=>[component.role,component.observation_scope,component.amount,component.unit]),[
      ['NATIVE_VALUE','RECEIPT_BACKED_ISSUANCE','500000000000000','NUSD'],
      ['DIGITAL_DOLLAR_ROUTE','PROVIDER_SCOPED_OBSERVATION','500000000000000','USDC'],
      ['BANK_ROUTE','NUMINA_SCOPED_OBSERVATION','500000000000000','USD']
    ]);
    const issuance=request.components[0];assert.equal(issuance.issuer_policy_hash,'0x2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5');assert.equal(issuance.policy_declaration_scope,'ISSUER_POLICY_DECLARATION_NOT_EXTERNAL_BACKING');
    assert.deepEqual(issuance.burn_observation,{block_number:'51749',scope:'DATED_DEPLOYMENT_VERIFICATION_OBSERVATION',constructor_issuance_base_units:'1500000000000000000000000000000000',total_supply_base_units:'1500000000000000000000000000000000',recipient_balance_base_units:'1500000000000000000000000000000000',burned_nusd:'0',burned_base_units:'0',current_chain_burn_state_verified:false});
    assert.equal(issuance.externally_backed_claim,false);assert.equal(issuance.external_settlement_usdc,false);assert.equal(issuance.reserves_verified,false);
    for(const component of request.components){
      assert.equal(typeof component.id,'string');assert.ok(component.id);
      assert.equal(typeof component.source,'string');assert.ok(component.source);
      assert.equal(typeof component.status,'string');assert.ok(component.status);
      assert.ok(Object.hasOwn(component,'evidence_references'));
      assert.equal(Object.values(component).filter(value=>typeof value==='boolean').every(value=>value===false),true);
    }
    for(const field of ['external_balance_verified','external_provider_verification','external_backing_verified','external_funds_moved','execution_performed','broadcast_performed','submission_performed','settlement_performed'])assert.equal(request[field],false);
    assert.equal(request.transaction_hash,null);assert.equal(request.receipt,null);
    assert.deepEqual(request.reconciliation,{status:'PENDING_EVIDENCE',evidence_required:true});
    assert.equal(result.projection.balance,before.projection.balance);
    assert.equal(result.projection.last_event_id,event.id);
    assert.equal(result.projection.transaction_requests.length,before.projection.transaction_requests.length+1);
    assert.deepEqual(result.projection.transaction_requests.at(-1),request);
    assert.equal(result.head_advancement.revision,before.revision+1);
    assert.equal(result.mint_event,null);assert.equal(result.bank_transaction,null);
    assert.ok(await verifyTreasuryRecord(await api.readTreasury()));
  }finally{db.close();}
});
test('current treasury metadata follows the replayed journal instead of a packaged settlement receipt',async()=>{
  const db=await fixture();try{
    const api=treasury(db);
    const empty=await api.readTreasury();
    assert.equal(empty.settlementStatus,'UNVERIFIED');
    assert.equal(empty.submissionPerformed,false);
    assert.equal(empty.singularSettlementReceipt,null);
    assert.equal(empty.aggregateModeledValue,null);
    assert.equal(empty.softwareBalanceModel.nativeNusd.current,null);
    assert.equal(empty.softwareBalanceModel.aggregate.current,null);
    await api.writeTreasury(await command(db));
    const prepared=await api.writeTreasury(await command(db,'PREPARE_MINT',{amount:'1500000000000000',networkReference:'numina-main',destinationReference:'owner-wallet'},'prepared-mint'));
    assert.equal(prepared.status,'FINAL');
    assert.equal(prepared.transaction_request.status,'PREPARED');
    assert.equal(prepared.settlementStatus,'UNVERIFIED');
    assert.equal(prepared.submissionPerformed,false);
    assert.equal(prepared.singularSettlementReceipt,null);
    assert.equal(prepared.aggregateModeledValue,null);
    const observed=await api.readTreasury();
    assert.equal(observed.settlementStatus,'UNVERIFIED');
    assert.equal(observed.nusdMinted,null);
    assert.equal(observed.nativeBackingVerified,false);
    assert.equal(observed.provider_verification,false);
    assert.equal(observed.softwareBalanceModel.nativeNusd.current,'500000000000000');
    assert.equal(observed.softwareBalanceModel.aggregate.current,'500000000000000');
    assert.equal(await verifyTreasuryRecord(observed),true);

    const aggregate=await command(db,'SETTLE_AGGREGATE_MODEL',{
      aggregateAmount:'1500000000000000',bankAmount:'500000000000000',stripeAmount:'500000000000000',nativeAmount:'500000000000000',
      numinaAttestedExternalFundsMoved:true,numinaAttestedExternalFundsVerified:true
    },'aggregate-settlement');
    const settled=await api.writeTreasury(aggregate);
    assert.equal(settled.settlementStatus,'SETTLED');
    assert.equal(settled.submissionPerformed,true);
    assert.equal(settled.aggregateModeledValue,'1500000000000000');
    assert.equal(settled.singularSettlementReceiptId,'numina:treasury:settlement:2026-09-19:v1');
    assert.equal(settled.provider_verification,false);
    const settledRead=await api.readTreasury();
    assert.equal(await verifyTreasuryRecord(settledRead),true);
    assert.equal(settledRead.settlementStatus,'SETTLED');
    assert.equal(settledRead.externalProviderSettlementVerified,null);
    assert.equal(settledRead.externalProviderSubmissionPerformed,null);

    await api.writeTreasury(await command(db,'ADJUST_PROJECTION',{delta:'1'},'later-adjustment'));
    const adjusted=await api.readTreasury();
    assert.equal(adjusted.settlementStatus,'UNVERIFIED');
    assert.equal(adjusted.submissionPerformed,false);
    assert.equal(adjusted.singularSettlementReceipt,null);
    assert.equal(adjusted.aggregateModeledValue,null);
    assert.equal(adjusted.softwareBalanceModel.nativeNusd.current,'500000000000001');
    assert.equal(adjusted.softwareBalanceModel.aggregate.current,'500000000000001');
    assert.equal(await verifyTreasuryRecord(adjusted),true);
    await api.writeTreasury(await command(db,'ADJUST_PROJECTION',{delta:'-1'},'return-to-old-balance'));
    const restoredBalance=await api.readTreasury();
    assert.equal(restoredBalance.projection.balance,'500000000000000');
    assert.equal(restoredBalance.settlementStatus,'UNVERIFIED');
    assert.equal(restoredBalance.singularSettlementReceipt,null);
    assert.equal(await verifyTreasuryRecord(restoredBalance),true);
    const replay=await api.writeTreasury(aggregate);
    assert.equal(replay.replayed,true);
    assert.equal(replay.settlementStatus,'UNVERIFIED');
    assert.equal(replay.current_head.head,restoredBalance.head);
  }finally{db.close();}
});
test('P/A/O/I execution uses the canonical write path and emits its recorded proof',async()=>{
  const db=await fixture();try{
    const event=await command(db),result=await treasury(db).execute(event.Principal,event.Authority,event.Objective,{id:event.id,expectedRevision:event.expectedRevision,expectedHead:event.expectedHead,operation:event.Intent});
    assert.equal(result.route,'numina.treasury.v1');assert.equal(result.status,'FINAL');assert.equal((await readControl(db)).eventCount,2);
  }finally{db.close();}
});

test('treasury freezes the complete caller event before asynchronous storage work',async()=>{
  const db=await fixture();try{
    const api=treasury(db),event=await command(db),original=structuredClone(event);
    const pending=api.writeTreasury(event);
    event.Intent.reason='Changed after writeTreasury started';
    const result=await pending;
    assert.deepEqual(result.canonical_proof.event.command.data.Intent,original.Intent);
    assert.equal((await api.writeTreasury(original)).replayed,true);
    await assert.rejects(api.writeTreasury(event),/IDEMPOTENCY_CONFLICT/);
  }finally{db.close();}
});

test('generic direct control commits cannot write a treasury event',async()=>{
  const db=await fixture();try{
    const event=await command(db);
    const genericCommand={id:event.id,expectedRevision:event.expectedRevision,type:'treasury',data:{
      Principal:event.Principal,Authority:event.Authority,Objective:event.Objective,
      Intent:event.Intent,expectedHead:event.expectedHead}};
    await assert.rejects(commitControl(db,genericCommand,owner,now()),/CANONICAL_TREASURY_ROUTE_REQUIRED/);
    assert.equal((await treasury(db).readTreasury()).status,'NOT_INITIALIZED');
    assert.equal((await treasury(db).writeTreasury(event)).status,'FINAL');
  }finally{db.close();}
});

test('journal insertion failure rolls back the manifest and an exact retry commits once',async()=>{
  const db=await fixture();try{
    const api=treasury(db),event=await command(db),before=await readControl(db),prepare=db.prepare;
    db.prepare=sql=>prepare(sql.startsWith('INSERT INTO numina_control_events')
      ?sql.replace('numina_control_events','missing_journal_table'):sql);
    await assert.rejects(api.writeTreasury(event),/missing_journal_table/);
    db.prepare=prepare;
    assert.equal((await readControl(db)).head_hash,before.head_hash);
    assert.equal((await api.writeTreasury(event)).status,'FINAL');
    assert.equal((await readControl(db)).eventCount,2);
  }finally{db.close();}
});
test('recomputing generic journal hashes cannot bypass replay of the frozen treasury model',async()=>{
  const db=await fixture();try{
    const api=treasury(db);await api.writeTreasury(await command(db));
    const row=await readControl(db),event=row.journalEvents.at(-1);
    row.manifest.nativeTreasury.balance='1';event.result.projection.balance='1';event.manifestHash=await controlHash(row.manifest);
    const hash=await controlHash(event);
    await db.batch([
      db.prepare('UPDATE numina_control_manifest SET manifest_json=?,manifest_hash=?,head_hash=? WHERE id=1').bind(stable(row.manifest),event.manifestHash,hash),
      db.prepare('UPDATE numina_control_events SET event_json=?,hash=? WHERE id=?').bind(stable(event),hash,event.id)
    ]);
    await readControl(db); // The generic hash chain alone is consistent.
    await assert.rejects(api.readTreasury(),/TREASURY_REPLAY_MISMATCH/);
  }finally{db.close();}
});
test('integration reads the canonical native record with owner credentials only on the private route',async()=>{
  const db=await fixture();try{
    const api=treasury(db);await api.writeTreasury(await command(db));const current=await api.readTreasury(),calls=[];
    const client=new NuminaClient({baseUrl:'https://numina.test',token:key,fetch:async(url,options)=>{
      calls.push(url);
      if(url.endsWith('/v4/release/manifest')){
        assert.equal(options.headers.Authorization,undefined);
        return Response.json({schema:'numina.application-release.v2',schema_version:2,product:'Numina',version:'4.0.0',release:'numina-v4.0.0',artifact_digest_algorithm:'sha256',build_id:current.head,artifacts:[{path:'isolated-test',sha256:current.head}],runtime_dependency:{version:EXPECTED_RELEASE.production_version,release:EXPECTED_RELEASE.release}});
      }
      assert.equal(url,'https://numina.test/api/control/v1/treasury');assert.equal(options.headers.Authorization,'Bearer '+key);return Response.json(current);
    }});
    const result=await client.callTool('numina_read_treasury',{});
    assert.equal(result.data.projection.balance,'500000000000000');assert.equal(result.asset_execution_available,false);assert.equal(result.verification,'server_reported_not_independently_verified');assert.equal(calls.length,2);
    current.root='email:substituted-root@example.test';
    await assert.rejects(client.readTreasury(),{code:'INVALID_TREASURY_PROOF'});
    await assert.rejects(new NuminaClient({baseUrl:'https://numina.test',fetch:()=>{throw Error('must not send');}}).readTreasury(),{code:'SERVER_AUTH_REQUIRED'});
  }finally{db.close();}
});
test('HTTP exposes one treasury write route, checks owner and origin, and redirects the legacy statement',async()=>{
  const db=await fixture(),env={DB:db,NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(key)};
  const req=(path,body,headers={Authorization:'Bearer '+key})=>new Request('https://numina.test/api/control/v1/'+path,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?stable(body):undefined});
  try{
    assert.equal((await worker.fetch(req('treasury',null,{}),env)).status,401);
    const event=await command(db);
    assert.equal((await worker.fetch(req('treasury',event,{'oai-authenticated-user-id':'test','oai-authenticated-user-email':'owner@example.test',Origin:'https://wrong.test'}),env)).status,403);
    const result=await worker.fetch(req('treasury',event),env);assert.equal(result.status,200);assert.equal((await result.json()).status,'FINAL');
    const invalidUsdc=await command(db,'PREPARE_USDC_DEPOSIT',{amount:'500000000000000',destinationReference:'not-an-address'},'invalid-usdc');
    const rejected=await worker.fetch(req('treasury',invalidUsdc),env);assert.equal(rejected.status,400);assert.equal((await rejected.json()).error,'INVALID_TRANSACTION_REFERENCE');
    const usdc=await command(db,'PREPARE_USDC_DEPOSIT',{amount:'500000000000000',destinationReference:'0x736bd8f274dce00a8bb374edd85df0d2e631018e'},'prepare-usdc');
    const prepared=await worker.fetch(req('treasury',usdc),env);assert.equal(prepared.status,200);const preparedBody=await prepared.json();assert.equal(preparedBody.transaction_request.kind,'usdc_transfer_request');assert.equal(preparedBody.transaction_request.status,'PREPARED');assert.equal(preparedBody.transaction_request.execution_performed,false);assert.equal(preparedBody.transaction_request.broadcast_performed,false);
    const read=await worker.fetch(req('treasury'),env);assert.equal(read.headers.get('Cache-Control'),'private, no-store');assert.equal((await read.json()).projection.balance,'500000000000000');
    const legacy=await worker.fetch(req('treasury-attestation'),env);assert.equal(legacy.status,308);assert.equal(legacy.headers.get('Location'),'/api/control/v1/treasury');
    const alternate=await worker.fetch(req('commands',{id:'wrong-route',expectedRevision:1,type:'treasury',data:{}}),env);assert.equal(alternate.status,409);assert.equal((await alternate.json()).error,'CANONICAL_TREASURY_ROUTE_REQUIRED');
    const providerBefore=readFileSync(new URL('../src/stripe-treasury.js',import.meta.url),'utf8');assert.equal(providerBefore.includes('createNuminaTreasury'),false);
  }finally{db.close();}
});
