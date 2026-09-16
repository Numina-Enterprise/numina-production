import test from 'node:test';
import assert from 'node:assert/strict';
import {mountOwnerDeployment} from '../public/wallet-execution-ui.js';
function harness(options={}){
 const nodes=new Map(),events=new Map(),calls=[],downloads=[],prepareInputs=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',checked:false,disabled:false,hidden:false});return nodes.get(id);};
 const doc={getElementById:id=>node(id.replace('execution-',''))},provider={request(){throw Error('Real RPC forbidden');},on(){},removeListener(){}};
 const win={ethereum:options.noProvider?null:provider,setTimeout:()=>1,clearTimeout(){},addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)};
 let change,resolveConnect,resolvePrepare;
 const state={status:'CONNECTED',candidate:null,transactionHash:null,attempted:false,busy:false,submissionAllowed:false};
 const candidate={from:'treasury',chainId:'962421430',nonce:'1',gasLimit:'100',gasPrice:'2',maximumFeeBaseUnits:'200',attemptId:'test',expiresAt:Date.now()+60000};
 const client={connect:async()=>{calls.push('connect');if(options.pending)await new Promise(r=>resolveConnect=r);if(options.connectError)throw options.connectError;change({...state});},prepare:async input=>{calls.push('prepare');prepareInputs.push(input);if(options.pendingPrepare)await new Promise(r=>resolvePrepare=r);if(options.prepareError)throw options.prepareError;state.candidate=candidate;state.status='REVIEW_READY';change({...state});return candidate;},submit:async()=>calls.push('submit'),adoptHash:async()=>calls.push('adopt'),checkReceipt:async()=>calls.push('receipt'),dispose:()=>calls.push('dispose')};
 const mounted=mountOwnerDeployment({doc,win,loadReview:options.loadReview|| (async()=>({})),clientFactory:({onChange})=>{calls.push('factory');change=onChange;return client;},download:v=>downloads.push(v)});
 return {node,calls,downloads,prepareInputs,mounted,events,state,candidate,options,change:v=>change(v),resolve:()=>resolveConnect?.(),resolvePrepare:()=>resolvePrepare?.()};
}
test('mount never connects automatically and requires an available provider',async()=>{
 const h=harness({noProvider:true});await h.mounted.ready;assert.deepEqual(h.calls,[]);assert.equal(h.node('connect').disabled,true);await h.node('connect').onclick();assert.deepEqual(h.calls,[]);h.mounted.dispose();
});
test('blocked production policy prevents programmatic submit even with a prepared acknowledged draft',async()=>{
 const h=harness();await h.mounted.ready;await h.node('connect').onclick();await h.node('prepare').onclick();h.node('acknowledge').checked=true;h.node('acknowledge').onchange();assert.equal(h.node('submit').disabled,true);await h.node('submit').onclick();assert.equal(h.calls.includes('submit'),false);assert.match(h.node('policy').textContent,/unsigned/);assert.match(h.node('details').textContent,/1500000000000000/);h.mounted.dispose();
});
test('duplicate clicks during connection and disposed late results do not act twice',async()=>{
 const h=harness({pending:true});await h.mounted.ready;const operation=h.node('connect').onclick();await h.node('connect').onclick();await h.node('prepare').onclick();assert.deepEqual(h.calls,['factory','connect']);h.mounted.dispose();h.resolve();await operation;assert.equal(h.node('connect').disabled,true);assert.equal(h.calls.filter(c=>c==='connect').length,1);
});
test('retained attempt exposes recovery and record download without permitting a new prepare',async()=>{
 const h=harness();await h.mounted.ready;await h.node('connect').onclick();h.change({...h.state,candidate:h.candidate,attempted:true,status:'OUTCOME_UNKNOWN'});assert.equal(h.node('prepare').disabled,true);await h.node('prepare').onclick();assert.equal(h.calls.includes('prepare'),false);h.node('hash').value='0x'+'1'.repeat(64);h.node('hash').oninput();assert.equal(h.node('recover').disabled,false);await h.node('recover').onclick();assert.equal(h.calls.includes('adopt'),true);h.node('download').onclick();assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].attempted,true);assert.equal(h.downloads[0].policy.submissionAllowed,false);h.mounted.dispose();
});
test('receipt results remain provider observations and late updates do not remount a disposed page',async()=>{
 const h=harness();await h.mounted.ready;await h.node('connect').onclick();const submitted={...h.state,candidate:h.candidate,attempted:true,status:'SUBMITTED',transactionHash:'0x'+'2'.repeat(64)};h.change(submitted);await h.node('receipt').onclick();assert.equal(h.calls.includes('receipt'),true);h.change({...submitted,status:'RECEIPT_VERIFIED',verification:{valid:true,fundsVerified:false}});assert.match(h.node('status').textContent,/does not verify reserves/);assert.match(h.node('result').textContent,/"fundsVerified": false/);h.mounted.dispose();const before=h.node('status').textContent;h.change({...submitted,status:'PENDING'});assert.equal(h.node('status').textContent,before);
});
test('page departure warns only about an uncertain retained attempt',async()=>{
 const h=harness();await h.mounted.ready;await h.node('connect').onclick();let warned=false;h.events.get('beforeunload')({preventDefault:()=>warned=true});assert.equal(warned,false);h.change({...h.state,candidate:h.candidate,attempted:true,status:'OUTCOME_UNKNOWN'});h.events.get('beforeunload')({preventDefault:()=>warned=true});assert.equal(warned,true);h.mounted.dispose();assert.equal(h.events.has('beforeunload'),false);
});

test('fee edits invalidate acknowledgement until a fresh prepare, including edits without an input event',async()=>{
 const h=harness();await h.mounted.ready;await h.node('connect').onclick();h.node('maximum').value='200';await h.node('prepare').onclick();assert.equal(h.node('acknowledge').disabled,false);h.node('acknowledge').checked=true;
 h.node('maximum').value='250';h.node('maximum').oninput();assert.equal(h.node('acknowledge').checked,false);assert.equal(h.node('acknowledge').disabled,true);assert.match(h.node('status').textContent,/Prepare and review/);
 await h.node('prepare').onclick();assert.equal(h.node('acknowledge').disabled,false);assert.deepEqual(h.prepareInputs,[{maximumFeeBaseUnits:'200'},{maximumFeeBaseUnits:'250'}]);
 h.node('maximum').value='300';h.node('acknowledge').checked=true;h.node('acknowledge').onchange();assert.equal(h.node('acknowledge').disabled,true);assert.equal(h.node('submit').disabled,true);await h.node('submit').onclick();assert.equal(h.calls.includes('submit'),false);h.mounted.dispose();
});

test('a fee edit while preparation is pending cannot be cleared by the older result',async()=>{
 const h=harness({pendingPrepare:true});await h.mounted.ready;await h.node('connect').onclick();h.node('maximum').value='200';const prepare=h.node('prepare').onclick();assert.equal(h.node('maximum').disabled,true);
 h.node('maximum').value='300';h.node('maximum').oninput();h.resolvePrepare();await prepare;
 assert.deepEqual(h.prepareInputs,[{maximumFeeBaseUnits:'200'}]);assert.equal(h.node('acknowledge').disabled,true);assert.equal(h.node('submit').disabled,true);assert.match(h.node('status').textContent,/changed while preparing/);h.mounted.dispose();
});

test('a failed refresh cannot revive approval for an older prepared draft',async()=>{
 const h=harness();await h.mounted.ready;await h.node('connect').onclick();await h.node('prepare').onclick();assert.equal(h.node('acknowledge').disabled,false);h.node('acknowledge').checked=true;
 h.options.prepareError=Object.assign(new Error('provider credentials must not appear'),{code:'UNEXPECTED_REMOTE_DETAIL'});await h.node('prepare').onclick();assert.equal(h.node('acknowledge').checked,false);assert.equal(h.node('acknowledge').disabled,true);assert.equal(h.node('submit').disabled,true);assert.doesNotMatch(h.node('status').textContent,/credentials|UNEXPECTED_REMOTE_DETAIL/);h.mounted.dispose();
});

test('pagehide disposes in-flight preparation and ignores its late result',async()=>{
 const h=harness({pendingPrepare:true});await h.mounted.ready;await h.node('connect').onclick();const prepare=h.node('prepare').onclick();const before=h.node('status').textContent;h.events.get('pagehide')();h.resolvePrepare();await prepare;
 assert.equal(h.calls.filter(c=>c==='dispose').length,1);assert.equal(h.node('status').textContent,before);assert.equal(h.node('details').hidden,true);for(const button of ['connect','prepare','submit','recover','receipt','download'])assert.equal(h.node(button).disabled,true);await h.node('connect').onclick();assert.equal(h.calls.filter(c=>c==='connect').length,1);
});

test('late review loading cannot reactivate a disposed page',async()=>{
 let resolve;const h=harness({loadReview:()=>new Promise(r=>resolve=r)});h.mounted.dispose();const before=h.node('status').textContent;resolve({});await h.mounted.ready;
 assert.equal(h.node('status').textContent,before);assert.equal(h.node('connect').disabled,true);assert.deepEqual(h.calls,[]);
});

test('authentication failures explain owner sign-in without displaying server details or credentials',async()=>{
 for(const status of [401,403]){
  const h=harness({connectError:Object.assign(new Error('Bearer secret-fixture-value https://private.example.test'),{status,code:'REMOTE_SECRET_FIXTURE'})});await h.mounted.ready;await h.node('connect').onclick();assert.match(h.node('status').textContent,/Sign in to the Numina owner account/);assert.doesNotMatch(h.node('status').textContent,/Bearer|secret-fixture|private\.example|REMOTE_SECRET/);assert.equal(h.calls.includes('submit'),false);h.mounted.dispose();
 }
});

test('departure warns when a known transaction hash still needs durable saving',async()=>{
 const h=harness();await h.mounted.ready;await h.node('connect').onclick();const state={...h.state,candidate:h.candidate,attempted:true,status:'SUBMITTED',transactionHash:'0x'+'3'.repeat(64)};
 const warned=()=>{let value=false;h.events.get('beforeunload')({preventDefault:()=>value=true});return value;};
 h.change({...state,error:'HASH_NOT_SAVED',hashSaved:false});assert.equal(warned(),true);h.change({...state,busy:true,hashSaved:true});assert.equal(warned(),true);h.change({...state,error:null,busy:false,hashSaved:false});assert.equal(warned(),true);assert.match(h.node('status').textContent,/hash has not been confirmed saved/);h.change({...state,error:null,busy:false,hashSaved:true});assert.equal(warned(),false);h.mounted.dispose();
});
