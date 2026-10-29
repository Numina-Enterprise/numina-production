import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {controlHash,stable} from '../src/control.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {NUMINA_TREASURY_MODEL,validateTreasuryProjection} from '../src/native-treasury-model.js';

const owner='email:legacy-owner@example.test';
const legacyModel={schema:'numina.treasury.projection.v1',unit:'NUSD',authority:'NUMINA',verification:'VERIFIED',system_of_record:'NUMINA',scope:'Numina-native'};
const supplement=['identity','structure','hashIdentity','artifactPathIdentity','runtimeIdIdentity','securityMechanicsIdentity','singular'];
const canary='PRIVATE_LEGACY_REASON_MUST_NOT_ESCAPE';
const mint={id:'legacy-mint',kind:'mint_request',status:'PREPARED',destination_reference:'wallet:legacy',amount:'1500000000000000',unit:'NUSD',network_reference:'chain:legacy',submission_performed:false,receipt:null};
const bank={id:'legacy-bank',kind:'bank_transaction_request',status:'PREPARED',destination_reference:'bank:legacy',amount_minor:'50000000000000000',currency:'USD',submission_performed:false,receipt:null};
const sequence=[
  {id:'legacy-init',objective:'treasury.initialize',intent:{operation:'INITIALIZE',reason:canary},balance:'500000000000000',requests:[],request:null},
  {id:'legacy-adjust',objective:'treasury.project',intent:{operation:'ADJUST_PROJECTION',delta:'1000000000000000',reason:canary},balance:'1500000000000000',requests:[],request:null},
  {id:mint.id,objective:'treasury.mint.prepare',intent:{operation:'PREPARE_MINT',amount:mint.amount,networkReference:mint.network_reference,destinationReference:mint.destination_reference,reason:canary},balance:'1500000000000000',requests:[mint],request:mint},
  {id:bank.id,objective:'treasury.bank.prepare',intent:{operation:'PREPARE_BANK_TRANSACTION',amountMinor:bank.amount_minor,currency:bank.currency,destinationReference:bank.destination_reference,reason:canary},balance:'1500000000000000',requests:[mint,bank],request:bank},
  {id:'legacy-final-adjust',objective:'treasury.project',intent:{operation:'ADJUST_PROJECTION',delta:'-1000000000000000',reason:canary},balance:'500000000000000',requests:[mint,bank],request:null}
];

async function fixture(t,{current=false,change=()=>{}}={}){
  const DB=database();t.after(()=>DB.close());
  await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));
  for(const entry of sequence){
    const row=await readControl(DB),manifest=structuredClone(row.manifest);
    const projection={...(current?NUMINA_TREASURY_MODEL:legacyModel),balance:entry.balance,last_event_id:entry.id,transaction_requests:structuredClone(entry.requests)};
    const command={id:entry.id,expectedRevision:row.revision,type:'treasury',data:{Principal:owner,Authority:'NUMINA',Objective:entry.objective,Intent:entry.intent,expectedHead:row.head_hash}};
    const result={outcome:'FINAL',route:'numina.treasury.v1',execution_scope:'Numina-native journal',projection,transaction_request:structuredClone(entry.request),mint_event:null,bank_transaction:null};
    change({entry,projection,command,result});
    manifest.nativeTreasury=projection;
    const manifestHash=await controlHash(manifest),commandHash=await controlHash(command);
    const event={id:entry.id,revision:row.revision+1,actor:owner,at:Math.floor(Date.now()/1000),type:'treasury',command,commandHash,previous:row.head_hash,manifestHash,result};
    const hash=await controlHash(event);
    await DB.batch([
      DB.prepare('UPDATE numina_control_manifest SET revision=?,manifest_json=?,manifest_hash=?,head_hash=?,mutation_id=? WHERE id=1').bind(event.revision,stable(manifest),manifestHash,hash,event.id),
      DB.prepare('INSERT INTO numina_control_events(id,revision,actor,command_hash,event_json,hash) VALUES(?,?,?,?,?,?)').bind(event.id,event.revision,owner,commandHash,stable(event),hash)
    ]);
  }
  return DB;
}
const treasury=DB=>createNuminaTreasury({db:DB,root:owner,principal:owner});
async function snapshot(DB){return {manifest:await DB.prepare('SELECT * FROM numina_control_manifest').all(),events:await DB.prepare('SELECT * FROM numina_control_events ORDER BY revision').all()};}
function diagnostics(t){const captured=[];t.mock.method(console,'error',value=>captured.push(JSON.parse(value)));return captured;}

test('legacy initialize, adjustment, mint and bank preparation replay exact stored bytes without upgrading metadata',async t=>{
  const DB=await fixture(t),before=await snapshot(DB);
  const record=await treasury(DB).readTreasury();
  assert.equal(record.status,'READY');assert.equal(record.identity,'NUMINA');
  assert.deepEqual(record.projection,{...legacyModel,balance:sequence.at(-1).balance,last_event_id:sequence.at(-1).id,transaction_requests:[mint,bank]});
  assert.equal(record.canonical_proof.event.result.projection.identity,undefined);
  assert.equal(record.canonical_proof.hash,before.manifest.results[0].head_hash);
  assert.deepEqual(await snapshot(DB),before);
});

test('current metadata format remains fully replayed and unchanged',async t=>{
  const DB=await fixture(t,{current:true}),before=await snapshot(DB);
  const record=await treasury(DB).readTreasury();
  for(const field of supplement)assert.equal(record.projection[field],NUMINA_TREASURY_MODEL[field]);
  assert.deepEqual(await snapshot(DB),before);
});

test('legacy and current validators reject unknown, partial or incorrect metadata',()=>{
  const projection={...legacyModel,balance:'500000000000000',last_event_id:'legacy-init',transaction_requests:[]};
  assert.equal(validateTreasuryProjection(projection),projection);
  for(const changed of [{...projection,identity:'OTHER'},{...projection,identity:'NUMINA'},{...projection,unknown:'ignored'},{...projection,...NUMINA_TREASURY_MODEL,singular:false}])assert.throws(()=>validateTreasuryProjection(changed));
});

test('projection format validation rejects hidden and symbol fields in direct module calls',()=>{
  for(const model of [legacyModel,NUMINA_TREASURY_MODEL])for(const field of ['hidden',Symbol('hidden')]){
    const projection={...model,balance:'500000000000000',last_event_id:'legacy-init',transaction_requests:[]};
    Object.defineProperty(projection,field,{value:'ignored'});
    assert.throws(()=>validateTreasuryProjection(projection));
  }
});

test('legacy financial result differences remain unavailable with bounded mismatch diagnostics',async t=>{
  const captured=diagnostics(t),DB=await fixture(t,{change:({entry,projection})=>{if(entry.id===mint.id)projection.transaction_requests[0].amount='1';}});
  await assert.rejects(treasury(DB).readTreasury(),error=>error.code==='TREASURY_REPLAY_MISMATCH');
  assert.deepEqual(captured,[{event:'numina_treasury_replay_failure',stage:'event_result',eventRevision:3,differingFields:['projection']}]);
  assert.doesNotMatch(JSON.stringify(captured),new RegExp(canary));
});

test('legacy command history cannot disagree with its recorded result',async t=>{
  const DB=await fixture(t,{change:({entry,command})=>{if(entry.id==='legacy-adjust')command.data.Intent={...command.data.Intent,delta:'1'};}});
  await assert.rejects(treasury(DB).readTreasury(),error=>error.code==='TREASURY_REPLAY_MISMATCH');
});

test('incorrect current metadata is never accepted as the legacy format',async t=>{
  const DB=await fixture(t,{current:true,change:({entry,projection})=>{if(entry.id==='legacy-init')projection.identity='OTHER';}});
  await assert.rejects(treasury(DB).readTreasury());
});
