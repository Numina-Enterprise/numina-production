import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
const path=new URL('../public/operations-ui.js',import.meta.url);
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.value='';this.checked=false;this._text='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent??c).join(' ');}
 setAttribute(key,value){this[key]=value;}
 addEventListener(event,fn){this.handlers[event]=fn;}
 focus(){this.focused=true;}
}
function elements(node){return [node,...node.children.flatMap(elements)];}
function harness(){
 assert.ok(existsSync(path),'Operations UI is implemented');const target=new Element('section'),events={},prepared=[];let changed;
 const client={load(){},prepare(data){prepared.push(data);},clear(){},dismiss(){},save(){},reconcile(){}};
 const context=vm.createContext({document:{createElement:tag=>new Element(tag),getElementById:()=>null,addEventListener:(key,fn)=>events[key]=fn},window:{addEventListener:(key,fn)=>events[key]=fn},createOperationsClient:options=>{changed=options.onChange;return client;},Date,JSON,crypto,encodeURIComponent,structuredClone});
 vm.runInContext(readFileSync(path,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.mount=mountOperationsInbox;',context);context.mount(target);return {target,events,prepared,render:state=>changed(state)};
}
const view={revision:4,head:'a'.repeat(64),observedAt:1791172800,delivery:'not_configured',rooms:[{id:'engineering',name:'Engineering'}],templates:[{id:'engineering',name:'Build review',version:1,roomId:'engineering'}],sources:[{id:'control-api',name:'Control API'}],limits:{notices:100,history:32,canonicalBytes:1500000},counts:{total:0,overdue:0,states:{draft:0},severities:{routine:0},rooms:{engineering:0}},notices:[]};
test('owner form has explicit labels, bounded fields, room routing labels and review-only submission',()=>{
 const h=harness();h.render({status:'ready',view,pending:null,message:'No notices recorded yet.'});const all=elements(h.target),form=all.find(n=>n.tagName==='form');assert.ok(form);assert.ok(all.some(n=>n.tagName==='label'&&n.textContent.includes('Title')));assert.ok(all.some(n=>n.tagName==='fieldset'));assert.match(h.target.textContent,/External delivery is not configured/);assert.match(h.target.textContent,/routing labels/);assert.ok(all.some(n=>n.name==='title'&&n.maxLength===120));
});
test('record and history markup is rendered as inert text; terminal records have no mutation actions',()=>{
 const h=harness(),malicious='<img src=x onerror=alert(1)>';
 h.render({status:'ready',view:{...view,notices:[{id:'n',title:malicious,body:malicious,roomIds:['engineering'],state:'resolved',severity:'critical',dueStatus:'none',dueAt:null,source:{type:'owner_observation',reference:'fixture:test',observedAt:1791172800},createdBy:'owner',createdAt:1791172800,updatedAt:1791172800,history:[{eventId:'event',actor:'owner',at:1791172800,operation:'resolve',state:'resolved',data:{reason:malicious}}]}]},pending:null,message:'Loaded'});
 assert.match(h.target.textContent,/<img/);assert.ok(!elements(h.target).some(n=>n.tagName==='img'));assert.ok(!elements(h.target).some(n=>n.tagName==='button'&&['Acknowledge','Resolve','Cancel notice'].includes(n.textContent)));
});
test('unknown and unauthorized states reveal no stale record content or write controls',()=>{
 const h=harness();h.render({status:'unknown',view:null,pending:{command:{id:'command',expectedRevision:4,data:{operation:'open',noticeId:'n'}},submitted:true},message:'Write outcome unknown'});assert.ok(elements(h.target).some(n=>n.tagName==='button'&&n.textContent.includes('Check command')));assert.ok(!elements(h.target).some(n=>n.tagName==='form'));
 h.render({status:'unauthorized',view:null,pending:null,message:'Owner sign-in is required'});assert.ok(!elements(h.target).some(n=>n.tagName==='form'));assert.match(h.target.textContent,/Sign in/);
});
test('review moves keyboard focus to its heading and dismissal announces the return',()=>{
 const h=harness();h.render({status:'ready',view,pending:null,message:'Loaded'});
 h.render({status:'review',view,pending:{command:{id:'command',expectedRevision:4,data:{operation:'open',noticeId:'n'}},submitted:false},message:'Review'});
 assert.ok(elements(h.target).some(n=>n.tagName==='h3'&&n.textContent==='Review private record'&&n.focused));
 h.render({status:'ready',view,pending:null,message:'Review cancelled'});assert.ok(elements(h.target).some(n=>n.role==='status'&&n.focused));
});
test('resolved and cancelled blocked responses do not appear in follow-ups needing review',()=>{
 const h=harness();const record={id:'n',title:'Closed blocked fixture',body:'Synthetic',roomIds:['engineering'],state:'resolved',severity:'routine',dueStatus:'none',dueAt:null,source:{type:'owner_observation',reference:'fixture:test',observedAt:1791172800},createdBy:'owner',createdAt:1791172800,updatedAt:1791172800,response:{choice:'blocked',note:'Prior blocker'},history:[]};
 for(const state of ['resolved','cancelled']){h.render({status:'ready',view:{...view,notices:[{...record,state}]},pending:null,message:'Loaded'});assert.ok(!h.target.textContent.includes('Follow-ups needing review'));}
});
test('retry review offers another receipt check without starting a new write',()=>{
 const h=harness();h.render({status:'retry_review',view,pending:{command:{id:'command',expectedRevision:4,data:{operation:'open',noticeId:'n'}},submitted:true},message:'Review retry'});
 assert.ok(elements(h.target).some(n=>n.tagName==='button'&&n.textContent.includes('Check command')));
});
test('save and reconciliation preserve keyboard return focus across an intervening reload',()=>{
 const h=harness(),pending={command:{id:'command',expectedRevision:4,data:{operation:'open',noticeId:'n'}},submitted:true};
 h.render({status:'review',view,pending,message:'Review'});h.render({status:'saving',view,pending,message:'Recording'});h.render({status:'loading',view:null,pending:null,message:'Loading'});h.render({status:'ready',view,pending:null,message:'Recorded'});
 assert.ok(elements(h.target).some(n=>n.role==='status'&&n.focused));
});
