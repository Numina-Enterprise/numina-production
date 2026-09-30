import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOM_DEFINITIONS,readNuminaTree,reduceTreeTask} from '../src/numina-tree.js';
import {reduceFrontier} from '../src/frontier.js';
import {readRoomTasks,numinaTree} from '../src/numina-tree.js';
const assignment={id:'release-check',roomId:'engineering',objective:'Verify production identity',acceptanceCriteria:['Provider readback matches deployed build'],evidenceReferences:[]};
test('tree preserves supplied genesis and distinguishes configuration from execution',()=>{
  const tree=readNuminaTree({genesisHash:'a'.repeat(64)});
  assert.equal(tree.genesisHash,'a'.repeat(64));assert.equal(tree.rooms.length,9);
  assert.equal(new Set(ROOM_DEFINITIONS.map(r=>r.agentId)).size,9);
  assert.equal(tree.runtime.autonomousExecution,false);assert.equal(tree.runtime.executorStatus,'not_connected');
  assert.ok(tree.rooms.every(r=>r.agents[0].status==='configured'&&!r.agents[0].authorityGranted));
});
test('dispatch cannot claim running or completion without execution evidence and matching run',()=>{
  const tasks=[];reduceTreeTask(tasks,{type:'tree.assign',data:assignment},'NUMINA',1);
  assert.equal(tasks[0].status,'queued');
  assert.throws(()=>reduceTreeTask(tasks,{type:'tree.start',data:{taskId:assignment.id,executorId:'worker',runId:'run-1',evidenceReferences:[]}},'NUMINA',2),/EXECUTION_EVIDENCE_REQUIRED/);
  reduceTreeTask(tasks,{type:'tree.start',data:{taskId:assignment.id,executorId:'worker',runId:'run-1',evidenceReferences:['provider:run-1']}},'NUMINA',2);
  assert.throws(()=>reduceTreeTask(tasks,{type:'tree.result',data:{taskId:assignment.id,runId:'wrong-run',outcome:'completed',summary:'Done',evidenceReferences:['provider:result']}},'NUMINA',3),/TREE_TASK_STATE_CONFLICT/);
  reduceTreeTask(tasks,{type:'tree.result',data:{taskId:assignment.id,runId:'run-1',outcome:'blocked',summary:'Live identity unavailable',evidenceReferences:['provider:403']}},'NUMINA',3);
  assert.equal(tasks[0].status,'blocked');assert.equal(tasks[0].result.verification,'recorded_evidence_not_independently_verified');
});
test('owner authority, room membership and unique assignment enforced',()=>{
  const tasks=[];assert.throws(()=>reduceTreeTask(tasks,{type:'tree.assign',data:assignment},'agent:engineering',1),/OWNER_REQUIRED/);
  assert.throws(()=>reduceTreeTask(tasks,{type:'tree.assign',data:{...assignment,roomId:'unknown'}},'NUMINA',1),/INVALID_TREE_TASK/);
  reduceTreeTask(tasks,{type:'tree.assign',data:assignment},'NUMINA',1);
  assert.throws(()=>reduceTreeTask(tasks,{type:'tree.assign',data:assignment},'NUMINA',2),/TREE_TASK_CONFLICT/);
  const tree=readNuminaTree({tasks});tree.tasks[0].status='completed';assert.equal(tasks[0].status,'queued');
});
test('canonical reducer persists private assignments without registering credentials or granting authority',async()=>{
  const state={root:'NUMINA'};
  const result=await reduceFrontier(state,{id:'journal-event',type:'frontier.room_task',data:{operation:'assign',...assignment}},'NUMINA',1);
  assert.equal(result.eventId,'journal-event');assert.equal(result.executorVerified,false);
  assert.equal(state.frontier.roomTasks[0].status,'queued');assert.equal(state.frontier.principals.length,0);
  assert.equal(readRoomTasks(state).tasks.length,1);assert.equal(numinaTree().tasks.length,0);
  await assert.rejects(reduceFrontier(state,{id:'denied',type:'frontier.room_task',data:{operation:'assign',...assignment,id:'second'}},'agent:engineering',2),/OWNER_REQUIRED/);
});
