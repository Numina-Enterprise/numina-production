// Owner-private records only. No dispatch, recipient registry or external execution.
import {ROOM_DEFINITIONS} from './numina-tree.js';
import {CONNECTION_TARGETS} from '../public/connection-model.js';
export const OPERATIONS_LIMITS=Object.freeze({notices:100,history:32,title:120,body:1200,note:500,reference:240,canonicalBytes:1500000,terminalReserveBytes:8192});
export const OPERATIONS_TEMPLATES=Object.freeze(ROOM_DEFINITIONS.map((room,index)=>Object.freeze({id:room.id,version:1,roomId:room.id,name:['Decision review','Proposal gate review','Acceptance review','Build or outage review','Control evidence review','Sourced observation','Draft or claim review','Reply or follow-up review','Receipt evidence review'][index]})));
function opsDemand(ok,code,status=400){if(!ok)throw Object.assign(Error(code),{code,status});}
function opsExact(value,keys){opsDemand(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'INVALID_NOTICE_FIELDS');}
function opsText(value,max,empty=false){return typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0)&&!/[\u0000-\u001f\u007f]/.test(value);}
function opsId(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);}
function opsDue(value,now){opsDemand(value===null||(Number.isSafeInteger(value)&&value>=now&&value<=now+365*86400),'INVALID_NOTICE_DUE_TIME');}
function opsSource(source,now){
 opsExact(source,['type','reference','observedAt']);
 opsDemand(Number.isSafeInteger(source.observedAt)&&source.observedAt>0&&source.observedAt<=now,'INVALID_NOTICE_OBSERVED_TIME');
 opsDemand(opsText(source.reference,OPERATIONS_LIMITS.reference),'INVALID_NOTICE_REFERENCE');
 if(source.type==='surface')opsDemand(Object.hasOwn(CONNECTION_TARGETS,source.reference),'INVALID_NOTICE_REFERENCE');
 else if(source.type==='journal_event')opsDemand(opsId(source.reference),'INVALID_NOTICE_REFERENCE');
 else if(source.type==='owner_observation')opsDemand(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(source.reference)&&!source.reference.includes('://')&&!/^(?:javascript|data|file):/i.test(source.reference),'INVALID_NOTICE_REFERENCE');
 else opsDemand(false,'INVALID_NOTICE_SOURCE');
}
export function validateOperationsNotice(notice,now){
 opsExact(notice,['id','roomIds','templateId','templateVersion','title','body','severity','dueAt','source']);
 opsDemand(opsId(notice.id),'INVALID_NOTICE_ID');
 opsDemand(Array.isArray(notice.roomIds)&&notice.roomIds.length>0&&notice.roomIds.length<=ROOM_DEFINITIONS.length&&new Set(notice.roomIds).size===notice.roomIds.length&&notice.roomIds.every(id=>ROOM_DEFINITIONS.some(r=>r.id===id)),'INVALID_NOTICE_ROOMS');
 opsDemand(OPERATIONS_TEMPLATES.some(t=>t.id===notice.templateId&&t.version===notice.templateVersion),'INVALID_NOTICE_TEMPLATE');
 opsDemand(opsText(notice.title,OPERATIONS_LIMITS.title)&&opsText(notice.body,OPERATIONS_LIMITS.body),'INVALID_NOTICE_TEXT');
 opsDemand(['routine','important','critical'].includes(notice.severity),'INVALID_NOTICE_SEVERITY');
 opsDue(notice.dueAt,now);opsSource(notice.source,now);return notice;
}
export function reduceOperationsInbox(current,command,actor,now,root){
 opsDemand(actor===root,'OWNER_REQUIRED',403);opsDemand(Number.isSafeInteger(now)&&now>0,'INVALID_NOTICE_TIME');
 const inbox=structuredClone(current??{notices:[]}),data=command.data;
 opsDemand(inbox&&Array.isArray(inbox.notices)&&inbox.notices.length<=OPERATIONS_LIMITS.notices,'INVALID_NOTICE_STATE',503);
 opsDemand(data&&typeof data.operation==='string','INVALID_NOTICE_OPERATION');
 const operation=data.operation;let notice;
 if(operation==='create'||operation==='edit'){
  opsExact(data,['operation','notice']);validateOperationsNotice(data.notice,now);
  notice=inbox.notices.find(n=>n.id===data.notice.id);
  if(operation==='create'){
   opsDemand(!notice,'NOTICE_CONFLICT',409);opsDemand(inbox.notices.length<OPERATIONS_LIMITS.notices,'NOTICE_CAPACITY',409);
   notice={...structuredClone(data.notice),state:'draft',createdAt:now,createdBy:actor,createdEvent:command.id,updatedAt:now,acknowledgment:null,response:null,resolution:null,cancellation:null,history:[]};inbox.notices.push(notice);
  }else{opsDemand(notice,'NOTICE_NOT_FOUND',404);opsDemand(notice.state==='draft','NOTICE_STATE_CONFLICT',409);}
 }else{
  const extra=operation==='respond'?['choice','note']:operation==='followup'?['note','dueAt']:['resolve','cancel'].includes(operation)?['reason']:[];
  opsExact(data,['operation','noticeId',...extra]);opsDemand(opsId(data.noticeId),'INVALID_NOTICE_ID');
  opsDemand(['open','acknowledge','respond','followup','resolve','cancel'].includes(operation),'INVALID_NOTICE_OPERATION');
  notice=inbox.notices.find(n=>n.id===data.noticeId);opsDemand(notice,'NOTICE_NOT_FOUND',404);
 }
 opsDemand(!['resolved','cancelled'].includes(notice.state),'NOTICE_FINAL',409);
 opsDemand(now>=notice.updatedAt,'INVALID_NOTICE_TIME');
 const terminal=['resolve','cancel'].includes(operation);
 opsDemand(notice.history.length<(terminal?OPERATIONS_LIMITS.history:OPERATIONS_LIMITS.history-1),'NOTICE_HISTORY_CAPACITY',409);
 if(operation==='edit')Object.assign(notice,structuredClone(data.notice));
 if(operation==='open'){opsDemand(notice.state==='draft','NOTICE_STATE_CONFLICT',409);notice.state='open';}
 if(operation==='acknowledge'){opsDemand(notice.state==='open','NOTICE_STATE_CONFLICT',409);notice.state='acknowledged';notice.acknowledgment={actor,at:now,eventId:command.id,scope:'owner_only'};}
 if(['respond','followup','resolve'].includes(operation))opsDemand(['open','acknowledged'].includes(notice.state),'NOTICE_STATE_CONFLICT',409);
 if(operation==='respond'){
  opsDemand(['reviewing','blocked','ready'].includes(data.choice)&&opsText(data.note,OPERATIONS_LIMITS.note,true),'INVALID_NOTICE_RESPONSE');
  notice.response={choice:data.choice,note:data.note,actor,at:now,eventId:command.id,verification:'owner_recorded'};
 }
 if(operation==='followup'){opsDemand(opsText(data.note,OPERATIONS_LIMITS.note),'INVALID_NOTICE_NOTE');opsDue(data.dueAt,now);notice.dueAt=data.dueAt;}
 if(terminal){opsDemand(opsText(data.reason,OPERATIONS_LIMITS.note),'INVALID_NOTICE_REASON');notice.state=operation==='resolve'?'resolved':'cancelled';notice[operation==='resolve'?'resolution':'cancellation']={reason:data.reason,actor,at:now,eventId:command.id};}
 notice.updatedAt=now;notice.history.push({eventId:command.id,actor,at:now,operation,state:notice.state,data:structuredClone(data)});
 return {inbox,result:{noticeId:notice.id,state:notice.state,eventId:command.id,recorded:true,delivery:'not_configured',externalExecution:false}};
}
export function operationsInboxView(manifest,now){
 const notices=structuredClone(manifest.frontier?.operationsInbox?.notices??[]).map(n=>({...n,dueStatus:['resolved','cancelled'].includes(n.state)||n.dueAt===null?'none':n.dueAt<now?'overdue':n.dueAt===now?'due':'upcoming',verification:'owner_recorded_not_independently_verified'}));
 const countBy=(values,match)=>Object.fromEntries(values.map(value=>[value,notices.filter(n=>match(n,value)).length]));
 return {schema:'numina.operations-inbox.v1',observedAt:now,delivery:'not_configured',externalExecution:false,rooms:ROOM_DEFINITIONS.map(({id,name})=>({id,name})),templates:OPERATIONS_TEMPLATES,sources:Object.entries(CONNECTION_TARGETS).map(([id,s])=>({id,name:s.name})),limits:OPERATIONS_LIMITS,notices,counts:{total:notices.length,overdue:notices.filter(n=>n.dueStatus==='overdue').length,states:countBy(['draft','open','acknowledged','resolved','cancelled'],(n,v)=>n.state===v),severities:countBy(['routine','important','critical'],(n,v)=>n.severity===v),rooms:countBy(ROOM_DEFINITIONS.map(r=>r.id),(n,v)=>n.roomIds.includes(v))}};
}

export function assertOperationsCapacity(manifest){
 const notices=manifest.frontier?.operationsInbox?.notices??[];
 const reserved=notices.filter(n=>!['resolved','cancelled'].includes(n.state)).length*OPERATIONS_LIMITS.terminalReserveBytes;
 opsDemand(new TextEncoder().encode(JSON.stringify(manifest)).length+reserved<=OPERATIONS_LIMITS.canonicalBytes,'NOTICE_BYTE_CAPACITY',409);
}
