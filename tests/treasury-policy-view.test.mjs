import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {controlHash,stable} from '../src/control.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {frontierHttp} from '../src/frontier-http.js';
import {NUMINA_TREASURY_POLICY_V3} from '../src/treasury-policy.js';

const owner='email:owner@example.test';
const route='https://numina.test/api/control/v2/treasury/policy';

test('policy route separates the retained V3 catalog from the current journal',async t=>{
  const DB=database();t.after(()=>DB.close());
  await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));
  const treasury=createNuminaTreasury({db:DB,root:owner,principal:owner});
  async function write(id,Objective,Intent){
    const row=await readControl(DB);
    await treasury.writeTreasury({id,expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective,Intent});
  }
  await write('initialize','treasury.initialize',{operation:'INITIALIZE',reason:'Isolated policy view fixture'});
  await write('prepare-mint','treasury.mint.prepare',{operation:'PREPARE_MINT',amount:'1500000000000000',networkReference:'test-network',destinationReference:'test-wallet',reason:'Isolated preparation'});
  await write('prepare-bank','treasury.bank.prepare',{operation:'PREPARE_BANK_TRANSACTION',amountMinor:'50000000000000000',currency:'USD',destinationReference:'test-bank',reason:'Isolated preparation'});
  const row=await readControl(DB);
  const response=await frontierHttp(new Request(route),{DB,NUMINA_CONTROL_OWNER:owner});
  assert.equal(response.status,200);
  const view=await response.json();
  assert.equal(view.schema,'numina.treasury.policy-view.v1');
  assert.deepEqual(view.policy,{id:NUMINA_TREASURY_POLICY_V3.id,version:3,scope:'RETAINED_POLICY_CATALOG'});
  assert.equal(view.policyHashScope,'retainedPolicy');
  assert.deepEqual(view.retainedPolicy,NUMINA_TREASURY_POLICY_V3);
  assert.equal(view.policyHash,await controlHash(NUMINA_TREASURY_POLICY_V3));
  assert.equal(view.activation.status,'AWAITING_OWNER_RECORD');
  assert.equal(view.activation.scope,'POLICY_RECORD_ONLY');
  assert.deepEqual(view.currentJournal,{
    sourceOfTruth:'/api/control/v1/treasury',revision:row.revision,head:row.head_hash,status:'READY',
    balance:'500000000000000',unit:'NUSD',settlementStatus:'UNVERIFIED',
    submissionPerformed:false,settlementPerformed:false,
    externalProviderSubmissionStatus:'UNVERIFIED',externalProviderSettlementStatus:'UNVERIFIED'
  });
  assert.equal(view.head,row.head_hash);
  assert.equal(view.policy.settlementStatus,undefined);
  assert.equal(view.policy.submissionPerformed,undefined);
});

test('policy route refuses a journal event that fails canonical treasury replay',async t=>{
  const DB=database();t.after(()=>DB.close());
  await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));
  const treasury=createNuminaTreasury({db:DB,root:owner,principal:owner});
  const before=await readControl(DB);
  await treasury.writeTreasury({id:'initialize',expectedRevision:before.revision,expectedHead:before.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Isolated replay fixture'}});
  const row=await readControl(DB),event=structuredClone(row.journalEvents.at(-1));
  event.result.projection.balance='1500000000000000';
  const forgedHead=await controlHash(event);
  await DB.prepare('UPDATE numina_control_events SET event_json=?,hash=? WHERE id=?').bind(stable(event),forgedHead,event.id).run();
  await DB.prepare('UPDATE numina_control_manifest SET head_hash=? WHERE id=1').bind(forgedHead).run();
  assert.equal((await readControl(DB)).head_hash,forgedHead);
  const response=await frontierHttp(new Request(route),{DB,NUMINA_CONTROL_OWNER:owner});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'TREASURY_REPLAY_MISMATCH'});
});
