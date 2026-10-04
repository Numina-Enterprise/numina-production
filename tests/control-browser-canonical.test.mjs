import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../src/worker.js';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,commitControl,controlManifestView} from '../src/control-store.js';
import {controlHash} from '../src/control.js';
import {MemoryBucket} from './helpers/memory-bucket.mjs';
const owner='email:owner@example.test',delegate='email:delegate@example.test',key='canonical-control-browser-test-key',origin='https://numina.test';
const raw=(folder,name)=>readFileSync(new URL('../'+folder+'/'+name,import.meta.url),'utf8');
const source=(folder,name)=>raw(folder,name).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const built=(await import('../dist/server/index.js')).default;
async function settled(){for(let i=0;i<12;i++)await new Promise(resolve=>setTimeout(resolve,0));}
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.hidden=false;this.disabled=false;this._text='';this.value='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=[...nodes];}
 setAttribute(name,value){this[name]=String(value);}
 removeAttribute(name){delete this[name];}
 querySelector(selector){return this.children.find(node=>'#'+node.id===selector)||null;}
 reset(){}
}
function harness(folder,fetcher){
 const nodes=new Map(),events=new Map();
 for(const match of raw(folder,'control.html').matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)){const node=new Element(match[1]);node.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[2],node);}
 const get=id=>{assert.ok(nodes.has(id),'Unknown UI node '+id);return nodes.get(id);};
 const document={getElementById:get,createElement:tag=>new Element(tag),addEventListener:(name,fn)=>events.set(name,fn),dispatchEvent:event=>events.get(event.type)?.(event),querySelectorAll:()=>[...nodes.values()].filter(node=>node.tagName==='button')};
 const context=vm.createContext({document,window:{addEventListener:(name,fn)=>events.set(name,fn)},fetch:fetcher,Response,URL,AbortController,Intl,Date,crypto,setTimeout,clearTimeout,CustomEvent,clearNativeTreasury(){},async loadNativeTreasury(){},clearStripeTreasury(){},async loadStripeTreasury(){}});
 const receipt='const {clearControlReceipt,renderControlReceipt}=(()=>{'+source(folder,'control-receipts.js')+';return {clearControlReceipt,renderControlReceipt};})();';
 const documents='const {clearTreasuryDocuments,loadTreasuryDocuments}=(()=>{'+source(folder,'treasury-documents.js')+';return {clearTreasuryDocuments,loadTreasuryDocuments};})();';
 vm.runInContext(source(folder,'http-client.js')+'\n'+receipt+'\n'+documents+'\n'+source(folder,'control.js')+'\nglobalThis.subject={refresh,run,get snapshot(){return snapshot;}};',context);
 return {get,subject:context.subject,close(){events.get('pagehide')?.();}};
}
async function fixture(){
 const DB=database(),now=Math.floor(Date.now()/1000),BUCKET=new MemoryBucket(),env={DB,BUCKET,NUMINA_TELEMETRY_LOGS:'false',NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(key)};
 await bootstrapControl(DB,owner,now);
 await commitControl(DB,{id:'canonical-browser-request',expectedRevision:0,type:'request',data:{id:'fixture-request',route:'internal.record.v1',wants:{resource:'record:review/sample',payload:'Synthetic internal review'},requiredEvidence:[]}},owner,now);
 const pdf=new TextEncoder().encode('%PDF-1.4\nSYNTHETIC SUPPORTING FILE\n%%EOF');
 const uploaded=await worker.fetch(new Request(origin+'/api/control/v1/treasury-documents',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/pdf','X-Document-Name':'synthetic-support.pdf'},body:pdf}),env);
 assert.equal(uploaded.status,201);
 return {env,pdf,document:(await uploaded.json()).document,async scoped(){await commitControl(DB,{id:'canonical-browser-delegate',expectedRevision:1,type:'delegate',data:{id:'scope-only',parent:'root',subject:delegate,scopes:['record.write'],resourcePrefix:'record:',expiresAt:now+600}},owner,now);return controlManifestView(DB,delegate,now);},close(){DB.close();}};
}
function transport(f,{stateOverride=()=>undefined,authenticated=()=>true,calls=[],handler=worker}={}){
 return async(path,options={})=>{
  calls.push(path);
  if(path.endsWith('/state')){const override=stateOverride();if(override!==undefined)return Response.json(override);}
  return handler.fetch(new Request(new URL(path,origin),{...options,headers:{...options.headers,...(authenticated()?{Authorization:'Bearer '+key}:{})}}),f.env);
 };
}

for(const folder of ['public','dist/client'])test(folder+' Control Room reads the real canonical view and registered supporting documents',async()=>{
 const f=await fixture(),calls=[],handler=folder==='public'?worker:built,h=harness(folder,transport(f,{calls,handler}));
 try{
  await settled();assert.ok(h.subject.snapshot);assert.equal(h.subject.snapshot.scope,'complete');assert.equal(h.get('health').textContent,'Ready');assert.equal(h.get('integrity').textContent,'Checked');assert.equal(h.get('workspace').hidden,false);
  assert.match(h.get('requests').textContent,/record:review\/sample/);h.get('requests').children[0].onclick();assert.equal(h.get('attest-form').hidden,false);assert.equal(h.get('payload-detail').textContent,'Synthetic internal review');
  assert.equal(h.get('treasury-document-panel').hidden,false);assert.equal(h.get('document-summary').textContent,'1 supporting document received.');assert.match(h.get('document-list').textContent,/synthetic-support\.pdf/);
  const link=h.get('document-list').children[0].children[0];assert.equal(link.href,'/api/control/v1/treasury-documents/'+f.document.id);
  const authorized=await transport(f,{handler})(link.href);assert.equal(authorized.status,200);assert.deepEqual(new Uint8Array(await authorized.arrayBuffer()),f.pdf);
  assert.equal((await transport(f,{authenticated:()=>false,handler})(link.href)).status,401);assert.ok(calls.every(path=>!path.includes('commands')));
 }finally{h.close();f.close();}
});

test('canonical delegated scope cannot be promoted by a legacy projection field to load owner documents',async()=>{
 const f=await fixture(),scoped=await f.scoped(),calls=[],h=harness('public',transport(f,{stateOverride:()=>({...scoped,projection:'complete'}),calls}));
 try{await settled();assert.equal(h.subject.snapshot.projection,'authority-scoped');assert.equal(h.get('workspace').hidden,false);assert.equal(h.get('treasury-document-panel').hidden,true);assert.equal(calls.includes('/api/control/v1/treasury-documents'),false);}finally{h.close();f.close();}
});

test('malformed current control responses clear prior private state and owner documents',async()=>{
 const f=await fixture();let current;const calls=[],h=harness('public',transport(f,{stateOverride:()=>current,calls}));
 try{
  await settled();assert.equal(h.get('document-list').children.length,1);
  const canonical=await controlManifestView(f.env.DB,owner,Math.floor(Date.now()/1000));
  for(const corrupt of [value=>delete value.content,value=>value.content.requests=null,value=>value.scope='all',value=>value.identity='OTHER',value=>value.manifestHash=null,value=>value.decisions=[]]){
   current=structuredClone(canonical);corrupt(current);calls.length=0;
   await assert.rejects(h.subject.refresh(),/Current records could not be read/);
   assert.equal(h.subject.snapshot,null);assert.equal(h.get('workspace').hidden,true);assert.equal(h.get('reconcile').disabled,true);assert.equal(h.get('requests').textContent,'');assert.equal(h.get('document-list').textContent,'');assert.equal(h.get('treasury-document-panel').hidden,true);assert.equal(calls.includes('/api/control/v1/treasury-documents'),false);
  }
 }finally{h.close();f.close();}
});

test('owner authorization expiry clears actual document and control views',async()=>{
 const f=await fixture();let authenticated=true;const h=harness('public',transport(f,{authenticated:()=>authenticated}));
 try{await settled();assert.equal(h.get('document-list').children.length,1);authenticated=false;await assert.doesNotReject(h.subject.refresh());assert.equal(h.subject.snapshot,null);assert.equal(h.get('signin').hidden,false);assert.equal(h.get('document-list').textContent,'');assert.equal(h.get('treasury-document-panel').hidden,true);}finally{h.close();f.close();}
});
