import test from 'node:test';
import assert from 'node:assert/strict';
import {initialControlManifest,reduceControl} from '../src/control.js';
import {ROOM_DEFINITIONS} from '../src/numina-tree.js';
const now=1791172800,owner='email:owner@example.test';
const notice=(overrides={})=>({id:'notice-1',roomIds:['engineering'],templateId:'engineering',templateVersion:1,title:'Synthetic build review',body:'Review isolated fixture evidence.',severity:'important',dueAt:now+3600,source:{type:'owner_observation',reference:'fixture:build-review',observedAt:now},...overrides});
const command=(data,id='event-1',revision=0)=>({id,expectedRevision:revision,type:'frontier.operations_notice',data});
async function apply(state,data,id='event-1',revision=0,actor=owner,time=now){return reduceControl(state,command(data,id,revision),actor,revision,time);}
async function created(overrides={}){return (await apply(initialControlManifest(owner,now),{operation:'create',notice:notice(overrides)})).manifest;}
test('private notices use all canonical room labels without changing treasury, authority or other state',async()=>{
 const state=initialControlManifest(owner,now);state.nativeTreasury={balance:'7',requests:[]};state.frontier={principals:[],policies:[],requests:[],approvals:[],accounts:[],roomTasks:[]};
 const before=structuredClone(state);const result=await apply(state,{operation:'create',notice:notice({roomIds:ROOM_DEFINITIONS.map(r=>r.id)})});
 assert.deepEqual(state,before);const {operationsInbox,...rest}=result.manifest.frontier;assert.deepEqual(rest,before.frontier);assert.deepEqual(result.manifest.nativeTreasury,before.nativeTreasury);assert.deepEqual(result.manifest.grants,before.grants);
 assert.equal(operationsInbox.notices.length,1);assert.equal(operationsInbox.notices[0].state,'draft');assert.equal(operationsInbox.notices[0].createdBy,owner);assert.equal(operationsInbox.notices[0].history[0].eventId,'event-1');assert.equal(result.result.delivery,'not_configured');
});
test('owner lifecycle records draft revisions, responses, follow-ups and terminal history',async()=>{
 let state=await created();const run=async(data,id,time=now)=>{const before=structuredClone(state);const result=await apply(state,data,id,0,owner,time);state=result.manifest;const withoutInbox=value=>{const copy=structuredClone(value);if(copy.frontier)delete copy.frontier.operationsInbox;return copy;};assert.deepEqual(withoutInbox(state),withoutInbox(before));return state.frontier.operationsInbox.notices[0];};
 let record=await run({operation:'edit',notice:notice({title:'Edited review'})},'edit');assert.equal(record.history[0].data.notice.title,'Synthetic build review');
 record=await run({operation:'open',noticeId:'notice-1'},'open');assert.equal(record.state,'open');
 record=await run({operation:'acknowledge',noticeId:'notice-1'},'ack');assert.equal(record.acknowledgment.actor,owner);
 record=await run({operation:'respond',noticeId:'notice-1',choice:'blocked',note:'Awaiting fixture'},'response');assert.equal(record.response.choice,'blocked');assert.equal(record.response.verification,'owner_recorded');
 record=await run({operation:'followup',noticeId:'notice-1',note:'Review after fixture arrives',dueAt:now+7200},'followup');assert.equal(record.dueAt,now+7200);
 record=await run({operation:'resolve',noticeId:'notice-1',reason:'Fixture checked'},'resolve');assert.equal(record.state,'resolved');assert.equal(record.history.length,7);
 await assert.rejects(run({operation:'open',noticeId:'notice-1'},'reopen'),/NOTICE_FINAL/);
 assert.equal((await apply(await created(),{operation:'cancel',noticeId:'notice-1',reason:'No longer relevant'},'cancel')).manifest.frontier.operationsInbox.notices[0].state,'cancelled');
});
test('invalid authority, fields, text, room labels, templates, source references and timestamps fail closed',async()=>{
 const state=initialControlManifest(owner,now);
 await assert.rejects(apply(state,{operation:'create',notice:notice()},'deny',0,'agent:engineering'),/OWNER_REQUIRED/);
 for(const change of [{roomIds:[]},{roomIds:['engineering','engineering']},{roomIds:['unknown']},{templateId:'unknown'},{templateVersion:2},{title:' '},{title:'x'.repeat(121)},{body:'x'.repeat(1201)},{body:'\u0000'},{severity:'emergency'},{dueAt:now-1},{dueAt:now+366*86400},{source:{type:'owner_observation',reference:'javascript:alert(1)',observedAt:now}},{source:{type:'owner_observation',reference:'https://user:pass@example.test',observedAt:now}},{source:{type:'owner_observation',reference:'fixture:test',observedAt:now+1}},{phone:'+1'},])await assert.rejects(apply(state,{operation:'create',notice:notice(change)}),/INVALID_/);
 await assert.rejects(apply(await created(),{operation:'acknowledge',noticeId:'notice-1'}),/NOTICE_STATE_CONFLICT/);
 await assert.rejects(apply(await created(),{operation:'resolve',noticeId:'notice-1',reason:'x'}),/NOTICE_STATE_CONFLICT/);
 await assert.rejects(apply(await created(),{operation:'create',notice:notice()}),/NOTICE_CONFLICT/);
});
test('capacity is explicit and the last history slot remains available for terminal records',async()=>{
 let state=await created();let record=state.frontier.operationsInbox.notices[0];
 for(let i=1;i<31;i++)state=(await apply(state,{operation:'edit',notice:notice({title:'Revision '+i})},'edit-'+i)).manifest;
 await assert.rejects(apply(state,{operation:'edit',notice:notice()},'overflow'),/NOTICE_HISTORY_CAPACITY/);
 state=(await apply(state,{operation:'cancel',noticeId:'notice-1',reason:'Capacity review complete'},'terminal')).manifest;assert.equal(state.frontier.operationsInbox.notices[0].history.length,32);
 state.frontier.operationsInbox.notices=Array.from({length:100},(_,i)=>({...record,id:'n-'+i}));
 await assert.rejects(apply(state,{operation:'create',notice:notice()},'capacity'),/NOTICE_CAPACITY/);
});
test('encoded-byte capacity reserves terminal closure and includes unrelated canonical state',async()=>{
 let state=initialControlManifest(owner,now);let count=0;
 const saturated={title:'界'.repeat(120),body:'界'.repeat(1200)};
 try{for(let i=0;i<100;i++){state=(await apply(state,{operation:'create',notice:notice({...saturated,id:'n-'+i})},'c-'+i)).manifest;count++;
  for(let j=0;j<30;j++)state=(await apply(state,{operation:'edit',notice:notice({...saturated,id:'n-'+i})},'e-'+i+'-'+j)).manifest;
 }}catch(error){assert.equal(error.code,'NOTICE_BYTE_CAPACITY');}
 assert.ok(count<100,'Encoded byte limit reached before storage row limit');
 assert.ok(new TextEncoder().encode(JSON.stringify(state)).length<=1500000);
 for(const item of [...state.frontier.operationsInbox.notices])state=(await apply(state,{operation:'cancel',noticeId:item.id,reason:'界'.repeat(500)},'close-'+item.id)).manifest;
 assert.ok(state.frontier.operationsInbox.notices.every(n=>n.state==='cancelled'));assert.ok(new TextEncoder().encode(JSON.stringify(state)).length<=1500000);
 const heavy=initialControlManifest(owner,now);heavy.nativeTreasury={synthetic:'a'.repeat(1490000)};
 await assert.rejects(apply(heavy,{operation:'create',notice:notice(saturated)}),/NOTICE_BYTE_CAPACITY/);
});

test('due and overdue counts derive from read time, and terminal notices leave the follow-up count',async()=>{
 const {operationsInboxView}=await import('../src/operations-inbox.js');let state=await created({dueAt:now+1});
 assert.equal(operationsInboxView(state,now).notices[0].dueStatus,'upcoming');assert.equal(operationsInboxView(state,now+1).notices[0].dueStatus,'due');assert.equal(operationsInboxView(state,now+2).counts.overdue,1);
 const original=structuredClone(state);operationsInboxView(state,now+2);assert.deepEqual(state,original);
 state=(await apply(state,{operation:'cancel',noticeId:'notice-1',reason:'Closed'},'cancel')).manifest;
 assert.equal(operationsInboxView(state,now+2).counts.overdue,0);assert.equal(operationsInboxView(state,now+2).counts.rooms.engineering,1);assert.equal(operationsInboxView(state,now+2).counts.states.cancelled,1);
});
test('public metadata projection explicitly excludes the private inbox field',async()=>{
 const {publicMetadata}=await import('../src/public-privacy.js');const state=await created({title:'Synthetic private projection sentinel'});
 assert.equal(publicMetadata(state).frontier.operationsInbox,null);assert.ok(!JSON.stringify(publicMetadata(state)).includes('Synthetic private projection sentinel'));
});
