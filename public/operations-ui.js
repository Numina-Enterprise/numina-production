import {createOperationsClient} from './operations-client.js';
const opsNode=(tag,text='')=>{const element=document.createElement(tag);element.textContent=text;return element;};
const opsUtc=value=>value===null||value===undefined?'None':new Date(value*1000).toISOString();
const opsInputUtc=value=>value===null||value===undefined?'':new Date(value*1000).toISOString().slice(0,16);
const opsReadUtc=value=>value?Math.floor(Date.parse(value+':00Z')/1000):null;
export function mountOperationsInbox(target){
 let draft=null,editing=null,model=null,returnFocus=false;const drafts=new Map();
 const status=opsNode('p');status.tabIndex=-1;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const content=opsNode('div');content.className='operations-content';
 target.replaceChildren(opsNode('h2','Private operations inbox'),opsNode('p','Owner-recorded notices across nine rooms. Rooms are routing labels, not staffed recipients. External delivery is not configured.'),opsNode('p','Use short references only. Do not enter confidential documents, credentials, private financial or health details, contact lists or location data. A critical notice is not an emergency alert service.'),status,content);
 const client=createOperationsClient({onChange:render,onAccessLost:()=>document.dispatchEvent(new CustomEvent('numina-owner-access-lost'))});
 function button(label,action){const b=opsNode('button',label);b.type='button';b.className='button secondary';b.addEventListener('click',action);return b;}
 function field(form,label,name,value,{tag='input',max=120,type='text',required=true,options=null}={}){
  const wrapper=opsNode('label',label),input=opsNode(options?'select':tag);input.name=name;input.value=value??'';input.required=required;input.maxLength=max;if(!options&&tag==='input')input.type=type;
  if(options){for(const [id,text]of options){const option=opsNode('option',text);option.value=id;option.selected=id===value;input.append(option);}input.value=value??options[0][0];}
  wrapper.append(input);form.append(wrapper);return input;
 }
 function prepare(data){try{client.prepare(data);}catch(error){status.textContent=error.message;}}
 function noticeForm(view){
  draft??={id:crypto.randomUUID(),roomIds:[view.rooms[0]?.id].filter(Boolean),templateId:view.templates[0]?.id??'',templateVersion:1,title:'',body:'',severity:'routine',dueAt:null,source:{type:'owner_observation',reference:'',observedAt:Math.floor(Date.now()/1000)}};
  const form=opsNode('form');form.className='operations-form';form.append(opsNode('h3',editing?'Edit private draft':'Create a private draft'));
  const template=field(form,'Template','templateId',draft.templateId,{options:view.templates.map(t=>[t.id,t.name+' · v'+t.version])});
  const group=opsNode('fieldset');group.append(opsNode('legend','Room routing labels'));const rooms=[];
  for(const room of view.rooms){const label=opsNode('label',room.name),input=opsNode('input');input.type='checkbox';input.name='roomIds';input.value=room.id;input.checked=draft.roomIds.includes(room.id);label.append(input);group.append(label);rooms.push(input);}form.append(group);
  const title=field(form,'Title','title',draft.title,{max:120});
  const body=field(form,'Notice (plain text)','body',draft.body,{tag:'textarea',max:1200});
  const severity=field(form,'Severity','severity',draft.severity,{options:[['routine','Routine'],['important','Important'],['critical','Critical (internal record only)']]});
  const due=field(form,'Due time (UTC, optional)','dueAt',opsInputUtc(draft.dueAt),{type:'datetime-local',required:false});
  const sourceType=field(form,'Source type','sourceType',draft.source.type,{options:[['owner_observation','Owner observation'],['journal_event','Journal event ID'],['surface','Registered surface ID']]});
  const reference=field(form,'Source reference (short ID only)','reference',draft.source.reference,{max:240});
  const observed=field(form,'Observed time (UTC)','observedAt',opsInputUtc(draft.source.observedAt),{type:'datetime-local'});
  form.append(opsNode('p','Surface IDs: '+view.sources.map(s=>s.id).join(', ')));
  const capture=()=>{draft={id:draft.id,templateId:template.value,templateVersion:view.templates.find(t=>t.id===template.value)?.version??1,roomIds:rooms.filter(r=>r.checked).map(r=>r.value),title:title.value,body:body.value,severity:severity.value,dueAt:opsReadUtc(due.value),source:{type:sourceType.value,reference:reference.value,observedAt:opsReadUtc(observed.value)}};};
  form.addEventListener('input',capture);form.addEventListener('change',capture);
  const submit=opsNode('button','Review draft');submit.type='submit';submit.className='button';form.append(submit);
  form.addEventListener('submit',event=>{event.preventDefault();capture();if(!draft.roomIds.length){status.textContent='Select at least one room label.';return;}prepare({operation:editing?'edit':'create',notice:draft});});
  if(editing)form.append(button('Stop editing',()=>{editing=null;draft=null;render(model);}));return form;
 }
 function recordCard(record,view){
  const card=opsNode('article');card.className='operations-record';card.append(opsNode('h3',record.title),opsNode('p',record.state+' · '+record.severity+' · '+record.dueStatus),opsNode('p',record.body),opsNode('p','Rooms: '+record.roomIds.map(id=>view.rooms.find(r=>r.id===id)?.name??id).join(', ')),opsNode('p','Due (UTC): '+opsUtc(record.dueAt)),opsNode('p','Source: '+record.source.type+' · '+record.source.reference+' · observed '+opsUtc(record.source.observedAt)),opsNode('p','Recorded by '+record.createdBy+' at '+opsUtc(record.createdAt)+'. Source evidence is owner-recorded, not independently verified.'));
  if(record.acknowledgment)card.append(opsNode('p','Acknowledged by owner '+record.acknowledgment.actor+' at '+opsUtc(record.acknowledgment.at)+'. This does not establish anyone else received or read it.'));
  if(record.response)card.append(opsNode('p','Owner response: '+record.response.choice+' · '+record.response.note));
  if(record.resolution||record.cancellation)card.append(opsNode('p',(record.resolution?'Resolution: ':'Cancellation: ')+(record.resolution??record.cancellation).reason));
  const terminal=['resolved','cancelled'].includes(record.state);
  if(!terminal){
   const actions=opsNode('div');actions.className='operations-actions';
   if(record.state==='draft'){
    actions.append(button('Edit draft',()=>{editing=record.id;draft=Object.fromEntries(['id','roomIds','templateId','templateVersion','title','body','severity','dueAt','source'].map(k=>[k,structuredClone(record[k])]));render(model);content.querySelector?.('form input[name="title"]')?.focus();}),button('Open notice',()=>prepare({operation:'open',noticeId:record.id})));
   }
   if(record.state==='open')actions.append(button('Acknowledge',()=>prepare({operation:'acknowledge',noticeId:record.id})));
   card.append(actions);
   const form=opsNode('form');form.className='operations-form operations-action-form';
   const saved=drafts.get(record.id)??{operation:record.state==='draft'?'cancel':'respond',choice:'reviewing',note:'',dueAt:opsInputUtc(record.dueAt)};
   const operation=field(form,'Record an owner follow-up or outcome','operation',saved.operation,{options:record.state==='draft'?[['cancel','Cancel notice']]:[['respond','Owner response'],['followup','Follow-up'],['resolve','Resolve notice'],['cancel','Cancel notice']]});
   const choice=field(form,'Response choice (for owner response)','choice',saved.choice,{options:[['reviewing','Reviewing'],['blocked','Blocked'],['ready','Ready']]});
   const note=field(form,'Note or reason','note',saved.note,{tag:'textarea',max:500});
   const due=field(form,'New due time (UTC, for follow-up; optional)','dueAt',saved.dueAt,{type:'datetime-local',required:false});
   const capture=()=>drafts.set(record.id,{operation:operation.value,choice:choice.value,note:note.value,dueAt:due.value});form.addEventListener('input',capture);form.addEventListener('change',capture);
   const submit=opsNode('button','Review change');submit.type='submit';submit.className='button secondary';form.append(submit);
   form.addEventListener('submit',event=>{event.preventDefault();capture();const data={operation:operation.value,noticeId:record.id};if(data.operation==='respond'){data.choice=choice.value;data.note=note.value;}else if(data.operation==='followup'){data.note=note.value;data.dueAt=opsReadUtc(due.value);}else data.reason=note.value;prepare(data);});card.append(form);
  }
  const history=opsNode('details');history.append(opsNode('summary','Audit history · '+record.history.length+' entries'));
  for(const entry of record.history){const item=opsNode('section');item.append(opsNode('h4',entry.operation+' · '+entry.state),opsNode('p',entry.actor+' · '+opsUtc(entry.at)),opsNode('pre',JSON.stringify(entry.data,null,2)));const link=opsNode('a','Read private journal receipt');link.href='/api/control/v2/receipts/'+encodeURIComponent(entry.eventId);item.append(link);history.append(item);}card.append(history);return card;
 }
 function render(state){
  const previousStatus=model?.status;model=state;status.textContent=state.message;content.replaceChildren();
  if(['review','saving','reconciling'].includes(state.status)||previousStatus==='review')returnFocus=true;
  if(returnFocus&&['ready','error','stale','capacity','unauthorized','retry_review','unknown'].includes(state.status)){status.focus();returnFocus=false;}
  if(['unauthorized','idle'].includes(state.status)){draft=null;editing=null;drafts.clear();}
  if(state.status==='unauthorized'){const link=opsNode('a','Sign in as the Numina owner');link.href='/signin-with-chatgpt?return_to=%2Ffrontier%23operations-inbox';content.append(link);return;}
  if(state.receipt){draft=null;editing=null;drafts.clear();content.append(opsNode('p','Recorded command: '+state.receipt.payload.eventId));}
  if(state.pending){
   const review=opsNode('section');review.className='operations-review';const heading=opsNode('h3','Review private record');heading.tabIndex=-1;review.append(heading,opsNode('p','Command '+state.pending.command.id+' · journal revision '+state.pending.command.expectedRevision),opsNode('pre',JSON.stringify(state.pending.command.data,null,2)));content.append(review);if(state.status==='review'&&previousStatus!=='review')heading.focus();
   if(['review','retry_review'].includes(state.status)){review.append(button(state.status==='retry_review'?'Retry same reviewed command':'Record reviewed change',()=>client.save()));if(state.status==='review')review.append(button('Back to records',()=>client.dismiss()));}
   if(['unknown','retry_review'].includes(state.status))review.append(button('Check command outcome',()=>client.reconcile()));
   return;
  }
  const refresh=button('Refresh private records',()=>client.load());refresh.disabled=state.status==='loading';content.append(refresh);
  if(state.status!=='ready'||!state.view)return;
  const view=state.view;content.append(opsNode('p','Journal revision '+view.revision+' · observed '+opsUtc(view.observedAt)+'. Due indicators update when refreshed.'),opsNode('p',view.counts.total+' records · '+view.counts.overdue+' overdue. Limits: up to '+view.limits.notices+' notices, '+view.limits.history+' history entries each, and '+view.limits.canonicalBytes+' encoded canonical-state bytes including reserved closure space.'));
  const counts=opsNode('details');counts.append(opsNode('summary','Counts by state, severity and room'),opsNode('pre',JSON.stringify(view.counts,null,2)));content.append(counts);
  const followups=view.notices.filter(n=>!['resolved','cancelled'].includes(n.state)&&(n.dueStatus==='overdue'||n.response?.choice==='blocked'));if(followups.length)content.append(opsNode('h3','Follow-ups needing review'),opsNode('p',followups.map(n=>n.title+' ('+n.dueStatus+(n.response?.choice==='blocked'?', blocked':'')+')').join('; ')));
  content.append(noticeForm(view));if(!view.notices.length)content.append(opsNode('p','No private notices recorded yet.'));
  for(const record of view.notices)content.append(recordCard(record,view));
 }
 const clear=()=>{draft=null;editing=null;drafts.clear();client.clear();};
 document.addEventListener('numina-owner-access-lost',()=>{clear();render({status:'unauthorized',view:null,pending:null,message:'Owner sign-in is required.'});});
 window.addEventListener('pagehide',clear);window.addEventListener('pageshow',event=>{if(event.persisted)client.load();});
 client.load();return {clear};
}
const operationsTarget=document.getElementById('operations-inbox');if(operationsTarget)mountOperationsInbox(operationsTarget);
