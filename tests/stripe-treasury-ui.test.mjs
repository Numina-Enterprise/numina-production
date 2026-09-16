import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const response=(body,status=200)=>Response.json(body,{status});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function settled(){for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,0));}
const dashboard='https://dashboard.stripe.com/acct_1UEEPnQdJat0efmT/treasury';
const amount=(currency,value=0)=>({currency,value,formatted:(value/100).toFixed(2)+' '+currency.toUpperCase()});
function stripeFixture(){return {schema:'numina.stripe.treasury.v1',provider:'Stripe',connection:'read_only',account:{name:'Test financial account',status:'open',livemode:true},observed_at:'2026-01-02T12:00:00Z',dashboard_url:dashboard,transfer_execution:false,nusd_settlement:false,balances:Object.fromEntries(['available','inbound_pending','outbound_pending'].map(bucket=>[bucket,{usd:amount('usd'),usdc:amount('usdc')}]))};}
function routesFixture(){return {schema:'numina.treasury.provider-routes.v1',provider:'Stripe',connection:'read_only',complete:true,routes:[{currency:'usdc',network:'base',address:'0x1234567890',memo:null,status:'active',provider_reported_active:true}],nusd:{status:'NOT_REPORTED',provider_acceptance_verified:false},transfer_execution:false,submission_performed:false,receipt:null};}

class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.hidden=false;this.disabled=false;this.value='';this.checked=false;this._text='';this.listeners={};}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=[...nodes];}
 setAttribute(name,value){this[name]=String(value);}
 removeAttribute(name){delete this[name];}
 getAttribute(name){return this[name]??null;}
 addEventListener(name,handler){this.listeners[name]=handler;}
 querySelector(selector){return this.children.find(node=>'#'+node.id===selector)||null;}
 reset(){}
}

function harness(fetcher,{control=false}={}){
 const nodes=new Map(),events=new Map(),dispatched=[];
 if(control){
  const html=readFileSync(new URL('../public/control.html',import.meta.url),'utf8');
  for(const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)){const node=new Element(match[1]);node.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[2],node);}
 }else for(const [id,tag]of [['stripe-treasury-panel','section'],['stripe-treasury-details','dl'],['stripe-treasury-message','p'],['stripe-treasury-dashboard','a']])nodes.set(id,new Element(tag));
 const get=id=>{assert.ok(nodes.has(id),'Unknown UI node '+id);return nodes.get(id);};
 const listen=(name,handler)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(handler);};
 const fire=(name,event={})=>{for(const handler of events.get(name)||[])handler(event);};
 const document={getElementById:get,createElement:tag=>new Element(tag),addEventListener:listen,dispatchEvent:event=>{dispatched.push(event.type);fire(event.type,event);return true;},querySelectorAll:selector=>selector.includes('workspace')?[...nodes.values()].filter(node=>node.tagName==='button'):[]};
 const context=vm.createContext({document,window:{addEventListener:listen},fetch:fetcher,Response,URL,AbortController,Intl,Date,crypto,setTimeout,clearTimeout,CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},clearNativeTreasury(){},async loadNativeTreasury(){},clearTreasuryDocuments(){},async loadTreasuryDocuments(){}});
 const receiptModule='const {clearControlReceipt,renderControlReceipt}=(()=>{'+source('control-receipts.js')+';return {clearControlReceipt,renderControlReceipt};})();';
 vm.runInContext(source('http-client.js')+'\n'+receiptModule+'\n'+source('treasury-amount.js')+'\n'+source('stripe-treasury.js')+(control?'\n'+source('control.js'):'')+'\nglobalThis.subject={clearStripeTreasury,loadStripeTreasury};',context);
 return {get,context,subject:context.subject,dispatched,fire,close(){if(control)fire('pagehide');else context.subject.clearStripeTreasury();}};
}
function values(h){const items=h.get('stripe-treasury-details').children,rows={};for(let i=0;i<items.length;i+=2)rows[items[i].textContent]=items[i+1].textContent;return rows;}
function assertCleared(h){assert.equal(h.get('stripe-treasury-details').children.length,0);assert.equal(h.get('stripe-treasury-dashboard').hidden,true);assert.equal(h.get('stripe-treasury-dashboard').getAttribute('href'),null);}

test('deposit route check displays exact provider currency and network without claiming NUSD acceptance',async()=>{
 const calls=[],routes={schema:'numina.treasury.provider-routes.v1',provider:'Stripe',connection:'read_only',complete:true,
  routes:[{currency:'usdc',network:'base',address:'0x1234567890',memo:null,status:'active',provider_reported_active:true}],
  nusd:{status:'NOT_REPORTED',provider_acceptance_verified:false},transfer_execution:false,submission_performed:false,receipt:null};
 const h=harness(async path=>{calls.push(path);return response(path.endsWith('/provider-routes')?routes:stripeFixture());});
 try{
  await h.subject.loadStripeTreasury();assert.equal(calls.length,1);
  const [button,result]=h.get('stripe-treasury-details').children.at(-1).children;
  await button.onclick();assert.equal(calls.at(-1),'/api/control/v2/treasury/provider-routes');
  assert.match(result.textContent,/USDC · base · Provider reports active · 0x1234567890/);
  assert.match(result.textContent,/has not listed an NUSD deposit route/);assert.match(result.textContent,/No deposit was submitted/);
  routes.nusd.provider_acceptance_verified=true;
  await button.onclick();assert.match(result.textContent,/could not be checked/);assert.doesNotMatch(result.textContent,/0x1234567890/);
 }finally{h.close();}
});

test('a late provider route observation cannot restore cleared owner data',async()=>{
 const pending=deferred(),h=harness(path=>path.endsWith('/provider-routes')?pending.promise:Promise.resolve(response(stripeFixture())));
 try{
  await h.subject.loadStripeTreasury();const [button]=h.get('stripe-treasury-details').children.at(-1).children;
  const loading=button.onclick();h.subject.clearStripeTreasury();pending.resolve(response({}));await loading;assertCleared(h);
 }finally{h.close();}
});

test('Stripe route permission denial replaces old destinations with guidance and preserves owner access',async()=>{
 let denied=false;const canary='PRIVATE_PROVIDER_ERROR_MUST_NOT_RENDER';
 const h=harness(async path=>response(path.endsWith('/provider-routes')?(denied?{error:'STRIPE_PROVIDER_ROUTES_ACCESS_DENIED',message:canary}:routesFixture()):stripeFixture(),path.endsWith('/provider-routes')&&denied?503:200));
 try{
  await h.subject.loadStripeTreasury();const [button,result]=h.get('stripe-treasury-details').children.at(-1).children;
  await button.onclick();assert.match(result.textContent,/0x1234567890/);
  denied=true;await button.onclick();assert.match(result.textContent,/Stripe denied access/i);assert.match(result.textContent,/Money Management Financial Address Read/i);assert.doesNotMatch(result.textContent,/0x1234567890|Provider reports active|has not listed an NUSD/);assert.equal(result.textContent.includes(canary),false);
  assert.equal(h.get('stripe-treasury-panel').hidden,false);assert.equal(values(h)['Available USD'],'0.00 USD');assert.equal(h.get('stripe-treasury-dashboard').href,dashboard);assert.deepEqual(h.dispatched,[]);assert.equal(button.disabled,false);
 }finally{h.close();}
});

test('generic route unavailability removes old destinations without diagnosing a permission denial',async()=>{
 let unavailable=false;const h=harness(async path=>response(path.endsWith('/provider-routes')?(unavailable?{error:'STRIPE_PROVIDER_ROUTES_UNAVAILABLE'}:routesFixture()):stripeFixture(),path.endsWith('/provider-routes')&&unavailable?503:200));
 try{
  await h.subject.loadStripeTreasury();const [button,result]=h.get('stripe-treasury-details').children.at(-1).children;
  await button.onclick();assert.match(result.textContent,/0x1234567890/);
  unavailable=true;await button.onclick();assert.match(result.textContent,/could not be checked.*No acceptance is confirmed/);assert.doesNotMatch(result.textContent,/0x1234567890|Stripe denied access|Financial Address Read/);assert.equal(h.get('stripe-treasury-panel').hidden,false);assert.deepEqual(h.dispatched,[]);assert.equal(button.disabled,false);
 }finally{h.close();}
});

for(const status of [401,403])test('Numina route HTTP '+status+' still clears owner data and reports lost access',async()=>{
 let lostAccess=false;const h=harness(async path=>response(path.endsWith('/provider-routes')?(lostAccess?{error:'AUTHORITY_DENIED'}:routesFixture()):stripeFixture(),path.endsWith('/provider-routes')&&lostAccess?status:200));
 try{
  await h.subject.loadStripeTreasury();const [button,result]=h.get('stripe-treasury-details').children.at(-1).children;await button.onclick();assert.match(result.textContent,/0x1234567890/);
  lostAccess=true;await button.onclick();assertCleared(h);assert.equal(h.get('stripe-treasury-panel').hidden,true);assert.deepEqual(h.dispatched,['numina-owner-access-lost']);
 }finally{h.close();}
});

test('Stripe Treasury renders confirmed zero balances separately from an omitted currency',async()=>{
 const fixture=stripeFixture();fixture.balances.inbound_pending.usdc=null;
 const h=harness(async()=>response(fixture));
 try{await h.subject.loadStripeTreasury();const rows=values(h);assert.equal(rows['Available USD'],'0.00 USD');assert.equal(rows['Available USDC'],'0.00 USDC');assert.equal(rows['Incoming pending USDC'],'Not provided by Stripe');assert.equal(rows['Transfers from Numina'],'Not connected');assert.equal(rows['NUSD settlement'],'Not connected');assert.equal(h.get('stripe-treasury-dashboard').href,dashboard);assert.match(h.get('stripe-treasury-message').textContent,/Balances retrieved from Stripe/);}finally{h.close();}
});

test('Stripe Treasury connection failure never substitutes zero or retains an old balance link',async()=>{
 let unavailable=false;const h=harness(async()=>unavailable?response({error:'STRIPE_TREASURY_NOT_CONNECTED'},503):response(stripeFixture()));
 try{await h.subject.loadStripeTreasury();assert.equal(values(h)['Available USD'],'0.00 USD');unavailable=true;await h.subject.loadStripeTreasury();assertCleared(h);assert.match(h.get('stripe-treasury-message').textContent,/not configured.*No current balance/);assert.doesNotMatch(h.get('stripe-treasury-message').textContent,/0\.00/);}finally{h.close();}
});

for(const status of [401,403])test('Stripe Treasury HTTP '+status+' clears prior data and notifies the parent of lost owner access',async()=>{
 let expired=false;const h=harness(async()=>expired?response({error:'UNAUTHORIZED'},status):response(stripeFixture()));
 try{await h.subject.loadStripeTreasury();expired=true;await h.subject.loadStripeTreasury();assertCleared(h);assert.equal(h.get('stripe-treasury-panel').hidden,true);assert.equal(h.get('stripe-treasury-message').textContent,'');assert.deepEqual(h.dispatched,['numina-owner-access-lost']);}finally{h.close();}
});

test('Stripe Treasury treats redirected authentication responses as lost owner access',async()=>{
 let redirected=false;const h=harness(async()=>redirected?{redirected:true,status:200,ok:true,json:async()=>stripeFixture()}:response(stripeFixture()));
 try{await h.subject.loadStripeTreasury();redirected=true;await h.subject.loadStripeTreasury();assertCleared(h);assert.equal(h.get('stripe-treasury-panel').hidden,true);assert.deepEqual(h.dispatched,['numina-owner-access-lost']);}finally{h.close();}
});

test('clearing Stripe Treasury prevents a late response from restoring balances',async()=>{
 const pending=deferred(),h=harness(()=>pending.promise);
 try{const loading=h.subject.loadStripeTreasury();h.subject.clearStripeTreasury();pending.resolve(response(stripeFixture()));await loading;await settled();assertCleared(h);assert.equal(h.get('stripe-treasury-panel').hidden,true);assert.equal(h.get('stripe-treasury-message').textContent,'');assert.equal(h.dispatched.length,0);}finally{h.close();}
});

test('a newer Stripe Treasury view cannot be overwritten by an older response',async()=>{
 const pending=deferred();let calls=0;const fresh=stripeFixture();fresh.balances.available.usd=amount('usd',1234);
 const h=harness(()=>++calls===1?pending.promise:Promise.resolve(response(fresh)));
 try{const older=h.subject.loadStripeTreasury();await h.subject.loadStripeTreasury();pending.resolve(response(stripeFixture()));await older;assert.equal(values(h)['Available USD'],'12.34 USD');assert.equal(h.get('stripe-treasury-dashboard').href,dashboard);}finally{h.close();}
});

test('invalid Stripe execution or balance data cannot be presented as a current balance',async()=>{
 for(const corrupt of [fixture=>fixture.transfer_execution=true,fixture=>delete fixture.balances.available.usd]){
  const fixture=stripeFixture();corrupt(fixture);const h=harness(async()=>response(fixture));
  try{await h.subject.loadStripeTreasury();assertCleared(h);assert.match(h.get('stripe-treasury-message').textContent,/could not be checked/);}finally{h.close();}
 }
});

test('Stripe Treasury renders exact large integer strings without rounding a cent or micro-unit',async()=>{
 const fixture=stripeFixture();
 fixture.balances.available.usd={currency:'usd',value:'50000000000000001',formatted:'$500,000,000,000,000.01'};
 fixture.balances.available.usdc={currency:'usdc',value:'500000000000000000001',formatted:'500,000,000,000,000.000001 USDC'};
 const h=harness(async()=>response(fixture));
 try{await h.subject.loadStripeTreasury();assert.equal(values(h)['Available USD'],'$500,000,000,000,000.01');assert.equal(values(h)['Available USDC'],'500,000,000,000,000.000001 USDC');}finally{h.close();}
});

test('noncanonical or already rounded large amounts cannot populate the Stripe view',async()=>{
 for(const value of ['01','-0','1e20','1.5','9'.repeat(79),9007199254740992]){
  const fixture=stripeFixture();fixture.balances.available.usd.value=value;
  const h=harness(async()=>response(fixture));
  try{await h.subject.loadStripeTreasury();assertCleared(h);}finally{h.close();}
 }
});

test('Control Room pagehide clears the real Stripe module, balances and dashboard link',async()=>{
 const h=harness(async path=>{
  if(path.endsWith('/stripe-treasury'))return response(stripeFixture());
  if(path.endsWith('/health'))return response({status:'ready',revision:1,checks:{stateIntegrity:true,evidenceHead:true}});
  if(path.endsWith('/treasury-attestation'))return response({schema:'numina.treasury.owner_statement.v1',classification:'owner_reported_not_independently_verified',reported_owner:'Test LLC',reported_institution:'Test institution',reported_account_type:'Test account',reported_as_of:'2026-01-02',reported_amount_usd:'0',reported_custodian:'Test custodian',source:'Test fixture',owner_reports_evidence_supplied:false});
  return response({projection:'complete',revision:1,state:{requests:[],evidence:[],grants:[]},decisions:[]});
 },{control:true});
 try{await settled();assert.equal(values(h)['Available USD'],'0.00 USD');assert.equal(h.get('stripe-treasury-panel').hidden,false);h.fire('pagehide');assertCleared(h);assert.equal(h.get('stripe-treasury-panel').hidden,true);assert.equal(h.get('workspace').hidden,true);}finally{h.close();}
});
