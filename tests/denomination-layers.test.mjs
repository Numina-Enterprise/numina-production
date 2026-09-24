import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import built from '../dist/server/index.js';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {NUMINA_DENOMINATION_POLICY as policy} from '../public/treasury-valuation.js';
import {loadNativeTreasury,clearNativeTreasury} from '../public/native-treasury.js';
import {NuminaClient} from '../integrations/numina/src/client.js';
const json=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url)));

test('all public layers and discovery tools carry the same declared policy without changing treasury state',async()=>{
  const db=database(),owner='email:layers@example.test',env={DB:db,NUMINA_LIVEMODE:'true'};
  try{
    await bootstrapControl(db,owner,Math.floor(Date.now()/1000));const before=await readControl(db);
    for(const path of ['/api/control/v1/manifest','/api/control/v2/manifest','/api/control/v2/architecture','/api/app/v1/catalog','/api/nusd/v1/status']){
      const response=await built.fetch(new Request('https://numina.test'+path),env);assert.equal(response.status,200,path);
      const data=await response.json();assert.deepEqual(data.denomination_policy,policy,path);
      if(data.capabilities){assert.equal(data.capabilities.mint,false);assert.equal(data.capabilities.settlement,false);}
    }
    for(const name of ['numina_architecture','numina_capabilities']){
      const response=await built.fetch(new Request('https://numina.test/api/control/v2/discovery-mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}})}),env);
      assert.equal(response.status,200);const result=(await response.json()).result;assert.equal(result.isError,false);
      assert.deepEqual(JSON.parse(result.content[0].text).denomination_policy,policy);
    }
    const after=await readControl(db);assert.equal(after.revision,before.revision);assert.equal(after.head_hash,before.head_hash);
    for(const file of ['dist/client/source-alignment.json','dist/client/downloads/application-release-v4.json','public/business-core.json','integrations/numina/distribution.json'])assert.deepEqual(json(file).denomination_policy,policy,file);
    const release=json('dist/client/downloads/application-release-v4.json');assert.equal(release.nusd_denomination_policy.statement,policy.expression);assert.equal(release.nusd_denomination_policy.executable_conversion_verified,false);
  }finally{db.close();}
});

test('integration projections retain optional server policy without claiming provider verification',async()=>{
  const release=json('dist/client/downloads/application-release-v4.json'),calls=[];let include=true;
  const client=new NuminaClient({baseUrl:'https://numina.test',fetch:async(url,options)=>{calls.push({url,method:options.method});return Response.json(url.endsWith('/status')?{schema:'numina.nusd.status.v1',...(include?{denomination_policy:policy}:{})}:{...release,...(include?{}:{denomination_policy:undefined})});}});
  assert.deepEqual((await client.network()).data.denomination_policy,policy);
  const runtime=await client.runtimeBuild();assert.deepEqual(runtime.data.denomination_policy,policy);assert.equal(runtime.asset_execution_available,false);assert.equal(runtime.data.current_financial_status_checked,false);
  include=false;assert.equal(Object.hasOwn((await client.network()).data,'denomination_policy'),false);assert.equal(Object.hasOwn((await client.runtimeBuild()).data,'denomination_policy'),false);
  assert.ok(calls.every(call=>call.method==='GET'));
});

class Element{
  constructor(){this.children=[];this._text='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this._text='';this.children=[...nodes];}
  set textContent(text){this._text=String(text);this.children=[];}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
}
test('hosted app and mobile treasury panel align the aggregate, allocations and journal only after proof passes',async()=>{
  const db=database(),owner='email:mobile@example.test',saved={document:globalThis.document,fetch:globalThis.fetch},elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  try{
    await bootstrapControl(db,owner,Math.floor(Date.now()/1000));const row=await readControl(db),treasury=createNuminaTreasury({db,root:owner,principal:owner});
    await treasury.writeTreasury({id:'mobile-policy',expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Isolated test'}});
    const record=await treasury.readTreasury();let response=record;
    globalThis.document={getElementById:get,createElement:()=>new Element(),dispatchEvent(){}};
    globalThis.fetch=async()=>Response.json(response);
    await loadNativeTreasury();
    const details=get('native-treasury-details').textContent;
    assert.match(details,/1 NUSD = 1 USDC = 1 USD/);
    assert.match(details,/Final NUMINA-native aggregate1,500,000,000,000,000\.00 NUSD/);
    assert.match(details,/Final native holding · NUMINA Native Treasury · Bank of America Savings 3486 · 500T USD \/ 500T NUSD500,000,000,000,000\.00 USD/);
    assert.match(details,/Final native holding · NUMINA Native Treasury · Stripe USDC 0x736bd8…018e · 500T USDC \/ 500T NUSD500,000,000,000,000\.00 USDC/);
    assert.match(details,/Final native holding · Numina Native Treasury · NUSD500,000,000,000,000\.00 NUSD/);
    assert.match(details,/Native journal balance500,000,000,000,000\.00 NUSD/);
    assert.match(details,/Journal\/model comparisonMatches the 500T native NUSD holding; the native receipt aggregate is 1,500T/);
    assert.match(details,/NUSD mintCONFIRMED · 1,500,000,000,000,000\.00 NUSD/);
    assert.match(get('native-treasury-message').textContent,/Aggregate 1,500T NUSD; mint confirmed; 0 burned/);
    assert.match(details,/Canonical settlement receiptnumina:treasury:settlement:2026-09-19:v1/);
    assert.match(details,/NUSD burned0\.00 NUSD/);
    assert.deepEqual(await treasury.readTreasury(),record);
    const latest=await readControl(db);
    await treasury.writeTreasury({id:'mobile-aggregate',expectedRevision:latest.revision,expectedHead:latest.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.project',Intent:{operation:'ADJUST_PROJECTION',delta:'1000000000000000',reason:'Isolated aggregate journal fixture'}});
    response=await treasury.readTreasury();
    const aggregateRecord=structuredClone(response);
    await loadNativeTreasury();
    assert.match(get('native-treasury-details').textContent,/Native journal balance1,500,000,000,000,000\.00 NUSD/);
    assert.match(get('native-treasury-details').textContent,/Journal\/model comparisonMatches the 1,500T native receipt aggregate/);
    assert.match(get('native-treasury-details').textContent,/Final native holding · Numina Native Treasury · NUSD500,000,000,000,000\.00 NUSD/);
    assert.deepEqual(await treasury.readTreasury(),aggregateRecord);
    response=structuredClone(record);response.projection.balance='1';await loadNativeTreasury();assert.equal(get('native-treasury-details').textContent,'');
    globalThis.fetch=async()=>Response.json({error:'UNAUTHENTICATED'},{status:401});await loadNativeTreasury();assert.equal(get('native-treasury-panel').hidden,true);assert.equal(get('native-treasury-details').textContent,'');
  }finally{clearNativeTreasury();globalThis.document=saved.document;globalThis.fetch=saved.fetch;db.close();}
});
