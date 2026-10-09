import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {NUMINA_TREASURY_CONNECTION,NUMINA_NATIVE_TREASURY_SYNC} from '../public/treasury-connection-model.js';
import {NUMINA_DENOMINATION_POLICY} from '../public/treasury-valuation.js';
import {NUSD_CONTRACT_RECORD} from '../public/nusd-contract-record.js';
import * as amounts from '../public/treasury-amount.js';

class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=[...nodes];}
}
const amount=(currency,value)=>({currency,value,formatted:amounts.formatTreasuryProviderAmount(value,currency)});
const fixture=()=>({schema:'numina.stripe.treasury.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',transportProvider:'NUMINA',connection:'read_only',account:{id:'test-account',name:'Test financial account',livemode:true,status:'open'},observed_at:'2026-10-09T12:00:00Z',transfer_execution:false,submission_performed:false,settlement_performed:false,receipt:null,nusd_settlement:false,balances:Object.fromEntries(['available','inbound_pending','outbound_pending'].map(bucket=>[bucket,{usd:amount('usd','4'),usdc:amount('usdc','0')}]))});
function harness(request){
 const target=new Element(),calls=[],dispatched=[];
 const context=vm.createContext({...amounts,NUMINA_TREASURY_CONNECTION,NUMINA_NATIVE_TREASURY_SYNC,NUMINA_DENOMINATION_POLICY,NUSD_CONTRACT_RECORD,Date,CustomEvent:class{constructor(type){this.type=type;}},document:{createElement:tag=>new Element(tag),dispatchEvent:event=>dispatched.push(event.type)},requestJson:async(path,options)=>{calls.push({path,options});return request(path,options);}});
 const source=readFileSync(new URL('../public/treasury-balances.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 vm.runInContext(source+'\nglobalThis.render=renderTreasuryBalances;',context);
 return {target,calls,dispatched,render:treasury=>context.render(target,treasury)};
}
function cards(h){return h.target.children.find(node=>node.className==='cards two treasury-balances').children;}
function descendants(node){return [node,...node.children.flatMap(descendants)];}
function rows(card){
 const values={};
 for(const list of descendants(card).filter(node=>node.tagName==='dl'))for(const row of list.children){
  if(row.tagName==='div'&&row.children.length===2)values[row.children[0].textContent]=row.children[1].textContent;
 }
 return values;
}

test('bank role never renders modeled transfer completion as bank-reported balances',async()=>{
 const h=harness(async()=>fixture());await h.render();const bank=cards(h)[1],values=rows(bank);
 assert.equal(values['Current USD'],'Unavailable');assert.equal(values['Available USD'],'Unavailable');assert.equal(values['Freshness'],'Unknown');
 assert.match(bank.textContent,/500,000,000,000,000\.00 USD · owner-designated modeled target/);
 assert.doesNotMatch(bank.textContent,/COMPLETED|CLEARED|8000750550|NUMINA software verified/);
});

test('Stripe role keeps modeled targets separate from exact provider balance buckets',async()=>{
 const record=fixture();record.balances.available.usdc=amount('usdc','12000000');record.balances.inbound_pending.usdc=amount('usdc','3000000');record.balances.outbound_pending.usdc=amount('usdc','2000000');
 const before=structuredClone(record),h=harness(async()=>record);await h.render();const stripe=cards(h)[0],values=rows(stripe);
 assert.match(stripe.textContent,/500,000,000,000,000\.00 USDC · owner-designated modeled target/);
 assert.equal(values['Available USDC'],'12.00 USDC');assert.equal(values['Incoming USDC'],'3.00 USDC');assert.equal(values['Outgoing USDC'],'2.00 USDC');
 assert.deepEqual(record,before);assert.deepEqual(h.calls.map(call=>call.path),['/api/control/v1/stripe-treasury']);
});

test('Stripe role reports unavailable balances after a failed read without replacing them with a modeled amount',async()=>{
 const h=harness(async()=>{throw Error('Connection unavailable');});await h.render();const stripe=cards(h)[0];
 assert.match(stripe.textContent,/Stripe balances are unavailable/);
 assert.match(stripe.textContent,/500,000,000,000,000\.00 USDC · owner-designated modeled target/);
 assert.doesNotMatch(stripe.textContent,/NUMINA balance|balance is unchanged/);
 assert.equal(rows(stripe)['Available USDC'],undefined);
});

test('malformed provider currency or amount is unavailable rather than a displayed Stripe balance',async()=>{
 for(const corrupt of [record=>delete record.balances.available.usd,record=>record.balances.available.usdc.currency='usd',record=>record.balances.available.usdc.value='1e20']){
  const record=fixture();corrupt(record);const h=harness(async()=>record);await h.render();
  assert.match(cards(h)[0].textContent,/Stripe balances are unavailable/);
  assert.equal(rows(cards(h)[0])['Available USDC'],undefined);
 }
});
