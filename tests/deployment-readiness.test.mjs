import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {assessInputs,createLocalDraft,importLocalDraft,createConstructorRequest,validateReadinessSource} from '../public/deployment-readiness-model.js';
import {NUSD_SIMULATION,NUSD_APPROVED_REVIEW} from '../src/nusd-http.js';
const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const seed=JSON.parse(source('deployment-readiness-inputs.json'));
const pinnedSeed=await validateReadinessSource(seed,NUSD_SIMULATION);
const recipient='0x1111111111111111111111111111111111111111';
test('public input sheets remain pinned to the published review with every requirement unresolved',async()=>{
 assert.deepEqual(await validateReadinessSource(seed,NUSD_SIMULATION),seed);
 assert.equal(seed.requirements.items.length,36);
 assert.equal(seed.request.preparationPolicy.sha256,NUSD_APPROVED_REVIEW.policy.sha256);
 const bytes=readFileSync(new URL('../docs/Numina-500T-Preparation-Tools.zip',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),seed.package.sha256);
 for(const change of [{schema:'other'},{request:{...seed.request,encoded:true}},{package:{...seed.package,sha256:'0'.repeat(64)}}])await assert.rejects(validateReadinessSource({...seed,...change},NUSD_SIMULATION));
});
test('inputs retain exact integers and reject zero addresses, excess values and numeric coercion',()=>{
 const state=assessInputs({recipient,sender:'0x'+'0'.repeat(40),nonce:'0',maximumFee:'900719925474099312345',chainId:962421430});
 assert.equal(state.values.maximumFee,'900719925474099312345');assert.equal(state.values.nonce,'0');assert.equal(state.values.sender,null);assert.equal(state.values.chainId,null);
 for(const value of ['1e18','-1','1.5','01',(2n**256n).toString()])assert.equal(assessInputs({maximumFee:value}).values.maximumFee,null);
 assert.equal(state.productionReady,false);
});
test('recipient export preserves policy, four roles and amount without changing the template',()=>{
 const before=structuredClone(seed),request=createConstructorRequest(pinnedSeed,{recipient,sender:recipient,maximumFee:'1'});
 assert.equal(request.constructor[1].value,recipient);
 assert.deepEqual(request.constructor.filter((_,i)=>i!==1),seed.request.constructor.filter((_,i)=>i!==1));
 assert.deepEqual(request.walletTransaction,seed.request.walletTransaction);
 assert.equal(request.submissionApproved,false);assert.equal(request.network.identityVerified,false);
 assert.equal(request.receipt,null);assert.equal(request.signed,false);assert.equal(request.broadcast,false);
 assert.deepEqual(seed,before);assert.throws(()=>createConstructorRequest(pinnedSeed,{}));
});
test('draft import ignores injected approvals and secret-like extra fields and strips invalid values',()=>{
 const draft=createLocalDraft({recipient,maximumFee:'5'});
 const modified={...draft,productionReady:true,signed:true,receipt:{status:'success'},privateKey:'SYNTHETIC_SECRET',inputs:{...draft.inputs,sender:'SYNTHETIC_SECRET',extra:'SYNTHETIC_SECRET'}};
 const restored=importLocalDraft(JSON.stringify(modified));
 assert.equal(restored.productionReady,false);assert.equal(restored.signed,false);assert.equal(restored.receipt,null);assert.equal(restored.walletTransaction,null);
 assert.equal(restored.inputs.sender,null);assert.ok(!JSON.stringify(restored).includes('SYNTHETIC_SECRET'));
 assert.throws(()=>importLocalDraft(JSON.stringify({...draft,packageSha256:'wrong'})));assert.throws(()=>importLocalDraft('x'.repeat(32769)));
});
class Element{constructor(){this.children=[];this.value='';this.disabled=false;this.textContent='';this.handlers={};this.attributes={};}append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}setAttribute(name,value){this.attributes[name]=value;}addEventListener(name,fn){this.handlers[name]=fn;}}
function harness(override,preparation={}){
 const nodes=new Map(),events={},calls=[];
 const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const responses={'/deployment-readiness-inputs.json':seed,'/api/nusd/v1/simulation':NUSD_SIMULATION,'/api/nusd/v1/approved-review':NUSD_APPROVED_REVIEW};
 const context=vm.createContext({document:{getElementById:get,createElement:()=>new Element()},window:{addEventListener:(name,handler)=>events[name]=handler},fetch:async(path,options)=>{calls.push({path,options});return override?.(path,options)??Response.json(responses[path]);},Response,AbortController,setTimeout,clearTimeout,structuredClone,Blob,URL,console,crypto,TextEncoder,mountLocalWallet:()=>({setAvailable(){}}),loadPreparationAssets:preparation.load||(()=>Promise.resolve({})),prepareDeployment:preparation.prepare||(()=>Promise.resolve({review:{status:'UNSIGNED_CONSTRUCTOR_REVIEW',constructor:{initialRecipient:recipient},constructorData:'0x1234'},transactionDraft:null,missingTransactionInputs:['sender']}))});
 vm.runInContext(source('http-client.js').replace(/^export /gm,'')+'\n'+source('deployment-readiness-model.js').replace(/^export /gm,'')+'\n'+source('deployment-readiness-ui.js').replace(/^import .*;\n/gm,'')+'\nglobalThis.subject={refresh,renderInputs};',context);
 return {get,calls,events,subject:context.subject};
}
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));};
test('website works signed out using only three credential-free GETs and keeps requirements pending',async()=>{
 const h=harness();await settle();
 assert.equal(h.calls.length,3);for(const {options} of h.calls){assert.equal(options.credentials,'omit');assert.equal(options.method,undefined);assert.equal(options.redirect,'error');}
 assert.equal(h.get('readiness-fields').disabled,false);assert.equal(h.get('export-request').disabled,true);
 h.get('recipient').value=recipient;h.subject.renderInputs();assert.equal(h.get('export-request').disabled,false);
 assert.equal(h.get('requirements-count').textContent,'36 package requirements pending');assert.match(h.get('draft-progress').textContent,/none verified/);assert.equal(h.calls.length,3);
 h.events.pagehide();assert.equal(h.get('recipient').value,'');
});
test('failed refresh disables draft exports while preserving local inputs',async()=>{
 let fail=false;const h=harness(()=>fail?Promise.reject(Error('offline')):null);await settle();h.get('recipient').value=recipient;h.subject.renderInputs();fail=true;await h.subject.refresh();
 assert.equal(h.get('export-request').disabled,true);assert.equal(h.get('export-draft').disabled,true);assert.equal(h.get('recipient').value,recipient);assert.match(h.get('readiness-source-status').textContent,/could not be confirmed/);
});
test('late responses after page exit cannot re-enable or repopulate the workspace',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve);const h=harness(path=>path==='/deployment-readiness-inputs.json'?wait:null);h.events.pagehide();release(Response.json(seed));await settle();
 assert.equal(h.get('readiness-fields').disabled,true);assert.equal(h.get('export-request').disabled,true);assert.equal(h.get('readiness-requirements').children.length,0);
});
test('tampered roles, nested approval and transaction data fail the pinned template digest',async()=>{
 const changed=structuredClone(seed);changed.request.constructor[2].value=recipient;changed.request.preparationPolicy.executionAuthorization=true;changed.request.walletTransaction.data='0xdeadbeef';
 await assert.rejects(validateReadinessSource(changed,NUSD_SIMULATION),/differ/);
 assert.throws(()=>createConstructorRequest(changed,{recipient}),/Confirm/);
 assert.throws(()=>{pinnedSeed.request.constructor[2].value=recipient;},TypeError);
});
test('export preserves address case for the offline checksum validator',()=>{
 const mixed='0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
 assert.equal(createConstructorRequest(pinnedSeed,{recipient:mixed}).constructor[1].value,mixed);
});
test('mutating caller input during hashing cannot change the trusted template',async()=>{
 const candidate=structuredClone(seed),pending=validateReadinessSource(candidate,NUSD_SIMULATION);
 candidate.request.constructor[2].value=recipient;candidate.request.walletTransaction.data='0xdeadbeef';
 const trusted=await pending,request=createConstructorRequest(trusted,{recipient});
 assert.equal(request.constructor[2].value,seed.request.constructor[2].value);assert.equal(request.walletTransaction.data,null);
});
test('clear and later typing invalidate slow draft imports',async()=>{
 for(const edit of ['clear','input']){
  const h=harness();await settle();let release;const pending=new Promise(resolve=>release=resolve);
  h.get('draft-file').files=[{size:100,text:()=>pending}];const importing=h.get('draft-file').handlers.change();
  if(edit==='clear')h.get('clear-draft').handlers.click();else{h.get('recipient').value='0x2222222222222222222222222222222222222222';h.get('readiness-form').handlers.input();}
  release(JSON.stringify(createLocalDraft({recipient})));await importing;
  assert.equal(h.get('recipient').value,edit==='clear'?'':'0x2222222222222222222222222222222222222222');
 }
});
test('edits and navigation invalidate both successful and failed delayed preparation',async()=>{
 for(const event of ['input','clear','preset','refresh','pagehide'])for(const failure of [false,true]){
  let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const h=harness(undefined,{prepare:()=>pending});await settle();h.get('recipient').value=recipient;h.subject.renderInputs();
  const work=h.get('prepare-deployment').handlers.click();await settle();
  if(event==='input')h.get('readiness-form').handlers.input();
  if(event==='clear')h.get('clear-draft').handlers.click();
  if(event==='preset')h.get('use-treasury-recipient').handlers.click();
  if(event==='refresh')await h.subject.refresh();
  if(event==='pagehide')h.events.pagehide();
  if(failure)reject(Error('late failure'));else resolve({review:{status:'UNSIGNED_CONSTRUCTOR_REVIEW',constructor:{initialRecipient:recipient},constructorData:'0x1234'},transactionDraft:null,missingTransactionInputs:['sender']});
  await work;assert.equal(h.get('download-preparation').disabled,true);assert.equal(h.get('preparation-summary').textContent,'No encoded request prepared for the current inputs.');
 }
});
test('preparation becomes downloadable only for current inputs, then an edit clears it',async()=>{
 const h=harness();await settle();h.get('recipient').value=recipient;h.subject.renderInputs();await h.get('prepare-deployment').handlers.click();
 assert.equal(h.get('download-preparation').disabled,false);assert.match(h.get('preparation-summary').textContent,/Constructor encoded/);
 h.get('readiness-form').handlers.input();assert.equal(h.get('download-preparation').disabled,true);
});
