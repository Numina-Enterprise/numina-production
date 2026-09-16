import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/treasury-adjustment-ui.js',import.meta.url),'utf8');
const root='treasury-test-owner';
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);}
function fixture(){
 const event={id:'treasury-adjust-original',expectedRevision:17,expectedHead:'a'.repeat(64),Principal:root,Authority:'NUMINA',Objective:'treasury.project',Intent:{operation:'ADJUST_PROJECTION',delta:'-1234567890123456789',reason:'Reconcile the reviewed native projection'}};
 const draft=freeze({event,beforeBalance:'900719925474099312345',afterBalance:'899485357583975855556',canonicalBody:JSON.stringify(event)});
 const receipt=freeze({status:'FINAL',route:'numina.treasury.v1',execution_scope:'Numina-native journal',replayed:false,head_advancement:{advanced:true,previous:event.expectedHead,head:'b'.repeat(64),revision:18},current_head:{head:'b'.repeat(64),revision:18},projection:{balance:draft.afterBalance,last_event_id:event.id},canonical_proof:{hash:'b'.repeat(64),event:{id:event.id,revision:18,command:event}},transaction_request:null,mint_event:null,bank_transaction:null});
 return {draft,receipt};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.handlers={};this.attributes={};}
 append(...nodes){this.children.push(...nodes);for(const node of nodes)if(node&&typeof node==='object')node.parent=this;}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,handler){this.handlers[name]=handler;}
 click(){return this.onclick?.()??this.handlers.click?.();}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
}
function harness({prepare,submit}={}){
 const {draft,receipt}=fixture(),calls={factory:0,prepare:[],submit:[]},downloads=[],revoked=[],events={};
 const client={prepare:input=>{calls.prepare.push(input);return prepare?prepare(input):Promise.resolve(draft);},submit:value=>{calls.submit.push(value);return submit?submit(value):Promise.resolve(receipt);}};
 const doc={body:new Element('body'),createElement:tag=>new Element(tag)};
 const win={addEventListener:(name,handler)=>(events[name]??=[]).push(handler)};
 const context=vm.createContext({Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test-'+downloads.length;},revokeObjectURL:value=>revoked.push(value)},setTimeout:()=>0,document:doc,window:win,createTreasuryAdjustment:()=>{throw Error('Unexpected real client');}});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.subject={mountTreasuryAdjustment};',context);
 function mount(options={}){
  const target=new Element('div');
  context.subject.mountTreasuryAdjustment(target,{root,doc,win,clientFactory:()=>{calls.factory++;return client;},...options});
  const all=()=>{const result=[];const visit=node=>{result.push(node);for(const child of node.children??[])if(child&&typeof child==='object')visit(child);};visit(target);return result;};
  const find=predicate=>{const value=all().find(predicate);assert.ok(value,'Expected rendered adjustment control');return value;};
  return {target,all,delta:find(node=>node.id==='native-adjustment-delta'),reason:find(node=>node.id==='native-adjustment-reason'),form:find(node=>node.tagName==='form'),review:find(node=>node.type==='submit'),commit:find(node=>node.id==='native-adjustment-commit'),edit:find(node=>node.textContent==='Edit unsubmitted adjustment'),download:find(node=>node.textContent==='Download adjustment record'),summary:find(node=>node.id==='native-adjustment-summary'),status:find(node=>node.id==='native-adjustment-status'),record:find(node=>node.id==='native-adjustment-record')};
 }
 return {mount,calls,draft,receipt,downloads,revoked,events};
}
async function review(view,delta='-1234567890123456789',reason='Reconcile the reviewed native projection'){
 view.delta.value=delta;view.reason.value=reason;
 let prevented=false;await view.form.onsubmit({preventDefault(){prevented=true;}});assert.equal(prevented,true);
}
const domSnapshot=view=>view.all().map(node=>({text:node.textContent,value:node.value,disabled:node.disabled,hidden:node.hidden}));

test('review reads once, displays exact large balances and the original event, and never submits',async()=>{
 const h=harness(),view=h.mount();
 await review(view,'  -1234567890123456789  ','  Reconcile the reviewed native projection  ');
 assert.equal(h.calls.prepare.length,1);
 assert.deepEqual(plain(h.calls.prepare[0]),{delta:h.draft.event.Intent.delta,reason:h.draft.event.Intent.reason});
 assert.equal(h.calls.submit.length,0);
 assert.match(view.summary.textContent,/900,719,925,474,099,312,345 NUSD → 899,485,357,583,975,855,556 NUSD/);
 assert.match(view.summary.textContent,/treasury-adjust-original.*expected revision 17/);
 assert.deepEqual(JSON.parse(view.record.textContent),{event:plain(h.draft.event),beforeBalance:h.draft.beforeBalance,afterBalance:h.draft.afterBalance,receipt:null});
 assert.equal(view.delta.disabled,true);assert.equal(view.reason.disabled,true);assert.equal(view.commit.disabled,false);
 await review(view,'7','replacement review');assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,0);
});

test('a pending commit blocks duplicate clicks and editing before any response arrives',async()=>{
 const pending=deferred(),h=harness({submit:()=>pending.promise}),view=h.mount();await review(view);
 const first=view.commit.click();assert.equal(h.calls.submit.length,1);assert.strictEqual(h.calls.submit[0],h.draft);
 assert.equal(view.commit.disabled,true);assert.equal(view.download.disabled,true);
 await view.commit.click();view.edit.click();await review(view,'10','changed during write');view.download.click();
 assert.equal(h.calls.submit.length,1);assert.equal(h.calls.prepare.length,1);assert.equal(h.downloads.length,0);
 pending.resolve(h.receipt);await first;
 assert.equal(view.commit.hidden,true);assert.equal(view.download.disabled,false);
 await view.commit.click();assert.equal(h.calls.submit.length,1);
});

test('an uncertain result survives remount and retries the identical frozen draft without rereading',async()=>{
 let attempts=0;const h=harness({submit:()=>++attempts===1?Promise.reject(Error('response lost')):Promise.resolve(h.receipt)});
 let active=true;const first=h.mount({isCurrent:()=>active});await review(first);await first.commit.click();
 assert.match(first.status.textContent,/Result not confirmed/);assert.equal(first.edit.hidden,true);
 const recordedBefore=first.record.textContent;first.edit.click();await review(first,'9','new event');
 assert.equal(first.record.textContent,recordedBefore);assert.equal(h.calls.prepare.length,1);
 active=false;const restored=h.mount();
 assert.equal(h.calls.factory,1);assert.equal(h.calls.prepare.length,1);
 assert.equal(restored.delta.value,h.draft.event.Intent.delta);assert.equal(restored.reason.value,h.draft.event.Intent.reason);
 assert.equal(restored.delta.disabled,true);assert.equal(restored.reason.disabled,true);assert.equal(restored.edit.hidden,true);
 assert.match(restored.commit.textContent,/Retry exact adjustment/);
 await first.commit.click();assert.equal(h.calls.submit.length,1);
 restored.delta.value='900';restored.reason.value='programmatic replacement';restored.edit.click();await review(restored,'900','programmatic replacement');
 await restored.commit.click();
 assert.equal(h.calls.submit.length,2);assert.strictEqual(h.calls.submit[0],h.calls.submit[1]);assert.strictEqual(h.calls.submit[1],h.draft);
 assert.equal(h.calls.prepare.length,1);assert.equal(restored.delta.value,h.draft.event.Intent.delta);
 assert.equal(restored.reason.value,h.draft.event.Intent.reason);assert.equal(restored.download.disabled,false);
 restored.download.click();const record=JSON.parse(await h.downloads[0].text());
 assert.equal(record.canonicalBody,h.draft.canonicalBody);assert.deepEqual(record.event,plain(h.draft.event));assert.deepEqual(record.receipt,plain(h.receipt));
});

test('an uncertain adjustment can be downloaded with its exact retry body and no invented receipt',async()=>{
 const h=harness({submit:()=>Promise.reject(Error('unverified response'))}),view=h.mount();await review(view);await view.commit.click();
 assert.equal(view.download.disabled,false);view.download.click();
 assert.deepEqual(JSON.parse(await h.downloads[0].text()),{schema:'numina.treasury.adjustment-record.v1',event:plain(h.draft.event),canonicalBody:h.draft.canonicalBody,beforeBalance:h.draft.beforeBalance,afterBalance:h.draft.afterBalance,receipt:null});
 const event={preventDefault(){this.prevented=true;}};for(const handler of h.events.beforeunload)handler(event);
 assert.equal(event.prevented,true);assert.equal(event.returnValue,'');
});

test('a stale mounted view cannot prepare, commit, edit, or download',async()=>{
 let current=true;const h=harness(),view=h.mount({isCurrent:()=>current});await review(view);
 current=false;const before=domSnapshot(view);await view.commit.click();view.edit.click();view.download.click();
 await view.form.onsubmit({preventDefault(){}});
 assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,0);assert.equal(h.downloads.length,0);
 assert.deepEqual(domSnapshot(view),before);
 const stale=h.mount({root:'another-owner',isCurrent:()=>false});await review(stale);
 assert.equal(h.calls.prepare.length,1);
});

for(const phase of ['prepare','submit'])for(const result of ['resolve','reject'])test(`late ${phase} ${result} cannot write into a stale view`,async()=>{
 const pending=deferred(),h=harness({[phase]:()=>pending.promise});let current=true,committed=0;
 const view=h.mount({isCurrent:()=>current,onCommitted:async()=>{committed++;}});
 let operation;if(phase==='prepare')operation=review(view);else{await review(view);operation=view.commit.click();}
 current=false;const before=domSnapshot(view);
 if(result==='resolve')pending.resolve(phase==='prepare'?h.draft:h.receipt);else pending.reject(Error('late failure'));
 await operation;assert.deepEqual(domSnapshot(view),before);assert.equal(committed,0);
});

for(const phase of ['prepare','submit'])test(`a remount during pending ${phase} receives the completion and unlocks current controls`,async()=>{
 const pending=deferred(),h=harness({[phase]:()=>pending.promise});let originalCurrent=true;
 const oldReceipts=[],currentReceipts=[];
 const original=h.mount({isCurrent:()=>originalCurrent,onCommitted:async receipt=>oldReceipts.push(receipt)});let operation;
 if(phase==='prepare')operation=review(original);else{await review(original);operation=original.commit.click();}
 originalCurrent=false;const current=h.mount({onCommitted:async receipt=>currentReceipts.push(receipt)}),oldDom=domSnapshot(original);
 assert.equal(current.review.disabled,true);
 pending.resolve(phase==='prepare'?h.draft:h.receipt);await operation;
 assert.deepEqual(domSnapshot(original),oldDom);assert.equal(h.calls.factory,1);
 assert.equal(current.delta.value,h.draft.event.Intent.delta);
 assert.equal(current.download.disabled,false);
 assert.equal(current.commit.hidden,phase==='submit');
 assert.equal(oldReceipts.length,0);
 if(phase==='prepare'){assert.equal(current.commit.disabled,false);assert.equal(currentReceipts.length,0);}
 else{assert.deepEqual(JSON.parse(current.record.textContent).receipt,plain(h.receipt));assert.equal(currentReceipts.length,1);assert.strictEqual(currentReceipts[0],h.receipt);}
});

test('an uncertain submit after remount unlocks only an exact retry in the current view',async()=>{
 const pending=deferred(),h=harness({submit:()=>pending.promise});let originalCurrent=true;
 const original=h.mount({isCurrent:()=>originalCurrent});await review(original);const operation=original.commit.click();
 originalCurrent=false;const current=h.mount(),oldDom=domSnapshot(original);
 pending.reject(Error('connection ended before receipt'));await operation;
 assert.deepEqual(domSnapshot(original),oldDom);assert.equal(current.commit.disabled,false);
 assert.match(current.commit.textContent,/Retry exact adjustment/);assert.match(current.status.textContent,/Result not confirmed/);
 assert.equal(current.delta.disabled,true);assert.equal(current.reason.disabled,true);assert.equal(current.edit.hidden,true);
 assert.equal(current.download.disabled,false);current.download.click();
 const record=JSON.parse(await h.downloads[0].text());assert.equal(record.canonicalBody,h.draft.canonicalBody);assert.equal(record.receipt,null);
 await current.commit.click();assert.equal(h.calls.submit.length,2);assert.strictEqual(h.calls.submit[0],h.calls.submit[1]);assert.equal(h.calls.prepare.length,1);
});

test('successful commit refresh remount preserves the verified receipt and enables its exact download',async()=>{
 const h=harness();let originalCurrent=true,refreshed,observed;
 const original=h.mount({isCurrent:()=>originalCurrent,onCommitted:async receipt=>{observed=receipt;originalCurrent=false;refreshed=h.mount();}});
 await review(original);await original.commit.click();
 assert.strictEqual(observed,h.receipt);assert.ok(refreshed);assert.equal(h.calls.factory,1);
 assert.equal(refreshed.download.disabled,false);assert.equal(refreshed.commit.hidden,true);assert.equal(refreshed.edit.hidden,true);
 assert.match(refreshed.status.textContent,/FINAL native record verified · revision 18/);assert.match(refreshed.status.textContent,/b{64}/);
 assert.deepEqual(JSON.parse(refreshed.record.textContent).receipt,plain(h.receipt));
 refreshed.download.click();assert.equal(h.downloads.length,1);
 assert.deepEqual(JSON.parse(await h.downloads[0].text()),{schema:'numina.treasury.adjustment-record.v1',event:plain(h.draft.event),canonicalBody:h.draft.canonicalBody,beforeBalance:h.draft.beforeBalance,afterBalance:h.draft.afterBalance,receipt:plain(h.receipt)});
 await refreshed.commit.click();assert.equal(h.calls.submit.length,1);
 const event={preventDefault(){this.prevented=true;}};for(const handler of h.events.beforeunload)handler(event);
 assert.equal(event.prevented,undefined);
});
