// Internal work routing. Configuration and recorded execution evidence are separate.
export const ROOM_DEFINITIONS=Object.freeze([
  ['strategy','Strategy','Prioritize Numina objectives and acceptance criteria.'],
  ['federal-capture','Federal Capture','Track authenticated topic requirements, proposal gates and deadlines.'],
  ['product','Product','Define product scope and acceptance criteria.'],
  ['engineering','Engineering','Implement, test and reconcile release identities.'],
  ['compliance-risk','Compliance & Risk','Track controls, evidence and unresolved risk.'],
  ['market-intelligence','Market Intelligence','Record sourced market and regulatory observations.'],
  ['publicity-narrative','Publicity & Narrative','Prepare evidence-backed communications for owner review.'],
  ['partnerships-sales','Partnerships & Sales','Track provider replies and prepare partnership follow-ups.'],
  ['finance-treasury','Finance & Treasury','Reconcile internal records with provider-confirmed evidence.']
].map(([id,name,objective])=>Object.freeze({id,name,objective,agentId:'agent:'+id,parent:'NUMINA',resourcePrefix:'record:numina/rooms/'+id+'/'})));
function treeFail(code,status=422){throw Object.assign(Error(code),{code,status});}
function treeDemand(ok,code,status){if(!ok)treeFail(code,status);}
function treeExact(data,fields){treeDemand(data&&Object.getPrototypeOf(data)===Object.prototype&&Object.keys(data).length===fields.length&&fields.every(f=>Object.hasOwn(data,f)),'INVALID_TREE_FIELDS',400);}
function treeText(value,max=2000){return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);}
function treeId(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);}
function treeEvidence(values){treeDemand(Array.isArray(values)&&values.length>0&&values.length<=20&&values.every(v=>treeText(v,500))&&new Set(values).size===values.length,'EXECUTION_EVIDENCE_REQUIRED',400);}
export function validateTreeTask(data){
  treeExact(data,['id','roomId','objective','acceptanceCriteria','evidenceReferences']);
  treeDemand(treeId(data.id)&&ROOM_DEFINITIONS.some(r=>r.id===data.roomId)&&treeText(data.objective),'INVALID_TREE_TASK',400);
  treeDemand(Array.isArray(data.acceptanceCriteria)&&data.acceptanceCriteria.length>0&&data.acceptanceCriteria.length<=20&&data.acceptanceCriteria.every(v=>treeText(v,500)),'INVALID_ACCEPTANCE_CRITERIA',400);
  treeDemand(Array.isArray(data.evidenceReferences)&&data.evidenceReferences.length<=20&&data.evidenceReferences.every(v=>treeText(v,500)),'INVALID_EVIDENCE_REFERENCES',400);
  return data;
}
export function reduceTreeTask(tasks,command,actor,now,root='NUMINA'){
  treeDemand(Array.isArray(tasks)&&Number.isSafeInteger(now),'INVALID_TREE_STATE',400);
  treeDemand(actor===root,'OWNER_REQUIRED',403);
  const data=command.data;let result;
  if(command.type==='tree.assign'){
    validateTreeTask(data);treeDemand(!tasks.some(t=>t.id===data.id),'TREE_TASK_CONFLICT',409);
    const task={...structuredClone(data),agentId:'agent:'+data.roomId,status:'queued',createdAt:now,createdBy:actor,execution:null,result:null};
    tasks.push(task);result={taskId:task.id,status:task.status,agentId:task.agentId};
  }else if(command.type==='tree.start'){
    treeExact(data,['taskId','executorId','runId','evidenceReferences']);
    const task=tasks.find(t=>t.id===data.taskId);treeDemand(task,'TREE_TASK_NOT_FOUND',404);treeDemand(task.status==='queued','TREE_TASK_STATE_CONFLICT',409);
    treeDemand(treeText(data.executorId,160)&&treeId(data.runId),'INVALID_EXECUTOR',400);treeEvidence(data.evidenceReferences);
    treeDemand(!tasks.some(t=>t.execution?.runId===data.runId),'EXECUTOR_RUN_CONFLICT',409);
    task.status='running';task.execution={executorId:data.executorId,runId:data.runId,evidenceReferences:[...data.evidenceReferences],recordedAt:now,recordedBy:actor,executorVerified:false,verification:'owner_recorded_execution_evidence'};
    result={taskId:task.id,status:task.status,runId:data.runId};
  }else if(command.type==='tree.result'){
    treeExact(data,['taskId','runId','outcome','summary','evidenceReferences']);
    const task=tasks.find(t=>t.id===data.taskId);treeDemand(task,'TREE_TASK_NOT_FOUND',404);treeDemand(task.status==='running'&&task.execution?.runId===data.runId,'TREE_TASK_STATE_CONFLICT',409);
    treeDemand(['completed','blocked','failed'].includes(data.outcome)&&treeText(data.summary),'INVALID_TREE_RESULT',400);treeEvidence(data.evidenceReferences);
    task.status=data.outcome;task.result={...structuredClone(data),recordedAt:now,recordedBy:actor,verification:'recorded_evidence_not_independently_verified'};
    result={taskId:task.id,status:task.status,verification:task.result.verification};
  }else treeFail('UNKNOWN_TREE_COMMAND',400);
  return {...result,scope:'internal_task_record',executorVerified:false,externalExecution:false,autonomousExecution:false};
}
export const TREE_GENESIS_ANCHOR='0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1';
export function numinaTree(){return {...readNuminaTree({genesisHash:TREE_GENESIS_ANCHOR}),genesisSource:'runtime/nusd/deployment-receipt.json',genesisScope:'preserved_historical_chain_anchor_not_production_deployment_proof'};}
export function readRoomTasks(manifest){return {schema:'numina.room-tasks.v1',scope:'owner_private_internal_task_records',tasks:structuredClone(manifest.frontier?.roomTasks??[]),executorVerified:false,autonomousExecution:false,externalExecution:false};}
export function readNuminaTree({genesisHash=null,revision=null,head=null,tasks=[]}={}){
  treeDemand(genesisHash===null||/^(0x)?[a-f0-9]{64}$/.test(genesisHash),'INVALID_GENESIS_ANCHOR',400);
  return {schema:'numina.tree.v1',root:'NUMINA',genesisHash,revision,head,scope:'internal_work_routing',runtime:{autonomousExecution:false,externalExecution:false,executorStatus:'not_connected',taskExecution:'owner_records_executor_evidence'},rooms:ROOM_DEFINITIONS.map(room=>({...room,status:'configured',agents:[{id:room.agentId,name:room.name,status:'configured',authorityGranted:false}],tasks:structuredClone(tasks.filter(t=>t.roomId===room.id))})),tasks:structuredClone(tasks)};
}
