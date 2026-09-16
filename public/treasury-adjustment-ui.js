import {createTreasuryAdjustment} from './treasury-adjustment.js';

// Keep an uncertain operation in this tab across control-room refreshes. A retry
// always uses its original client and frozen event, never a replacement ID.
let session=null;
const format=value=>new Intl.NumberFormat('en-US').format(BigInt(value));
export function mountTreasuryAdjustment(target,{root,isCurrent=()=>true,onCommitted=async()=>{},doc=document,win=window,clientFactory=createTreasuryAdjustment}={}){
 if(!target||typeof root!=='string'||!root)return;
 if(!session||session.root!==root)session={root,client:clientFactory(),draft:null,attempted:false,receipt:null,busy:false};
 const state=session,view={},current=()=>session===state&&state.view===view&&isCurrent();
 state.view=view;
 const renderCurrent=()=>state.view?.render();
 const node=(tag,text='')=>{const n=doc.createElement(tag);n.textContent=text;return n;};
 const section=node('section');section.className='account-link-form';
 section.append(node('h3','Adjust the native projection'),node('p','Record an exact NUSD model adjustment in the existing journal. This does not mint tokens, change provider balances or transfer funds.'));
 const form=node('form');
 const deltaLabel=node('label','NUSD adjustment (whole units; use a minus sign to reduce)'),delta=node('input');delta.name='nativeAdjustmentDelta';delta.id='native-adjustment-delta';delta.required=true;delta.maxLength=79;delta.autocomplete='off';deltaLabel.append(delta);
 const reasonLabel=node('label','Reason for the native adjustment'),reason=node('input');reason.name='nativeAdjustmentReason';reason.id='native-adjustment-reason';reason.required=true;reason.maxLength=1000;reasonLabel.append(reason);
 const prepare=node('button','Review native adjustment');prepare.type='submit';prepare.className='button secondary';form.append(deltaLabel,reasonLabel,prepare);
 const summary=node('p'),status=node('p');summary.id='native-adjustment-summary';status.id='native-adjustment-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const commit=node('button','Commit native adjustment');commit.type='button';commit.className='button';commit.id='native-adjustment-commit';
 const edit=node('button','Edit unsubmitted adjustment');edit.type='button';edit.className='button secondary';
 const download=node('button','Download adjustment record');download.type='button';download.className='button secondary';
 const details=node('details'),heading=node('summary','Exact event and committed proof'),record=node('pre');record.id='native-adjustment-record';details.append(heading,record);
 section.append(form,summary,commit,edit,download,status,details);target.append(section);
 function render(){
  if(!current())return;
  const draft=state.draft,receipt=state.receipt;
  delta.disabled=reason.disabled=Boolean(draft)||state.busy;prepare.disabled=Boolean(draft)||state.busy;
  commit.hidden=!draft||Boolean(receipt);commit.disabled=state.busy;commit.textContent=state.attempted?'Retry exact adjustment':'Commit native adjustment';
  edit.hidden=!draft||state.attempted;edit.disabled=state.busy;download.hidden=!draft;download.disabled=state.busy;
  details.hidden=!draft;
  if(draft){
   delta.value=draft.event.Intent.delta;reason.value=draft.event.Intent.reason;
   summary.textContent=format(draft.beforeBalance)+' NUSD → '+format(draft.afterBalance)+' NUSD · event '+draft.event.id+' · expected revision '+draft.event.expectedRevision;
   record.textContent=JSON.stringify({event:draft.event,beforeBalance:draft.beforeBalance,afterBalance:draft.afterBalance,receipt:receipt??null},null,2);
  }else{summary.textContent='Review an adjustment against the latest verified treasury record before committing.';record.textContent='';}
  if(receipt)status.textContent='FINAL native record verified · revision '+receipt.head_advancement.revision+' · head '+receipt.head_advancement.head+'. No token mint or provider transfer occurred.';
  else if(state.attempted&&!state.busy)status.textContent='Result not confirmed. Retry this exact event or download its record. Keep this tab open; do not create a replacement adjustment.';
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(!current()||state.busy||state.draft)return;
  const input={delta:delta.value.trim(),reason:reason.value.trim()};state.busy=true;status.textContent='Reading and verifying the latest native treasury…';render();
  try{
   const draft=await state.client.prepare(input);
   if(session!==state)return;
   if(draft.event.Principal!==root)throw Error('Owner identity changed.');
   state.draft=draft;if(current())status.textContent='Review the amount, resulting balance and exact event. Nothing has been written yet.';
  }catch{if(current())status.textContent='The adjustment could not be prepared. Check the exact signed integer, reason and owner access, then try again.';}
  finally{state.busy=false;renderCurrent();}
 };
 commit.onclick=async()=>{
  if(!current()||state.busy||!state.draft||state.receipt)return;
  state.busy=true;state.attempted=true;status.textContent='Committing this event and verifying its journal proof…';render();
  try{
   const receipt=await state.client.submit(state.draft);
   if(session!==state)return;
   state.receipt=receipt;state.busy=false;
   const active=state.view;if(active?.current())await active.onCommitted(receipt);
  }catch{if(current())status.textContent='Result not confirmed. Retry this exact event or download its record. Keep this tab open; do not create a replacement adjustment.';}
  finally{state.busy=false;renderCurrent();}
 };
 edit.onclick=()=>{if(!current()||state.busy||state.attempted)return;state.draft=null;status.textContent='Unsubmitted review cleared. No journal write occurred.';render();};
 download.onclick=()=>{
  if(!current()||!state.draft||state.busy)return;
  const value={schema:'numina.treasury.adjustment-record.v1',event:state.draft.event,canonicalBody:state.draft.canonicalBody,beforeBalance:state.draft.beforeBalance,afterBalance:state.draft.afterBalance,receipt:state.receipt??null};
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const a=node('a');a.href=url;a.download='Numina-native-adjustment-'+state.draft.event.id+'.json';doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 win.addEventListener('beforeunload',event=>{if(session===state&&(state.busy||(state.attempted&&!state.receipt))){event.preventDefault();event.returnValue='';}});
 Object.assign(view,{render,current,onCommitted});
 render();return {section};
}
