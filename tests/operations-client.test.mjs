import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {controlHash,stable} from '../src/control.js';
const modulePath=new URL('../public/operations-client.js',import.meta.url);
const factory=existsSync(modulePath)?(await import(modulePath)).createOperationsClient:null;
const snapshot={schema:'numina.operations-inbox.v1',revision:7,head:'a'.repeat(64),observedAt:1791172800,rooms:[],templates:[],sources:[],notices:[],counts:{total:0,overdue:0},limits:{notices:100,history:32},delivery:'not_configured'};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const failure=(code,status)=>Object.assign(Error(code),{code,status});
async function receipt(command){return {schema:'numina.provenance-receipt.v2',payload:{type:'frontier.operations_notice',eventId:command.id,commandHash:await controlHash({...command,type:'frontier.operations_notice'}),result:{recorded:true,delivery:'not_configured',noticeId:'n'}}};}
function harness(request){assert.equal(typeof factory,'function','Operations client is implemented');let state;const client=factory({request,onChange:value=>{state=value;}});return {client,get state(){return state;}};}
test('review freezes content and revision; repeated submit cannot create a second write',async()=>{
 const wait=defer(),calls=[];let h;h=harness(async(path,options)=>{calls.push({path,options});return options?.method==='POST'?wait.promise:structuredClone(snapshot);});
 await h.client.load();const data={operation:'open',noticeId:'n'};h.client.prepare(data);data.noticeId='changed';const submitted=h.client.save();await h.client.save();assert.equal(calls.filter(c=>c.options?.method==='POST').length,1);
 const command=JSON.parse(calls.at(-1).options.body);assert.equal(command.data.noticeId,'n');assert.equal(command.expectedRevision,7);wait.resolve({receipt:await receipt(command)});await submitted;assert.equal(h.state.status,'ready');assert.equal(h.state.pending,null);
});
test('ambiguous write reconciles by command ID and needs explicit review for identical retry',async()=>{
 const calls=[];const h=harness(async(path,options)=>{calls.push({path,options});if(options?.method==='POST')throw failure('REQUEST_TIMEOUT');if(path.includes('/receipts/'))throw failure('RECEIPT_NOT_FOUND',404);return structuredClone(snapshot);});
 await h.client.load();h.client.prepare({operation:'open',noticeId:'n'});await h.client.save();assert.equal(h.state.status,'retry_review');assert.equal(calls.filter(c=>c.options?.method==='POST').length,1);assert.ok(calls.some(c=>c.path.includes('/receipts/')));
 const original=calls.find(c=>c.options?.method==='POST').options.body;await h.client.save();assert.equal(calls.filter(c=>c.options?.method==='POST')[1].options.body,original);
});
test('committed-but-lost response is reconciled without resubmission; mismatched receipts stay blocked',async()=>{
 let command,writes=0;const h=harness(async(path,options)=>{if(options?.method==='POST'){writes++;command=JSON.parse(options.body);throw failure('REQUEST_TIMEOUT');}if(path.includes('/receipts/'))return receipt(command);return structuredClone(snapshot);});
 await h.client.load();h.client.prepare({operation:'open',noticeId:'n'});await h.client.save();assert.equal(writes,1);assert.equal(h.state.status,'ready');assert.equal(h.state.pending,null);
 const blocked=harness(async(path,options)=>{if(options?.method==='POST'){command=JSON.parse(options.body);return {receipt:{...(await receipt(command)),payload:{eventId:'wrong'}}};}if(path.includes('/receipts/'))throw failure('unavailable',503);return structuredClone(snapshot);});
 await blocked.client.load();blocked.client.prepare({operation:'open',noticeId:'n'});await blocked.client.save();assert.equal(blocked.state.status,'unknown');assert.throws(()=>blocked.client.prepare({operation:'open',noticeId:'other'}));
});
test('stale revision requires reload and new review; capacity errors are explicit',async()=>{
 for(const [code,status]of [['STALE_REVISION','stale'],['NOTICE_CAPACITY','capacity']]){
  const h=harness(async(path,options)=>{if(options?.method==='POST')throw failure(code,409);return structuredClone(snapshot);});await h.client.load();h.client.prepare({operation:'open',noticeId:'n'});await h.client.save();assert.equal(h.state.status,status);assert.equal(h.state.pending,null);assert.throws(()=>h.client.prepare({operation:'open',noticeId:'n'}));await h.client.load();assert.equal(h.state.status,'ready');
 }
});
test('access loss and navigation erase private state and ignore stale async responses',async()=>{
 const read=defer();const h=harness(()=>read.promise);const pending=h.client.load();h.client.clear();read.resolve(structuredClone(snapshot));await pending;assert.equal(h.state.view,null);assert.equal(h.state.pending,null);
 const auth=harness(async()=>{throw failure('OWNER_REQUIRED',403);});await auth.client.load();assert.equal(auth.state.status,'unauthorized');assert.equal(auth.state.view,null);
});
test('a newer load wins, and failed refresh removes stale private data',async()=>{
 const old=defer();let calls=0;const h=harness(()=>++calls===1?old.promise:Promise.resolve({...snapshot,revision:8}));const first=h.client.load();await h.client.load();old.resolve(snapshot);await first;assert.equal(h.state.view.revision,8);
 const failed=harness(async()=>{if(++calls>3)throw Error('Disconnected');return snapshot;});await failed.client.load();await failed.client.load();assert.equal(failed.state.view,null);assert.equal(failed.state.status,'error');
});
test('actual owner access rejection notifies the shared workspace once; external clears do not loop',async()=>{
 assert.equal(typeof factory,'function');let calls=0;
 const client=factory({request:async()=>{throw failure('OWNER_REQUIRED',403);},onAccessLost:()=>{calls++;client.clear();}});
 await client.load();assert.equal(calls,1);client.clear();assert.equal(calls,1);
});
