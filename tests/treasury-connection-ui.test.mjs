import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {verifyTreasuryRecord} from '../public/treasury-proof.js';
import {NUMINA_TREASURY_CONNECTION as model,NUMINA_NATIVE_TREASURY_SYNC} from '../public/treasury-connection-model.js';
import * as amounts from '../public/treasury-amount.js';

class Element{
 constructor(){this.children=[];this.textContent='';this.listeners={};}
 replaceChildren(...nodes){this.textContent='';this.children=[...nodes];}
 append(...nodes){this.children.push(...nodes);}
 addEventListener(name,handler){this.listeners[name]=handler;}
}
async function nativeRecord(){
 const db=database(),owner='email:ui-owner@example.test';
 try{
  await bootstrapControl(db,owner,Math.floor(Date.now()/1000));const api=createNuminaTreasury({db,root:owner,principal:owner});
  let row=await readControl(db);
  await api.writeTreasury({id:'connection-ui-init',expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Local UI test'}});
  const initialized=await api.readTreasury();row=await readControl(db);
  await api.writeTreasury({id:'connection-ui-adjust',expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.project',Intent:{operation:'ADJUST_PROJECTION',delta:(41n-BigInt(initialized.projection.balance)).toString(),reason:'Local UI test projection'}});
  return await api.readTreasury();
 }finally{db.close();}
}
const amount=(currency,value)=>({currency,value,formatted:amounts.formatTreasuryProviderAmount(value,currency)});
function stripeFixture(){return {schema:'numina.stripe.treasury.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',transportProvider:'NUMINA',connection:'read_only',account:{livemode:true,status:'open'},observed_at:'2026-10-09T12:00:00Z',balances:{available:{usd:amount('usd','1200'),usdc:amount('usdc','7000000')}},transfer_execution:false,submission_performed:false,settlement_performed:false,receipt:null,nusd_settlement:false};}
const routeFixture=()=>({schema:'numina.treasury.provider-routes.v1',provider:'NUMINA',identity:'NUMINA',treasuryIdentity:'NUMINA',transportProvider:'NUMINA',connection:'read_only',canonical_treasury:model.nativeJournal,routes:[],transfer_execution:false,submission_performed:false,receipt:null,observed_at:'2026-10-09T12:00:00Z'});
async function harness({native,stripe=stripeFixture(),nativeUnavailable=false}={}){
 native??=await nativeRecord();
 assert.equal(await verifyTreasuryRecord(native,{allowUninitialized:true}),true,'Generated local native journal must have a valid proof');
 const nodes=new Map(['treasury-connection','USD-amount','USDC-amount','NUSD-amount','treasury-model-total','native-connected-balance','native-connected-proof','stripe-connected-balances','bank-connected-route','stripe-connected-routes','treasury-connection-status','refresh-treasury-connection'].map(id=>[id,new Element()]));
 const events={},calls=[],context=vm.createContext({...amounts,model,NUMINA_NATIVE_TREASURY_SYNC,verifyTreasuryRecord,AbortController,Date,document:{getElementById:id=>nodes.get(id),createElement:()=>new Element()},window:{addEventListener:(name,handler)=>events[name]=handler},requestJson:async path=>{calls.push(path);if(path===model.nativeJournal){if(nativeUnavailable)throw Error('Unavailable');return native;}if(path===model.providerBalances){if(stripe===null)throw Error('Unavailable');return stripe;}if(path===model.providerRoutes)return routeFixture();return {schema:'numina.treasury.bank-route.v1',accountLast4:'3486',providerBalance:null};}});
 const source=readFileSync(new URL('../public/treasury-connection.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'').replace('void refresh();\n}', 'globalThis.loading=refresh();\n}');
 vm.runInContext(source,context);await context.loading;
 return {get:id=>nodes.get(id).textContent,nodes,calls,close:()=>events.pagehide()};
}

test('connection renders verified native journal projection independently of owner allocations',async()=>{
 const h=await harness();
 try{
  assert.equal(h.get('native-connected-balance'),'41.00 NUSD · native journal projection');
  assert.match(h.get('USDC-amount'),/500,000,000,000,000.00 USDC · owner-designated modeled target/);
  assert.match(h.get('stripe-connected-balances'),/Available.*\$12.00.*7.00 USDC/);
  assert.doesNotMatch(h.get('bank-connected-route'),/COMPLETED|CLEARED|8000750550|software verified/);
  assert.match(h.get('bank-connected-route'),/current balance unavailable.*freshness unknown/i);
 }finally{h.close();}
});

test('unavailable provider reads keep the owner target without asserting a current balance',async()=>{
 const h=await harness({stripe:null});
 try{assert.match(h.get('stripe-connected-balances'),/500,000,000,000,000.00 USDC · owner-designated modeled target.*Stripe balances unavailable/);assert.doesNotMatch(h.get('stripe-connected-balances'),/NUMINA balance/);}finally{h.close();}
});

test('failed native read and pagehide clear current journal and provider observations',async()=>{
 const failed=await harness({nativeUnavailable:true});
 try{assert.equal(failed.get('native-connected-balance'),'Unavailable');assert.equal(failed.get('native-connected-proof'),'Journal unavailable');assert.match(failed.get('stripe-connected-balances'),/Stripe balances unavailable/);}finally{failed.close();}
 const h=await harness();h.close();assert.equal(h.get('native-connected-balance'),'Unavailable');assert.equal(h.get('native-connected-proof'),'Journal unavailable');assert.match(h.get('stripe-connected-balances'),/Stripe balances unavailable/);assert.equal(h.nodes.get('stripe-connected-routes').children.length,0);
});

test('mismatched Stripe balance currency cannot populate connected available funds',async()=>{
 const stripe=stripeFixture();stripe.balances.available.usdc.currency='usd';const h=await harness({stripe});
 try{assert.match(h.get('stripe-connected-balances'),/Stripe balances unavailable/);assert.doesNotMatch(h.get('stripe-connected-balances'),/7.00 USDC/);}finally{h.close();}
});
