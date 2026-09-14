import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';
import {verifyTreasuryAccountView} from '../public/treasury-proof.js';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function settled(){for(let i=0;i<8;i++)await new Promise(r=>setTimeout(r,0));}
class Element{
  constructor(){this.children=[];this._text='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this._text='';this.children=[...nodes];}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
}
async function accountView(funding={}){
  const db=database(),owner='email:owner@example.test';
  try{
    await bootstrapControl(db,owner,Math.floor(Date.now()/1000));const row=await readControl(db);
    const treasury=createNuminaTreasury({db,root:owner,principal:owner});
    await treasury.writeTreasury({id:'ui-treasury',expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Isolated UI fixture'}});
    return alignTreasuryAccounts(await treasury.readTreasury(),{accounts:[{id:'existing',provider:'stripe',legalEntity:'Owner',accountLabel:'Existing reference',providerAccountReference:'original-reference'}],...funding});
  }finally{db.close();}
}
function harness(view,override=()=>null){
  const nodes=new Map(),events={};const get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
  const document={querySelector:get,createElement:()=>new Element(),addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:event=>events[event.type]?.(event)};
  const fetch=async(path,options)=>{
    const custom=override(path,options);if(custom)return await custom;
    let body;
    if(path.endsWith('/treasury/accounts'))body=view;
    else if(path.endsWith('/treasury/policy'))body={activation:{policyHash:'policy'},policyHash:'policy',policy:{id:'policy'}};
    else if(path.endsWith('/stripe-treasury'))return Response.json({error:'Unavailable'},{status:503});
    else if(path.endsWith('/state'))body={revision:1,requests:[]};
    else if(path==='/v4/release/manifest')body={version:'4.0.0',frontier:{version:'4.0.0'},distribution:{codex_plugin:{version:'4.0.0'}}};
    else body={livemode:true,version:'4.0.0',providers:[]};
    return Response.json(body);
  };
  const context=vm.createContext({document,window:{addEventListener:(name,fn)=>events[name]=fn},fetch,Response,AbortController,TextEncoder,crypto,Intl,CustomEvent,setTimeout,clearTimeout,verifyTreasuryAccountView,async refreshControlRoom(){},NUMINA_LAYERS:{layers:[]}});
  vm.runInContext(source('http-client.js')+'\n'+source('treasury-balances.js')+'\n'+"const renderFundingPlan=(()=>{"+source('funding-plan.js')+';return renderFundingPlan;})();\n'+source('frontier-ui.js')+'\nglobalThis.subject={refresh};',context);
  return {get,events,subject:context.subject,close(){events.pagehide?.();}};
}

test('frontier rejects a mixed treasury account snapshot before rendering native balances',async()=>{
  const view=await accountView();view.accounts[0].sharedNativeTreasury.amount='1';const h=harness(view);
  try{await settled();assert.match(h.get('#treasury-status').textContent,/could not be verified/);for(const id of ['#accounts','#treasury-balances','#funding-plan','#treasury-actions'])assert.equal(h.get(id).children.length,0);}finally{h.close();}
});

test('funding panel displays the current native declaration while retaining the signed original plan',async()=>{
  const view=await accountView({fundingPlan:{id:'canonical-plan',status:'UNFUNDED_PLAN',eventId:'original-event'},fundingDeclaration:{FUNDED_PLAN:true,eventId:'owner-event'}}),before=structuredClone(view),h=harness(view);
  try{
    await settled();const panel=h.get('#funding-plan').textContent;
    assert.match(panel,/Current native funding status · FUNDED_PLAN · Owner declaration/);
    assert.match(panel,/Original plan status · UNFUNDED_PLAN/);
    assert.match(panel,/500,000,000,000,000 NUSD/);
    assert.match(panel,/Read signed plan receipt/);assert.match(panel,/Read signed owner declaration/);
    assert.deepEqual(view,before);
  }finally{h.close();}
});

test('frontier session loss clears records and ignores a late treasury response',async()=>{
  const pending=deferred();const h=harness(await accountView(),path=>path.endsWith('/treasury/accounts')?pending.promise:null);
  try{await settled();h.events['numina-owner-access-lost']();pending.resolve(Response.json(await accountView()));await settled();assert.equal(h.get('#accounts').children.length,0);assert.equal(h.get('#treasury-balances').children.length,0);assert.match(h.get('#treasury-status').textContent,/Owner access/);assert.equal(h.get('#refresh').disabled,false);}finally{h.close();}
});

test('a refreshed frontier ignores an older pending snapshot and preserves account labels',async()=>{
  const view=await accountView(),pending=deferred();let reads=0;
  const h=harness(view,path=>path.endsWith('/treasury/accounts')&&reads++===0?pending.promise:null);
  try{await settled();await h.subject.refresh();assert.match(h.get('#accounts').textContent,/Existing reference/);const old=structuredClone(view);old.accounts[0].accountLabel='Stale response';pending.resolve(Response.json(old));await settled();assert.doesNotMatch(h.get('#accounts').textContent,/Stale response/);assert.match(h.get('#accounts').textContent,/500,000,000,000,000 NUSD/);}finally{h.close();}
});

test('late provider reads cannot restore balances after frontier access is lost',async()=>{
  const pending=deferred();const h=harness(await accountView(),path=>path.endsWith('/stripe-treasury')?pending.promise:null);
  try{await settled();assert.ok(h.get('#treasury-balances').children.length);h.events['numina-owner-access-lost']();pending.resolve(Response.json({schema:'numina.stripe.treasury.v1',account:{livemode:true,name:'Late private provider'},balances:{},observed_at:'test'}));await settled();assert.equal(h.get('#treasury-balances').children.length,0);assert.equal(h.get('#accounts').children.length,0);}finally{h.close();}
});
