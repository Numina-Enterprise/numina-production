import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,commitControl} from '../src/control-store.js';
import worker from '../src/worker.js';
import {APP_CONSENT_VERSION,APP_LEGAL_POLICY,APP_OFFERS} from '../src/app-core.js';
import {workspaceSignInUrl,resumeWorkspaceSession} from '../public/workspace-session.js';
import {selectService,countryOptions,offerLabel} from '../public/app-entry.js';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const response=(body,status=200)=>Response.json(body,{status});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setTimeout(r,0));
async function settled(){for(let i=0;i<8;i++)await tick();}
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.hidden=false;this.disabled=false;this.value='';this.checked=false;this._text='';this.dataset={};}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 get options(){return this.children;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=[...nodes];}
 addEventListener(name,fn){this.listeners[name]=fn;}
 setAttribute(){}
 scrollIntoView(){}
 querySelector(selector){return this.children.find(node=>'#'+node.id===selector)||null;}
 reset(){this.onReset?.();}
 async fire(name,extra={}){return this.listeners[name]?.({preventDefault(){},...extra});}
}
function harness(kind,fetcher,{href='https://numina.test/app'}={}){
 const nodes=new Map(),events={},redirects=[];const html=readFileSync(new URL('../public/'+(kind==='app'?'app':'control')+'.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)){const node=new Element(match[1]);node.hidden=/\bhidden\b/.test(match[0]);const policy=match[0].match(/data-legal-policy-revision="([^"]+)"/)?.[1];if(policy)node.dataset.legalPolicyRevision=policy;nodes.set(match[2],node);}
 const get=id=>{assert.ok(nodes.has(id),'Unknown UI node '+id);return nodes.get(id);};
 const signInLinks=[...html.matchAll(/<a\b[^>]*href="(\/signin-with-chatgpt[^\"]*)"[^>]*>/g)].map(match=>{const id=match[0].match(/\bid="([^"]+)"/)?.[1];const link=id?get(id):new Element('a');link.href=match[1];return link;});
 if(kind==='app'){
  for(const id of ['diagnostic','audit']){const option=new Element('option');option.value=id;get('service').append(option);}get('service').value='diagnostic';
  get('request-form').onReset=()=>{for(const id of ['request-title','request-brief','request-success'])get(id).value='';get('service').value='diagnostic';};
 }
 const window={addEventListener:(name,fn)=>events[name]=fn,location:{assign(){throw new Error('Unexpected navigation in test');}}};
 const document={getElementById:get,createElement:tag=>new Element(tag),dispatchEvent:event=>events[event.type]?.(event),addEventListener:(name,fn)=>events[name]=fn,
  querySelectorAll:selector=>selector==='[data-workspace-access]'?signInLinks:selector==='a[href^="/signin-with-chatgpt"]'?signInLinks.filter(link=>link.href.startsWith('/signin-with-chatgpt')):selector.startsWith('a[')?[]:selector.includes('workspace')?[...nodes.values()].filter(n=>n.tagName==='button'):selector.includes('checkout-button')?[get('checkout-button')]:[]};
 const context=vm.createContext({document,window,navigator:{onLine:true},location:{href,replace:target=>redirects.push(target)},fetch:fetcher,Response,URL,URLSearchParams,AbortController,crypto,Intl,Date,TextEncoder,CustomEvent,setTimeout,clearTimeout,console,workspaceSignInUrl,resumeWorkspaceSession,selectService,countryOptions,offerLabel,
  clearTreasuryDocuments(){},async loadTreasuryDocuments(){},clearStripeTreasury(){},async loadStripeTreasury(){}});
 const exports=kind==='app'?'({api,openOrder,loadOrders,savedView,boot,clearSession,get session(){return session;},get selected(){return selected;}})':'({api,refresh,run,clearSession,get snapshot(){return snapshot;}})';
 const receiptModule='const {clearControlReceipt,renderControlReceipt}=(()=>{'+source('control-receipts.js')+';return {clearControlReceipt,renderControlReceipt};})();';
 const nativeModule='const {clearNativeTreasury,loadNativeTreasury}=(()=>{'+source('treasury-proof.js')+'\n'+source('treasury-valuation.js')+'\n'+source('treasury-amount.js')+'\n'+source('native-treasury.js')+';return {clearNativeTreasury,loadNativeTreasury};})();';
 vm.runInContext(source('http-client.js')+'\n'+receiptModule+'\n'+nativeModule+'\n'+source(kind==='app'?'app-ui.js':'control.js')+'\nglobalThis.subject='+exports,context);
 return {get,events,redirects,signInLinks,subject:context.subject,context,close(){events.pagehide?.();}};
}
function order(id,title=id){return {id,title,revision:0,brief:'Private brief '+id,successCriteria:'Private success '+id,service:'diagnostic',country:'US',status:'submitted',isOwner:true,payment:{status:'unconfirmed',gross:0,refunded:0}};}
function appFetch(overrides=()=>null){return async(path,options)=>{
 const custom=overrides(path,options);if(custom)return await custom;
 if(path.endsWith('/catalog'))return response({offers:APP_OFFERS,legalPolicy:APP_LEGAL_POLICY});
 if(path.endsWith('/health'))return response({status:'ready',paymentConfirmation:'configured'});
 if(path.endsWith('/session'))return response({email:'owner@example.test',operator:true});
 if(path.includes('/orders?'))return response({orders:[order('a')],next:null});
 if(path.endsWith('/events'))return response({events:[]});
 return response({order:order(path.split('/').at(-1))});
};}

test('JSON deadlines cover stalled bodies and never retry a write',async()=>{
 let calls=0;const c=vm.createContext({fetch:async()=>{calls++;return {ok:true,json:()=>new Promise(()=>{})};},AbortController,setTimeout,clearTimeout});
 vm.runInContext(source('http-client.js'),c);
 await assert.rejects(vm.runInContext("requestJson('/save',{method:'POST',timeoutMs:10})",c),{name:'TimeoutError'});assert.equal(calls,1);
});
test('the account link and separate ChatGPT CTA retain allowed service and anchor context after a 401',async()=>{
 for(const origin of ['https://personal-space-m7q9.skott34.chatgpt.site']){
  const h=harness('app',appFetch(path=>path.endsWith('/session')?response({error:'SIGN_IN_REQUIRED'},401):null),{href:origin+'/app?service=audit#service-work'});
  try{await settled();assert.equal(h.signInLinks.length,2);for(const link of h.signInLinks){const target=new URL(link.href,origin);assert.equal(target.searchParams.get('return_to'),'/app?service=audit_enterprise#service-work');assert.equal(target.origin,'https://personal-space-m7q9.skott34.chatgpt.site');}assert.equal(h.get('request-fields').disabled,true);}finally{h.close();}
 }
});

test('expired app session removes private records and ignores late responses',async()=>{
 let expired=false;const pending=deferred();let slow=false;
 const h=harness('app',appFetch(path=>expired&&path.includes('/orders?')?response({error:'SIGN_IN_REQUIRED'},401):slow&&path.endsWith('/a')?pending.promise:null));
 try{await settled();await h.subject.openOrder('a');assert.equal(h.get('detail-brief').textContent,'Private brief a');slow=true;const opening=h.subject.openOrder('a');expired=true;await assert.rejects(h.subject.loadOrders());pending.resolve(response({order:order('a')}));await opening.catch(()=>{});await settled();
  assert.equal(h.subject.session,null);assert.equal(h.subject.selected,null);assert.equal(h.get('detail-brief').textContent,'');assert.equal(h.get('orders-list').children.length,0);assert.equal(h.get('checkout-button').hidden,true);assert.equal(h.get('request-fields').disabled,true);
 }finally{h.close();}
});

test('newer selection and closing details invalidate slow app responses',async()=>{
 const pending=deferred();let slow=true;const h=harness('app',appFetch(path=>slow&&path.endsWith('/a')?pending.promise:null));
 try{await settled();const first=h.subject.openOrder('a');await h.subject.openOrder('b');pending.resolve(response({order:order('a')}));await first;assert.equal(h.subject.selected.id,'b');
  const second=deferred();slow=false;h.context.fetch=appFetch(path=>path.endsWith('/a')?second.promise:null);const late=h.subject.openOrder('a');await h.get('close-detail').fire('click');second.resolve(response({order:order('a')}));await late;assert.equal(h.subject.selected,null);assert.equal(h.get('order-detail').hidden,true);
 }finally{h.close();}
});

test('catalog failure keeps intake disabled even when authentication succeeds',async()=>{
 let posts=0;const h=harness('app',appFetch((path,options)=>{if(options.method==='POST')posts++;return path.endsWith('/catalog')?response({error:'SERVICE_UNAVAILABLE'},503):null;}));
 try{await settled();assert.ok(h.subject.session);assert.equal(h.get('request-fields').disabled,true);await h.get('request-form').fire('submit');assert.equal(posts,0);}finally{h.close();}
});
test('NUSD records retain scope-only controls when the catalog cannot load',async()=>{
 const record={...order('nusd'),service:'result_access',requestOnly:true,status:'scoped',payment:{status:'not_available',currency:'nusd',gross:null,refunded:null}};
 const h=harness('app',appFetch(path=>path.endsWith('/catalog')?response({error:'SERVICE_UNAVAILABLE'},503):path.endsWith('/nusd')?response({order:record}):null));
 try{await settled();await h.subject.openOrder('nusd');assert.match(h.get('detail-payment').textContent,/NUSD service/);assert.doesNotMatch(h.get('detail-payment').textContent,/\$0/);assert.equal(h.get('checkout-button').hidden,true);const actions=h.get('order-action').options.map(o=>o.value);assert.ok(!actions.includes('start'));assert.ok(actions.includes('cancel'));}finally{h.close();}
});

test('acknowledged save remains acknowledged when refresh fails and stale actions are cleared',async()=>{
 let fail=false;const h=harness('app',appFetch(path=>fail&&path.includes('/orders?')?response({error:'SERVICE_UNAVAILABLE'},503):null));
 try{await settled();await h.subject.openOrder('a');fail=true;await h.subject.savedView('a','Action saved.');assert.match(h.get('app-notice').textContent,/^Action saved\./);assert.equal(h.subject.selected,null);assert.equal(h.get('order-detail').hidden,true);assert.equal(h.get('checkout-button').hidden,true);}finally{h.close();}
});

test('browser restoration revalidates the app after aborting an in-flight boot',async()=>{
 const pending=deferred();let delay=true;const h=harness('app',appFetch(path=>delay&&path.endsWith('/catalog')?pending.promise:null));
 try{h.events.pagehide();delay=false;h.events.pageshow({persisted:true});pending.resolve(response({offers:APP_OFFERS,legalPolicy:APP_LEGAL_POLICY}));await settled();assert.ok(h.subject.session);assert.equal(h.get('request-fields').disabled,false);}finally{h.close();}
});

test('Control Room clears all private state when background owner authentication expires',async()=>{
 const h=harness('control',async path=>{
  if(path.endsWith('/health'))return response({status:'ready',revision:1,checks:{manifestIntegrity:true,evidenceHead:true}});
  if(path.endsWith('/treasury'))return response({error:'UNAUTHENTICATED'},401);
  return response({identity:'NUMINA',root:'NUMINA',manifest:'NUMINA',scope:'complete',revision:1,manifestHash:'a'.repeat(64),evidenceHead:'b'.repeat(64),content:{schema:1,requests:[],evidence:[],records:[],grants:[{id:'root',subject:'private-owner',resourcePrefix:'record:',scopes:['record.write']}]},decisions:[]});
 });
 try{await settled();assert.equal(h.subject.snapshot,null);assert.equal(h.get('workspace').hidden,true);assert.equal(h.get('grants').textContent,'');assert.equal(h.get('state-proof').textContent,'');assert.equal(h.get('signin').hidden,false);}finally{h.close();}
});

test('Control Room drops stale records and disables actions after refresh failure',async()=>{
 let failed=false;const h=harness('control',async path=>{
  if(failed)return response({error:'DEPENDENCY_UNAVAILABLE'},503);
  if(path.endsWith('/health'))return response({status:'ready',revision:1,checks:{manifestIntegrity:true,evidenceHead:true}});
  return response({identity:'NUMINA',root:'NUMINA',manifest:'NUMINA',scope:'authority-scoped',revision:1,manifestHash:'a'.repeat(64),evidenceHead:'b'.repeat(64),content:{schema:1,requests:[],evidence:[],records:[],grants:[]},decisions:[]});
 });
 try{await settled();assert.ok(h.subject.snapshot);failed=true;await assert.rejects(h.subject.refresh());assert.equal(h.subject.snapshot,null);assert.equal(h.get('workspace').hidden,true);assert.equal(h.get('reconcile').disabled,true);assert.equal(h.get('health').textContent,'Unavailable');}finally{h.close();}
});


test('scoped foreign orders keep checkout hidden while their scope history remains available',async()=>{
 const h=harness('app',appFetch(path=>path.endsWith('/foreign')?response({order:{...order('foreign'),country:'FR',status:'scoped'}}):null));
 try{await settled();await h.subject.openOrder('foreign');assert.equal(h.get('order-detail').hidden,false);assert.equal(h.get('checkout-button').hidden,true);assert.match(h.get('checkout-status').textContent,/Paid checkout remains unavailable pending country and activity approval/);}finally{h.close();}
});


test('Numina workspace consumes actual singular manifest and health handler responses',async()=>{
 const db=database(),owner='email:owner@example.test',now=Math.floor(Date.now()/1000);
 let h;
 try{
  await bootstrapControl(db,owner,now);
  await commitControl(db,{id:'browser-contract',expectedRevision:0,type:'request',data:{id:'actual-request',route:'internal.record.v1',wants:{resource:'record:ops/actual',payload:'Actual handler response'},requiredEvidence:[]}},owner,now);
  const env={DB:db,NUMINA_CONTROL_OWNER:owner,NUMINA_TELEMETRY_LOGS:'false'};
  const headers={'oai-authenticated-user-id':'browser-fixture','oai-authenticated-user-email':'owner@example.test'};
  const snapshots=new Map();
  for(const route of ['health','state']){const res=await worker.fetch(new Request('https://numina.test/api/control/v1/'+route,{headers}),env);assert.equal(res.status,200);snapshots.set(route,await res.json());}
  h=harness('control',async path=>snapshots.has(path.split('/').at(-1))?response(snapshots.get(path.split('/').at(-1))):response({error:'DEPENDENCY_UNAVAILABLE'},503));
  await settled();
  assert.equal(h.subject.snapshot.scope,'complete');assert.equal(h.get('workspace').hidden,false);assert.equal(h.get('integrity').textContent,'Checked');
  assert.match(h.get('grants').textContent,/owner@example.test/);assert.match(h.get('requests').textContent,/record:ops\/actual/);
  assert.match(h.get('state-proof').textContent,new RegExp(snapshots.get('state').manifestHash));
  assert.match(h.get('state-proof').textContent,/Manifest SHA-256/);
 }finally{h?.close();db.close();}
});


test('static Numina workspace entries reuse the session before reading private APIs',async()=>{
 for(const kind of ['app','control']){
  let calls=0;const href='https://numinalabs.xyz/'+(kind==='app'?'app?service=audit#service-work':'control#native-treasury-panel');
  const h=harness(kind,async()=>{calls++;throw Error('Must continue to the existing session first');},{href});
  try{await settled();assert.deepEqual(h.redirects,['https://personal-space-m7q9.skott34.chatgpt.site/'+(kind==='app'?'app?service=audit#service-work':'control#native-treasury-panel')]);assert.equal(calls,0);}finally{h.close();}
 }
});
