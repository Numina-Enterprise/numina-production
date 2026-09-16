import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/treasury-preparation-ui.js',import.meta.url),'utf8');
const root='treasury-preparation-owner',otherRoot='another-preparation-owner';
const plain=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
function freeze(value){for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);}
const mintInput=()=>({operation:'PREPARE_MINT',amount:'900719925474099312345',networkReference:'numina:962421430',destinationReference:'0x1a45671AE2ee3E52264116151924FAAcb80Fc02E',reason:'Prepare the owner-reviewed native mint request'});
const bankInput=()=>({operation:'PREPARE_BANK_TRANSACTION',amountMinor:'1234567890123456789',currency:'USD',destinationReference:'bank-designation-1',reason:'Prepare the owner-reviewed bank request'});
function fixture(Intent,owner=root,sequence=1){
 const event={id:'treasury-prepare-'+sequence,expectedRevision:138+sequence,expectedHead:sequence.toString(16).padStart(64,'a'),Principal:owner,Authority:'NUMINA',Objective:Intent.operation==='PREPARE_MINT'?'treasury.mint.prepare':'treasury.bank.prepare',Intent:plain(Intent)};
 const mint=Intent.operation==='PREPARE_MINT';
 const transactionRequest={id:event.id,kind:mint?'mint_request':'bank_transaction_request',status:'PREPARED',destination_reference:Intent.destinationReference,...(mint?{amount:Intent.amount,unit:'NUSD',network_reference:Intent.networkReference}:{amount_minor:Intent.amountMinor,currency:'USD'}),submission_performed:false,receipt:null};
 const draft=freeze({event,canonicalBody:canonical(event),beforeBalance:'1500000000000000',transactionRequest});
 const head=(sequence+1).toString(16).padStart(64,'b');
 const receipt=freeze({status:'FINAL',route:'numina.treasury.v1',execution_scope:'Numina-native journal',replayed:false,head_advancement:{advanced:true,previous:event.expectedHead,head,revision:event.expectedRevision+1},current_head:{head,revision:event.expectedRevision+1},projection:{balance:draft.beforeBalance,last_event_id:event.id,transaction_requests:[transactionRequest]},canonical_proof:{hash:head,event:{id:event.id,revision:event.expectedRevision+1,command:event}},transaction_request:transactionRequest,mint_event:null,bank_transaction:null});
 return {draft,receipt};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.handlers={};this.attributes={};}
 append(...nodes){this.children.push(...nodes);for(const child of nodes)if(child&&typeof child==='object'){child.parent=this;if(this.tagName==='select'&&this.value===''&&child.tagName==='option')this.value=child.value;}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,handler){this.handlers[name]=handler;}
 click(){return this.onclick?.()??this.handlers.click?.();}
 change(){return this.onchange?.({target:this})??this.handlers.change?.({target:this});}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
 get options(){return this.children.filter(child=>child.tagName==='option');}
 get selectedOptions(){return this.options.filter(option=>option.value===this.value);}
}
function makeWindow(){const events={};return {events,addEventListener:(name,handler)=>(events[name]??=[]).push(handler)};}
function harness({prepare,submit}={}){
 const calls={factory:0,prepare:[],submit:[],prepareOwners:[]},drafts=[],receipts=[],downloads=[],revoked=[];
 const doc={body:new Element('body'),createElement:tag=>new Element(tag)},win=makeWindow();
 const context=vm.createContext({Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:preparation-'+downloads.length;},revokeObjectURL:value=>revoked.push(value)},setTimeout:()=>0,document:doc,window:win,createTreasuryPreparation:()=>{throw Error('Unexpected real client');}});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.subject={mountTreasuryPreparation};',context);
 function mount(options={}){
  const target=new Element('div'),owner=options.root??root;
  const client={prepare:input=>{
   calls.prepare.push(plain(input));calls.prepareOwners.push(owner);
   const value=fixture(input,owner,calls.prepare.length);drafts.push(value.draft);receipts.push(value.receipt);
   return prepare?prepare(input,value.draft,value.receipt,owner):Promise.resolve(value.draft);
  },submit:draft=>{calls.submit.push(draft);const receipt=receipts[drafts.indexOf(draft)];return submit?submit(draft,receipt,owner):Promise.resolve(receipt);}};
  context.subject.mountTreasuryPreparation(target,{root,doc,win,clientFactory:()=>{calls.factory++;return client;},...options});
  const all=()=>{const result=[];const visit=node=>{result.push(node);for(const child of node.children??[])if(child&&typeof child==='object')visit(child);};visit(target);return result;};
  const find=predicate=>{const value=all().find(predicate);assert.ok(value,'Expected rendered preparation control');return value;};
  const byId=suffix=>find(node=>node.id==='native-preparation-'+suffix);
  return {target,all,operation:byId('operation'),amount:byId('amount'),network:byId('network'),account:byId('account'),destination:byId('destination'),reason:byId('reason'),review:byId('review'),commit:byId('commit'),edit:byId('edit'),new:byId('new'),download:byId('download'),summary:byId('summary'),status:byId('status'),record:byId('record'),form:find(node=>node.tagName==='form')};
 }
 return {mount,calls,drafts,receipts,downloads,revoked,events:win.events,win,doc};
}
function enter(view,input=mintInput(),account='custom'){
 view.operation.value=input.operation;view.operation.change();
 view.amount.value=input.amount??input.amountMinor??'';
 view.network.value=input.networkReference??'';
 view.account.value=account;view.account.change();
 if(account==='custom')view.destination.value=input.destinationReference??'';
 view.reason.value=input.reason??'';
}
async function review(view,input=mintInput(),account='custom'){
 enter(view,input,account);let prevented=false;await view.form.onsubmit({preventDefault(){prevented=true;}});assert.equal(prevented,true);
}
const snapshot=view=>view.all().map(node=>({text:node.textContent,value:node.value,disabled:node.disabled,hidden:node.hidden}));
function unload(win){const event={preventDefault(){this.prevented=true;}};for(const handler of win.events.beforeunload??[])handler(event);return event;}

test('large mint review preserves every exact field and unchanged native balance without submitting',async()=>{
 const h=harness(),view=h.mount(),input=mintInput();await review(view,{...input,amount:'  '+input.amount+'  ',reason:'  '+input.reason+'  '});
 assert.deepEqual(h.calls.prepare,[input]);assert.equal(h.calls.submit.length,0);
 assert.match(view.summary.textContent,/900,719,925,474,099,312,345/);assert.match(view.summary.textContent,/NUSD/);assert.match(view.summary.textContent,/1,500,000,000,000,000/);
 assert.match(view.summary.textContent,/treasury-prepare-1/);assert.match(view.summary.textContent,/139/);
 assert.equal(view.operation.disabled,true);assert.equal(view.amount.disabled,true);assert.equal(view.destination.disabled,true);assert.equal(view.reason.disabled,true);assert.equal(view.commit.disabled,false);
 const record=JSON.parse(view.record.textContent);assert.deepEqual(record.event,plain(h.drafts[0].event));assert.equal(record.beforeBalance,h.drafts[0].beforeBalance);
 await review(view,{...input,amount:'1',reason:'Changed review'});assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,0);
});
test('bank minor-unit amounts format exactly as USD and never acquire a mint network field',async()=>{
 const h=harness(),view=h.mount(),input=bankInput();await review(view,input);
 assert.deepEqual(h.calls.prepare,[input]);assert.equal(Object.hasOwn(h.calls.prepare[0],'networkReference'),false);assert.equal(Object.hasOwn(h.calls.prepare[0],'amount'),false);
 assert.match(view.summary.textContent,/12,345,678,901,234,567\.89/);assert.match(view.summary.textContent,/USD/);assert.equal(h.calls.submit.length,0);
});
test('bank selector exposes only active valid Bank of America designations and marks absent provider references',async()=>{
 const accounts=[{id:'bank-designation-1',provider:'bank-of-america',legalEntity:'SK Consulting LLC',accountLabel:'Numina Treasury Savings',providerAccountReference:null},{id:'bank-designation-2',provider:'bank-of-america',legalEntity:'SK Consulting LLC',accountLabel:'Recorded Provider Account',providerAccountReference:'provider:record-2'},{id:'stripe-designation',provider:'stripe',accountLabel:'Stripe'},{id:'superseded-bank',provider:'bank-of-america',supersededBy:'bank-designation-1'},{id:'invalid id',provider:'bank-of-america',accountLabel:'Invalid reference'}];
 const h=harness(),view=h.mount({accounts});
 assert.deepEqual(view.account.options.map(option=>option.value).sort(),['bank-designation-1','bank-designation-2','custom']);
 const designation=view.account.options.find(option=>option.value==='bank-designation-1');assert.match(designation.textContent,/Numina Treasury Savings/);assert.match(designation.textContent,/provider destination unverified/i);
 await review(view,bankInput(),'bank-designation-1');assert.equal(h.calls.prepare[0].destinationReference,'bank-designation-1');assert.equal(h.calls.prepare[0].currency,'USD');
});
test('strict operation, amount, reference and reason checks happen before reading the journal',async()=>{
 const invalid=[{operation:'ADJUST_PROJECTION'},{operation:'FINAL'},{amount:'0'},{amount:'-1'},{amount:'+1'},{amount:'01'},{amount:'1.0'},{amount:'1e9'},{amount:'9'.repeat(79)},{amount:''},{networkReference:''},{networkReference:'private key words'},{networkReference:'x'.repeat(129)},{destinationReference:''},{destinationReference:'invalid reference'},{destinationReference:'x'.repeat(129)},{reason:''},{reason:'   '},{reason:'embedded\nnewline'},{reason:'x'.repeat(1001)}];
 for(const change of invalid){const h=harness(),view=h.mount();await review(view,{...mintInput(),...change});assert.equal(h.calls.prepare.length,0,JSON.stringify(change));assert.equal(h.calls.submit.length,0);assert.equal(view.commit.hidden,true);}
 const h=harness(),view=h.mount();await review(view,bankInput(),'unrecognized-account');assert.equal(h.calls.prepare.length,0);
});
test('an invalid bank selector cannot silently reuse an older manual destination',async()=>{
 const h=harness(),view=h.mount();enter(view,bankInput());view.account.value='unrecognized-account';view.account.change();await view.form.onsubmit({preventDefault(){}});
 assert.equal(h.calls.prepare.length,0);assert.equal(h.calls.submit.length,0);assert.equal(view.commit.hidden,true);
});
test('bank cents remain exact for small amounts and decimal dollar notation is rejected',async()=>{
 {const h=harness(),view=h.mount();await review(view,{...bankInput(),amountMinor:'1'});assert.equal(h.calls.prepare[0].amountMinor,'1');assert.match(view.summary.textContent,/0\.01 USD/);}
 for(const amountMinor of ['0','0.01','100.00','1e5','-100','1,000']){const h=harness(),view=h.mount();await review(view,{...bankInput(),amountMinor});assert.equal(h.calls.prepare.length,0,amountMinor);}
});
test('only explicit New request after a verified FINAL allows a second fresh preparation',async()=>{
 const h=harness(),view=h.mount();await review(view);await view.commit.click();assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,1);assert.equal(view.new.hidden,false);assert.equal(view.commit.hidden,true);
 await review(view,bankInput());await view.commit.click();assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,1);
 view.new.click();assert.equal(view.review.disabled,false);assert.equal(view.commit.hidden,true);await review(view,bankInput());assert.equal(h.calls.prepare.length,2);assert.notEqual(h.drafts[1].event.id,h.drafts[0].event.id);assert.equal(h.drafts[1].event.expectedRevision,140);
 await view.commit.click();assert.equal(h.calls.submit.length,2);assert.strictEqual(h.calls.submit[1],h.drafts[1]);assert.match(view.status.textContent,/PREPARED/);
});
test('pending preparation and commit each reject duplicate clicks and form edits',async()=>{
 const waiting=deferred(),writing=deferred(),h=harness({prepare:()=>waiting.promise,submit:()=>writing.promise}),view=h.mount();
 const preparation=review(view);await view.form.onsubmit({preventDefault(){}});assert.equal(h.calls.prepare.length,1);assert.equal(view.review.disabled,true);
 waiting.resolve(h.drafts[0]);await preparation;const submission=view.commit.click();await view.commit.click();view.edit.click();view.new.click();view.download.click();await review(view,bankInput());
 assert.equal(h.calls.submit.length,1);assert.equal(h.calls.prepare.length,1);assert.equal(h.downloads.length,0);
 writing.resolve(h.receipts[0]);await submission;await view.commit.click();assert.equal(h.calls.submit.length,1);assert.equal(view.download.disabled,false);
});
test('uncertain submissions retain the exact event and canonical body across remount and immutable retry',async()=>{
 let attempts=0;const h=harness({submit:(_draft,receipt)=>++attempts===1?Promise.reject(Error('response lost')):Promise.resolve(receipt)}),first=h.mount();await review(first);await first.commit.click();
 assert.match(first.status.textContent,/not confirmed/i);assert.equal(first.edit.hidden,true);assert.equal(first.new.hidden,true);const recorded=first.record.textContent;
 first.edit.click();first.new.click();await review(first,bankInput());assert.equal(first.record.textContent,recorded);assert.equal(h.calls.prepare.length,1);
 const restored=h.mount();assert.equal(h.calls.factory,1);assert.equal(restored.amount.value,h.drafts[0].event.Intent.amount);assert.match(restored.commit.textContent,/Retry exact/i);
 await first.commit.click();assert.equal(h.calls.submit.length,1);enter(restored,bankInput());restored.edit.click();restored.new.click();await restored.commit.click();
 assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,2);assert.strictEqual(h.calls.submit[0],h.calls.submit[1]);assert.strictEqual(h.calls.submit[1],h.drafts[0]);assert.equal(restored.amount.value,h.drafts[0].event.Intent.amount);
});
test('switching owners hides old data and preserves its uncertain exact request when the owner returns',async()=>{
 const h=harness({submit:()=>Promise.reject(Error('uncertain'))}),first=h.mount();await review(first);await first.commit.click();const frozen=h.drafts[0],oldDOM=snapshot(first);
 const other=h.mount({root:otherRoot});assert.equal(other.record.textContent,'');assert.equal(h.calls.factory,2);assert.equal(other.commit.hidden,true);assert.equal(unload(h.win).prevented,true);
 await first.commit.click();first.edit.click();first.new.click();first.download.click();assert.equal(h.calls.submit.length,1);assert.equal(h.downloads.length,0);assert.deepEqual(snapshot(first),oldDOM);
 const restored=h.mount();assert.equal(h.calls.factory,2);assert.equal(restored.amount.value,frozen.event.Intent.amount);assert.equal(h.calls.prepare.length,1);await restored.commit.click();assert.strictEqual(h.calls.submit[1],frozen);assert.equal(h.calls.prepare.length,1);
});
test('download preserves the original canonical body and separate journal receipt with request still PREPARED',async()=>{
 const h=harness(),view=h.mount();await review(view);view.download.click();const pending=JSON.parse(await h.downloads[0].text());assert.equal(pending.schema,'numina.treasury.preparation-record.v1');assert.equal(pending.canonicalBody,h.drafts[0].canonicalBody);assert.deepEqual(pending.event,plain(h.drafts[0].event));assert.equal(pending.receipt,null);assert.equal(pending.transactionRequest.submission_performed,false);
 await view.commit.click();view.download.click();const saved=JSON.parse(await h.downloads[1].text());assert.equal(saved.canonicalBody,h.drafts[0].canonicalBody);assert.deepEqual(saved.event,plain(h.drafts[0].event));assert.equal(saved.beforeBalance,h.drafts[0].beforeBalance);
 assert.deepEqual(saved.transactionRequest,plain(h.drafts[0].transactionRequest));assert.equal(saved.transactionRequest.status,'PREPARED');assert.equal(saved.transactionRequest.submission_performed,false);assert.equal(saved.transactionRequest.receipt,null);
 assert.deepEqual(saved.receipt,plain(h.receipts[0]));assert.equal(saved.receipt.projection.balance,h.drafts[0].beforeBalance);assert.equal(saved.receipt.transaction_request.status,'PREPARED');assert.equal(saved.receipt.transaction_request.submission_performed,false);
});
test('unconfirmed submission download does not invent a provider receipt or lose its exact retry body',async()=>{
 const h=harness({submit:()=>Promise.reject(Error('unverified receipt'))}),view=h.mount();await review(view);await view.commit.click();view.download.click();const saved=JSON.parse(await h.downloads[0].text());
 assert.equal(saved.canonicalBody,h.drafts[0].canonicalBody);assert.equal(saved.receipt,null);assert.equal(saved.transactionRequest.submission_performed,false);assert.equal(saved.transactionRequest.receipt,null);assert.equal(unload(h.win).prevented,true);
});
test('one unload guard per window covers any uncertain owner session and clears after exact confirmation',async()=>{
 let attempts=0;const h=harness({submit:(_draft,receipt)=>++attempts===1?Promise.reject(Error('lost')):Promise.resolve(receipt)});
 const first=h.mount();h.mount();const active=h.mount();assert.equal(h.events.beforeunload.length,1);await review(active);await active.commit.click();assert.equal(unload(h.win).prevented,true);
 h.mount({root:otherRoot});assert.equal(h.events.beforeunload.length,1);assert.equal(unload(h.win).prevented,true);const restored=h.mount();await restored.commit.click();assert.equal(unload(h.win).prevented,undefined);assert.equal(h.events.beforeunload.length,1);await first.commit.click();assert.equal(h.calls.submit.length,2);
});
test('same owner in different windows has independent sessions and unload guards',async()=>{
 const h=harness({submit:()=>Promise.reject(Error('uncertain'))}),first=h.mount(),anotherWindow=makeWindow();await review(first);await first.commit.click();const other=h.mount({win:anotherWindow});
 assert.equal(h.calls.factory,2);assert.equal(other.record.textContent,'');assert.equal(unload(h.win).prevented,true);assert.equal(unload(anotherWindow).prevented,undefined);assert.equal(h.events.beforeunload.length,1);assert.equal(anotherWindow.events.beforeunload.length,1);
});
test('stale mounted controls cannot prepare, commit, clear or download and do not mutate detached DOM',async()=>{
 let current=true;const h=harness(),view=h.mount({isCurrent:()=>current});await review(view);current=false;const before=snapshot(view);
 await view.commit.click();view.edit.click();view.new.click();view.download.click();await view.form.onsubmit({preventDefault(){}});
 assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,0);assert.equal(h.downloads.length,0);assert.deepEqual(snapshot(view),before);
});
for(const phase of ['prepare','submit'])for(const result of ['resolve','reject'])test(`late ${phase} ${result} cannot repaint a stale view`,async()=>{
 const pending=deferred(),h=harness({[phase]:()=>pending.promise});let current=true,committed=0;const view=h.mount({isCurrent:()=>current,onCommitted:async()=>{committed++;}});
 let operation;if(phase==='prepare')operation=review(view);else{await review(view);operation=view.commit.click();}current=false;const before=snapshot(view);
 if(result==='resolve')pending.resolve(phase==='prepare'?h.drafts[0]:h.receipts[0]);else pending.reject(Error('late failure'));await operation;assert.deepEqual(snapshot(view),before);assert.equal(committed,0);
});
for(const phase of ['prepare','submit'])test(`pending ${phase} completion reaches only the latest mount for its owner`,async()=>{
 const pending=deferred(),h=harness({[phase]:()=>pending.promise}),oldReceipts=[],freshReceipts=[];
 const original=h.mount({onCommitted:async receipt=>oldReceipts.push(receipt)});let operation;if(phase==='prepare')operation=review(original);else{await review(original);operation=original.commit.click();}
 const fresh=h.mount({onCommitted:async receipt=>freshReceipts.push(receipt)}),oldDOM=snapshot(original);assert.equal(fresh.review.disabled,true);pending.resolve(phase==='prepare'?h.drafts[0]:h.receipts[0]);await operation;
 assert.equal(h.calls.factory,1);assert.deepEqual(snapshot(original),oldDOM);assert.equal(oldReceipts.length,0);assert.equal(fresh.amount.value,h.drafts[0].event.Intent.amount);assert.equal(fresh.download.disabled,false);assert.equal(fresh.commit.hidden,phase==='submit');assert.equal(freshReceipts.length,phase==='submit'?1:0);
});
for(const phase of ['prepare','submit'])for(const status of [401,403])for(const remount of [false,true])test(`${phase} ${status} invokes only the ${remount?'remounted':'current'} owner access-loss callback`,async()=>{
 const pending=deferred(),h=harness({[phase]:()=>pending.promise}),accessCalls=[];let generation=0,cleared;
 function protectedMount(label){const mounted=generation;let view;view=h.mount({isCurrent:()=>generation===mounted,onAccessLost:()=>{accessCalls.push(label);generation++;cleared=view.all().slice(1);view.target.replaceChildren();}});return view;}
 const original=protectedMount('original');let operation;if(phase==='prepare')operation=review(original);else{await review(original);operation=original.commit.click();}
 let active=original;if(remount){generation++;active=protectedMount('fresh');}const oldDOM=snapshot(original);pending.reject(Object.assign(Error('owner session expired'),{status}));await operation;
 assert.deepEqual(accessCalls,[remount?'fresh':'original']);assert.equal(active.target.children.length,0);const removedSnapshot=snapshot({all:()=>cleared});
 await active.commit.click();active.edit.click();active.new.click();active.download.click();await active.form.onsubmit({preventDefault(){}});
 assert.deepEqual(snapshot({all:()=>cleared}),removedSnapshot);assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,phase==='submit'?1:0);assert.equal(h.downloads.length,0);if(remount)assert.deepEqual(snapshot(original),oldDOM);
 const verified=protectedMount('verified-owner');assert.equal(h.calls.factory,1);if(phase==='submit'){assert.equal(verified.amount.value,h.drafts[0].event.Intent.amount);assert.equal(verified.edit.hidden,true);assert.equal(verified.new.hidden,true);assert.match(verified.commit.textContent,/Retry exact/i);}else assert.equal(verified.review.disabled,false);
});
test('ordinary service failures retain immutable retry without triggering access loss',async()=>{
 let lost=0;const h=harness({submit:()=>Promise.reject(Object.assign(Error('temporary failure'),{status:503}))}),view=h.mount({onAccessLost:()=>{lost++;}});await review(view);await view.commit.click();assert.equal(lost,0);assert.equal(view.edit.hidden,true);assert.equal(view.new.hidden,true);assert.equal(view.commit.disabled,false);assert.match(view.status.textContent,/not confirmed/i);
});
test('a post-commit refresh failure retains confirmed receipt and cannot cause another write',async()=>{
 let callbacks=0;const h=harness(),view=h.mount({onCommitted:async()=>{callbacks++;throw Error('owner view refresh failed');}});await review(view);await view.commit.click();
 assert.equal(callbacks,1);assert.equal(view.commit.hidden,true);assert.equal(view.new.hidden,false);assert.equal(view.download.disabled,false);assert.match(view.status.textContent,/FINAL journal record verified/);assert.match(view.status.textContent,/refreshing/i);assert.equal(unload(h.win).prevented,undefined);
 await view.commit.click();assert.equal(h.calls.submit.length,1);view.download.click();assert.deepEqual(JSON.parse(await h.downloads[0].text()).receipt,plain(h.receipts[0]));
 const restored=h.mount();assert.equal(restored.commit.hidden,true);assert.deepEqual(JSON.parse(restored.record.textContent).receipt,plain(h.receipts[0]));assert.equal(h.calls.factory,1);
});
test('refresh remount after a verified commit preserves its receipt without automatic submission',async()=>{
 const h=harness();let refreshed;const original=h.mount({onCommitted:async()=>{refreshed=h.mount();}});await review(original);await original.commit.click();
 assert.ok(refreshed);assert.equal(h.calls.factory,1);assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,1);assert.equal(refreshed.commit.hidden,true);assert.equal(refreshed.download.disabled,false);assert.deepEqual(JSON.parse(refreshed.record.textContent).receipt,plain(h.receipts[0]));
});
for(const phase of ['prepare','submit'])test(`switching owners during ${phase} never reveals its completion to the other owner`,async()=>{
 const pending=deferred(),h=harness({[phase]:()=>pending.promise}),committed=[];const original=h.mount({onCommitted:async()=>committed.push('original')});let operation;
 if(phase==='prepare')operation=review(original);else{await review(original);operation=original.commit.click();}
 const other=h.mount({root:otherRoot,onCommitted:async()=>committed.push('other')}),otherDOM=snapshot(other),oldDOM=snapshot(original);pending.resolve(phase==='prepare'?h.drafts[0]:h.receipts[0]);await operation;
 assert.deepEqual(snapshot(other),otherDOM);assert.deepEqual(snapshot(original),oldDOM);assert.deepEqual(committed,[]);assert.equal(other.record.textContent,'');
 const restored=h.mount();assert.equal(h.calls.factory,2);assert.equal(restored.amount.value,h.drafts[0].event.Intent.amount);assert.equal(h.calls.prepare.length,1);assert.equal(h.calls.submit.length,phase==='submit'?1:0);assert.equal(restored.commit.hidden,phase==='submit');
});
test('an access error from a hidden owner request does not clear another owner’s active view',async()=>{
 const pending=deferred(),h=harness({submit:()=>pending.promise}),access=[];const original=h.mount({onAccessLost:()=>access.push(root)});await review(original);const operation=original.commit.click();
 const other=h.mount({root:otherRoot,onAccessLost:()=>access.push(otherRoot)}),otherDOM=snapshot(other);pending.reject(Object.assign(Error('old owner access expired'),{status:401}));await operation;
 assert.deepEqual(access,[]);assert.deepEqual(snapshot(other),otherDOM);assert.equal(unload(h.win).prevented,true);const restored=h.mount();assert.equal(restored.edit.hidden,true);assert.equal(restored.new.hidden,true);assert.match(restored.commit.textContent,/Retry exact/i);
});
