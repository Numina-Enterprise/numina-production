import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';
import {verifyTreasuryAccountView} from '../public/treasury-proof.js';
import {createTreasuryAdjustment} from '../public/treasury-adjustment.js';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const applicationManifest=()=>({schema:'numina.application-release.v2',schema_version:2,product:'Numina',version:'4.0.0',release:'numina-v4.0.0',build_id:'a'.repeat(64),frontier:{version:'4.0.0'},distribution:{codex_plugin:{version:'4.0.0'}}});
async function settled(){for(let i=0;i<8;i++)await new Promise(r=>setTimeout(r,0));}
class Element{
  constructor(){this.children=[];this._text='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this._text='';this.children=[...nodes];}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  setAttribute(name,value){this[name]=value;}
}
async function accountView(funding={},initialized=true){
  const db=database(),owner='email:owner@example.test';
  try{
    await bootstrapControl(db,owner,Math.floor(Date.now()/1000));const row=await readControl(db);
    const treasury=createNuminaTreasury({db,root:owner,principal:owner});
    if(initialized)await treasury.writeTreasury({id:'ui-treasury',expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Isolated UI fixture'}});
    return alignTreasuryAccounts(await treasury.readTreasury(),{accounts:[{id:'existing',provider:'stripe',legalEntity:'Owner',accountLabel:'Existing reference',providerAccountReference:'original-reference'}],...funding});
  }finally{db.close();}
}
function harness(view,override=()=>null,adjustmentClient=null){
  const nodes=new Map(),events={};const get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
  const document={querySelector:get,createElement:()=>new Element(),addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:event=>events[event.type]?.(event)};
  const fetch=async(path,options)=>{
    const custom=override(path,options);if(custom)return await custom;
    let body;
    if(path.endsWith('/treasury/accounts'))body=view;
    else if(path.endsWith('/treasury/policy'))body={activation:{policyHash:'policy'},policyHash:'policy',policy:{id:'policy'}};
    else if(path.endsWith('/stripe-treasury'))return Response.json({error:'Unavailable'},{status:503});
    else if(path.endsWith('/state'))body={revision:1,requests:[]};
    else if(path==='/v4/release/manifest')body=applicationManifest();
    else body={livemode:true,version:'4.0.0',providers:[]};
    return Response.json(body);
  };
  const context=vm.createContext({document,window:{addEventListener:(name,fn)=>events[name]=fn},fetch,Response,AbortController,TextEncoder,crypto,Intl,CustomEvent,setTimeout,clearTimeout,verifyTreasuryAccountView,async refreshControlRoom(){},mountTreasuryPreparation(target,options){assert.equal(options.root,view.treasury.root);assert.deepEqual(options.accounts,view.accounts);assert.equal(typeof options.onAccessLost,'function');assert.equal(typeof options.onCommitted,'function');assert.equal(typeof options.isCurrent,'function');},...(!adjustmentClient?{mountTreasuryAdjustment(){}}:{createTreasuryAdjustment:()=>adjustmentClient}),NUMINA_LAYERS:{layers:[]}});
  if(adjustmentClient)vm.runInContext('const mountTreasuryAdjustment=(()=>{'+source('treasury-adjustment-ui.js')+';return mountTreasuryAdjustment;})();',context);
  vm.runInContext(source('http-client.js')+'\n'+source('treasury-valuation.js')+'\n'+source('treasury-balances.js')+'\n'+"const renderFundingPlan=(()=>{"+source('funding-plan.js')+';return renderFundingPlan;})();\n'+source('frontier-ui.js')+'\nglobalThis.subject={refresh};',context);
  return {get,events,subject:context.subject,close(){events.pagehide?.();}};
}

test('frontier displays only current application identities and refreshes without stale responses',async()=>{
  const view=await accountView(),old=deferred();let calls=0;
  const h=harness(view,(path,options)=>{
    if(path!=='/v4/release/manifest')return null;
    assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    return ++calls===1?old.promise:Response.json({...applicationManifest(),build_id:'b'.repeat(64)});
  });
  try{
    await settled();await h.subject.refresh();await settled();
    assert.match(h.get('#core-release-status').textContent,new RegExp('Build '+'b'.repeat(64)));
    old.resolve(Response.json(applicationManifest()));await settled();
    assert.match(h.get('#core-release-status').textContent,new RegExp('Build '+'b'.repeat(64)));
  }finally{h.close();}
});

for(const phase of ['prepare','submit'])for(const status of [401,403])test(`adjustment ${phase} HTTP ${status} clears all private frontier panels`,async()=>{
 const view=await accountView();let reads=0,writes=0;
 const denied=()=>{throw Object.assign(Error('Owner access lost'),{status});};
 const client=createTreasuryAdjustment({read:async()=>{reads++;if(phase==='prepare')denied();return structuredClone(view.treasury);},write:async()=>{writes++;denied();}});
 const h=harness(view,()=>null,client);
 const find=(target,predicate)=>{if(predicate(target))return target;for(const child of target.children){const match=find(child,predicate);if(match)return match;}};
 try{
  await settled();assert.ok(h.get('#accounts').children.length);
  const actions=h.get('#treasury-actions'),section=actions.children[0],form=section.children[2];
  const delta=find(section,node=>node.id==='native-adjustment-delta'),reason=find(section,node=>node.id==='native-adjustment-reason'),commit=find(section,node=>node.id==='native-adjustment-commit');
  delta.value='1000000000000000';reason.value='Authorized native model adjustment';
  await form.onsubmit({preventDefault(){}});if(phase==='submit')await commit.onclick();
  assert.equal(reads,1);assert.equal(writes,phase==='submit'?1:0);
  for(const selector of ['#treasury-actions','#treasury-policy','#accounts','#requests','#treasury-balances','#funding-plan'])assert.equal(h.get(selector).children.length,0);
  assert.match(h.get('#treasury-status').textContent,/Owner access is required/);
  assert.match(h.get('#account-status').textContent,/Sign in to Numina/);
  await commit.onclick();await form.onsubmit({preventDefault(){}});assert.equal(reads,1);assert.equal(writes,phase==='submit'?1:0);
 }finally{h.close();}
});

test('frontier rejects older, missing and mixed application release metadata',async()=>{
  const view=await accountView();
  for(const change of [{version:'3.0.0',release:'numina-v3.0.0'},{schema:'unknown'},{build_id:null},{frontier:{version:'3.0.0'}},{distribution:{codex_plugin:{version:'3.0.0'}}}]){
    const h=harness(view,path=>path==='/v4/release/manifest'?Response.json({...applicationManifest(),...change}):null);
    try{await settled();assert.match(h.get('#core-release-status').textContent,/Current release information is unavailable/);assert.doesNotMatch(h.get('#core-release-status').textContent,/Production|Build [a-f0-9]{64}/);}finally{h.close();}
  }
});

test('frontier rejects a mixed treasury account snapshot before rendering native balances',async()=>{
  const view=await accountView();view.accounts[0].sharedNativeTreasury.amount='1';const h=harness(view);
  try{await settled();assert.match(h.get('#treasury-status').textContent,/could not be verified/);for(const id of ['#accounts','#treasury-balances','#funding-plan','#treasury-actions'])assert.equal(h.get(id).children.length,0);}finally{h.close();}
});

test('frontier never renders provider verification substituted for an owner designation',async()=>{
  for(const initialized of [false,true]){
    const view=await accountView({accounts:[{id:'existing',provider:'stripe',legalEntity:'Owner',accountLabel:'Existing reference',providerAccountReference:'original-reference',source:'owner_designation',providerOwnershipVerified:false}]},initialized);
    view.accounts[0].providerOwnershipVerified=true;
    const h=harness(view);
    try{
      await settled();
      assert.doesNotMatch(h.get('#accounts').textContent,/Provider verified/);
      assert.match(h.get('#treasury-status').textContent,/could not be verified/);
      for(const id of ['#accounts','#treasury-balances','#funding-plan','#treasury-actions'])assert.equal(h.get(id).children.length,0);
    }finally{h.close();}
  }
});

test('funding panel displays the current native declaration while retaining the signed original plan',async()=>{
  const view=await accountView({fundingPlan:{id:'canonical-plan',status:'UNFUNDED_PLAN',eventId:'original-event'},fundingDeclaration:{FUNDED_PLAN:true,eventId:'owner-event'}}),before=structuredClone(view),h=harness(view);
  try{
    await settled();const panel=h.get('#funding-plan').textContent;
    assert.match(panel,/Current native funding status · FUNDED_PLAN · Owner declaration/);
    assert.match(panel,/Original plan status · UNFUNDED_PLAN/);
    assert.match(panel,/View the canonical native treasury/);assert.doesNotMatch(panel,/500,000,000,000,000/);assert.match(h.get('#treasury-balances').textContent,/500,000,000,000,000 NUSD/);
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
  try{await settled();await h.subject.refresh();assert.match(h.get('#accounts').textContent,/Existing reference/);const old=structuredClone(view);old.accounts[0].accountLabel='Stale response';pending.resolve(Response.json(old));await settled();assert.doesNotMatch(h.get('#accounts').textContent,/Stale response/);assert.match(h.get('#accounts').textContent,/View the canonical native treasury/);assert.match(h.get('#accounts').textContent,/500,000,000,000,000 NUSD/);assert.match(h.get('#accounts').textContent,/same canonical balance, counted once/);}finally{h.close();}
});

test('late provider reads cannot restore balances after frontier access is lost',async()=>{
  const pending=deferred();const h=harness(await accountView(),path=>path.endsWith('/stripe-treasury')?pending.promise:null);
  try{await settled();assert.ok(h.get('#treasury-balances').children.length);h.events['numina-owner-access-lost']();pending.resolve(Response.json({schema:'numina.stripe.treasury.v1',account:{livemode:true,name:'Late private provider'},balances:{},observed_at:'test'}));await settled();assert.equal(h.get('#treasury-balances').children.length,0);assert.equal(h.get('#accounts').children.length,0);}finally{h.close();}
});
