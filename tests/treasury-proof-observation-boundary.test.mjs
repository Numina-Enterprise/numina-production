import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';
import {verifyTreasuryAccountView,verifyTreasuryRecord} from '../public/treasury-proof.js';

const amount='500000000000000';
async function actualAccountView(initialized=true){
  const db=database(),owner='email:proof-owner@example.test';
  try{
    await bootstrapControl(db,owner,Math.floor(Date.now()/1000));
    const api=createNuminaTreasury({db,root:owner,principal:owner});
    if(initialized){
      const row=await readControl(db);
      await api.writeTreasury({id:'proof-observation-test',expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Local proof boundary regression'}});
    }
    const view=structuredClone(alignTreasuryAccounts(await api.readTreasury(),{accounts:[{id:'stripe-designation',provider:'stripe',legalEntity:'Owner',accountLabel:'Owner allocation',providerAccountReference:'fa_designated',source:'owner_designation',providerOwnershipVerified:false}]}));
    // Validate the actual API projection without correcting it inside the fixture.
    return view;
  }finally{db.close();}
}

test('proof accepts owner allocations with unknown provider balances and unchanged native journal',async()=>{
  for(const initialized of [false,true]){
    const view=await actualAccountView(initialized);
    assert.equal(await verifyTreasuryAccountView(view),true);
    assert.equal(view.fundableTargets.aggregateModeledValue,'1500000000000000');
    assert.deepEqual(view.fundableTargets.targets.map(target=>target.amount),[amount,amount,amount]);
    assert.equal(view.accounts[0].current,null);
    assert.equal(view.accounts[0].available,null);
    assert.equal(await verifyTreasuryRecord(view.treasury,{allowUninitialized:true}),true);
  }
});

test('proof rejects turning owner declarations or internal receipts into provider funding',async()=>{
  const view=await actualAccountView();
  assert.equal(await verifyTreasuryAccountView(view),true);
  const mutations=[
    v=>v.accounts[0].current=v.accounts[0].available=amount,
    v=>{for(const record of [v.fundableTargets,v.treasuryAlignmentPlan,v.nativeFundingView])record.nativeHoldings[1].backingVerified=true;},
    v=>v.fundableTargets.targets[1].backingVerified=true,
    v=>v.treasuryAlignmentPlan.designatedLocations[1].backingVerified=true,
    v=>{for(const record of [v.fundableTargets,v.treasuryAlignmentPlan,v.nativeFundingView])record.internalSettlementStatus='SETTLED';},
    v=>v.fundableTargets.targets[1].settlementStatus='SETTLED',
    v=>v.nativeFundingView.settlementPerformed=true,
    v=>v.nativeValuation.executableConversionVerified=true,
    v=>v.fundableTargets.targets[1].providerObservationVerified=true,
    v=>v.treasury.canonical_proof.event.commandHash='a'.repeat(64)
  ];
  for(const mutate of mutations){
    const changed=structuredClone(view);mutate(changed);
    assert.equal(await verifyTreasuryAccountView(changed),false);
  }
});

function historicalAllocationView(view){
  view.accountAlignment.aggregation='one NUMINA treasury; 1,500T declared model aggregate allocated as 500T USD, 500T USDC and 500T NUSD; external provider balances are not added';
  view.fundableTargets.alignment='ALIGNED_MODEL';
  view.treasuryAlignmentPlan.status='ALIGNED_MODEL';
  for(const model of [view.fundableTargets,view.treasuryAlignmentPlan])model.aggregation='MODEL_ROUTE_ALLOCATIONS';
  const roles=[['bank-of-america','bank_evidence','BANK_OF_AMERICA_SAVINGS_ACH'],['stripe','stripe_evidence','STRIPE_TREASURY_USDC_ADDRESS'],['NUMINA','canonical_projection','NUMINA_NATIVE_TREASURY']];
  for(let i=0;i<3;i++){
    const target=view.fundableTargets.targets[i],location=view.treasuryAlignmentPlan.designatedLocations[i],[service,role,purpose]=roles[i];
    Object.assign(target,{classification:'MODEL_ROUTE_ALLOCATION',providerService:service,treasuryRole:role,routePurpose:purpose,modelAlignmentStatus:'ALIGNED',alignmentStatus:i===2?target.alignmentStatus:'AWAITING_PROVIDER_EVIDENCE'});
    Object.assign(location,{service,treasuryRole:role,routePurpose:purpose,modelAlignmentStatus:'ALIGNED',status:target.alignmentStatus});
  }
  return view;
}

test('historical model compatibility cannot restore false provider backing or settlement',async()=>{
  const historical=historicalAllocationView(await actualAccountView());
  assert.equal(await verifyTreasuryAccountView(historical),true);
  for(const mutate of [
    v=>v.fundableTargets.nativeHoldings[0].backingVerified=true,
    v=>v.fundableTargets.targets[1].backingVerified=true,
    v=>v.treasuryAlignmentPlan.designatedLocations[1].backingVerified=true,
    v=>v.nativeFundingView.internalSettlementStatus='SETTLED',
    v=>v.fundableTargets.targets[0].settlementStatus='SETTLED',
    v=>v.treasuryAlignmentPlan.settlementPerformed=true
  ]){
    const changed=structuredClone(historical);mutate(changed);
    assert.equal(await verifyTreasuryAccountView(changed),false);
  }
});

test('proof rejects fabricated current chain and contract state even with intact journal proof',async()=>{
  for(const initialized of [false,true]){
    const view=await actualAccountView(initialized),treasury=view.treasury;
    assert.equal(await verifyTreasuryRecord(treasury,{allowUninitialized:true}),true);
    for(const mutate of [
      value=>value.provider_verification=true,
      value=>value.nativeBackingVerified=true,
      value=>value.contractsActive=true,
      value=>value.paused=false,
      value=>value.transfersEnabled=true,
      value=>value.operatorStatus='ACTIVE',
      value=>value.settlementStatus='SETTLED',
      value=>value.settlementPerformed=true
    ]){
      const changed=structuredClone(treasury);mutate(changed);
      assert.equal(await verifyTreasuryRecord(changed,{allowUninitialized:true}),false);
    }
    for(const mutate of [
      value=>value.fundableTargets.contractsActive=true,
      value=>value.fundableTargets.targets[1].contractsActive=true,
      value=>value.treasuryAlignmentPlan.contractsActive=true,
      ...(initialized?[value=>value.accounts[0].sharedNativeTreasury.contractsActive=true]:[])
    ]){
      const changed=structuredClone(view);mutate(changed);
      assert.equal(await verifyTreasuryAccountView(changed),false);
    }
  }
});
