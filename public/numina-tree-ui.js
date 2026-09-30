import {requestJson,createViewScope} from './http-client.js';
const $=id=>document.getElementById(id),scope=createViewScope();
let tree=null;
const node=(tag,text)=>{const value=document.createElement(tag);value.textContent=text;return value;};
function detail(target,label,value){target.append(node('dt',label),node('dd',value??'Unavailable'));}
function text(value){return typeof value==='string'?value:value?.name??value?.id??'Unavailable';}
function evidenceLabel(value){if(typeof value==='string')return value;return value?.status??value?.scope??value?.executorStatus??'No confirming evidence returned';}
function renderTree(data){
 tree=data;$('tree-root-values').replaceChildren();
 detail($('tree-root-values'),'Root',text(data.root??'NUMINA'));
 detail($('tree-root-values'),'Genesis anchor',data.genesisHash??data.genesis?.hash??'Unavailable');
 detail($('tree-root-values'),'Journal revision',data.revision===null||data.revision===undefined?'Unavailable':String(data.revision));
 detail($('tree-root-values'),'Journal head',data.head??'Unavailable');
 detail($('tree-root-values'),'Runtime evidence',evidenceLabel(data.runtime??data.providerConfirmation));
 const rooms=Array.isArray(data.rooms)?data.rooms:[];$('room-count').textContent=rooms.length+' rooms';$('tree-rooms').replaceChildren();$('task-room').replaceChildren();
 for(const room of rooms){
  const card=node('article','');card.className='tree-room';card.append(node('h3',room.name??room.title??room.id),node('span',room.status??'Configured'));card.lastChild.className='tree-badge';
  card.append(node('p',room.objective??room.mission??room.purpose??'Objective unavailable.'));
  const dl=node('dl','');detail(dl,'Intended',room.intendedState??'Scoped business work');detail(dl,'Implemented',room.implementedState??'Room configuration');detail(dl,'Confirmed',evidenceLabel(room.providerConfirmed??room.providerConfirmation??room.evidence));card.append(dl);
  const agents=room.agents??room.subagents??[];card.append(node('h4','Delegated subagents'));const list=node('ul','');
  for(const agent of agents)list.append(node('li',text(agent)+(agent.status?' · '+agent.status:'')));
  if(!agents.length)list.append(node('li','No registered subagent returned.'));card.append(list);$('tree-rooms').append(card);
  const option=node('option',room.name??room.title??room.id);option.value=room.id;$('task-room').append(option);
 }
 $('tree-status').textContent='Room configuration read. Provider confirmation is shown separately.';
}
function clearPrivate(){scope.reset();$('tree-task-form').hidden=true;$('tree-task-form').reset();$('tree-tasks').replaceChildren();}
function signIn(){clearPrivate();const link=node('a','Sign in to Numina to assign tasks');link.href='/signin-with-chatgpt?return_to=%2Ffrontier';$('task-status').replaceChildren(link);}
async function readTasks(){
 const generation=scope.generation;
 try{const data=await requestJson('/api/control/v2/tree/tasks',{signal:scope.signal});if(!scope.isCurrent(generation))return;
  $('tree-task-form').hidden=false;$('task-status').textContent='Owner access confirmed. Recording a task does not start an autonomous worker.';$('tree-tasks').replaceChildren();
  for(const task of data.tasks??data.content?.tasks??[]){const record=node('article','');record.className='tree-task-record';record.append(node('h3',task.objective??task.title??task.id),node('p',(task.roomId??'Room unavailable')+' · '+(task.status??'Recorded')),node('p',Array.isArray(task.acceptanceCriteria)?task.acceptanceCriteria.join('; '):task.acceptanceCriteria??task.acceptance??'Acceptance criteria unavailable'));$('tree-tasks').append(record);}
  if(!($('tree-tasks').children.length))$('tree-tasks').append(node('p','No recorded room tasks.'));
 }catch(error){if(!scope.isCurrent(generation))return;if(error.status===401||error.status===403)signIn();else{$('tree-task-form').hidden=true;$('task-status').textContent='Task records unavailable: '+error.message;}}
}
async function refresh(){clearPrivate();const generation=scope.generation,signal=scope.signal,button=$('tree-refresh');button.disabled=true;try{const data=await requestJson('/api/control/v2/tree',{credentials:'omit',signal});if(!scope.isCurrent(generation))return;renderTree(data);await readTasks();}catch(error){if(!scope.isCurrent(generation))return;$('tree-status').textContent='Current tree unavailable: '+error.message;$('tree-rooms').replaceChildren();clearPrivate();}finally{button.disabled=false;}}
if($('subagent-control-room')){
$('tree-refresh').addEventListener('click',refresh);
$('tree-task-form').addEventListener('submit',async event=>{event.preventDefault();const formElement=event.currentTarget;const button=formElement.querySelector('button');if(button.disabled)return;button.disabled=true;const generation=scope.generation,signal=scope.signal;
 try{const form=new FormData(formElement);const data={operation:'assign',id:crypto.randomUUID(),roomId:form.get('roomId'),objective:form.get('objective').trim(),acceptanceCriteria:form.get('acceptanceCriteria').trim().split(/\n+/).map(value=>value.trim()).filter(Boolean),evidenceReferences:[]};
  const state=await requestJson('/api/control/v2/state',{signal});if(!scope.isCurrent(generation))return;
  await requestJson('/api/control/v2/tree/tasks',{signal,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),expectedRevision:state.revision,data})});
  if(!scope.isCurrent(generation))return;formElement.reset();await refresh();
 }catch(error){if(!scope.isCurrent(generation))return;if(error.status===401||error.status===403)signIn();else $('task-status').textContent='Task was not confirmed: '+error.message;}finally{button.disabled=false;}
});
document.addEventListener('numina-owner-access-lost',signIn);window.addEventListener('pagehide',clearPrivate);window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});refresh();
}
