import {createTreasuryPreparation} from './treasury-preparation.js';
import {formatTreasuryRoundedWholeAmount} from './treasury-amount.js';

// Retain exact attempted events across owner-panel refreshes and account switches.
// These in-memory records belong to this tab; no credentials or records are stored.
const windows=new WeakMap();
const reference=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const amountPattern=/^[1-9][0-9]{0,77}$/;
const mint='PREPARE_MINT',bank='PREPARE_BANK_TRANSACTION';
const whole=value=>formatTreasuryRoundedWholeAmount(value,0);
const dollars=value=>formatTreasuryRoundedWholeAmount(value,2);
const emptyInput=()=>({operation:mint,amount:'',networkReference:'',account:'custom',destinationReference:'',reason:''});
const uncertain='Result not confirmed. Retry this exact event or download its record. Keep this tab open; do not create a replacement request.';

export function mountTreasuryPreparation(target,{root,accounts=[],isCurrent=()=>true,onCommitted=async()=>{},onAccessLost=()=>{},doc=document,win=window,clientFactory=createTreasuryPreparation}={}){
 if(!target||typeof root!=='string'||!root)return;
 let tab=windows.get(win);
 if(!tab){
  tab={sessions:new Map(),active:null};windows.set(win,tab);
  win.addEventListener('beforeunload',event=>{
   if([...tab.sessions.values()].some(state=>state.busy||(state.attempted&&!state.receipt))){event.preventDefault();event.returnValue='';}
  });
 }
 let state=tab.sessions.get(root);
 if(!state){state={client:clientFactory(),draft:null,attempted:false,receipt:null,busy:false,input:emptyInput(),message:''};tab.sessions.set(root,state);}
 const view={},current=()=>tab.active===view&&state.view===view&&isCurrent();
 tab.active=view;state.view=view;
 const renderCurrent=()=>state.view?.render();
 const node=(tag,text='')=>{const n=doc.createElement(tag);n.textContent=text;return n;};
 const field=(id,label,tag='input')=>{
  const wrapper=node('label'),caption=node('span',label),input=node(tag);input.id=id;input.name=id;wrapper.append(caption,input);return {wrapper,caption,input};
 };
 const section=node('section');section.className='account-link-form';
 section.append(node('h3','Prepare a treasury request'),node('p','Record a mint or USD bank request in the native journal. A FINAL journal result confirms a PREPARED request only: the native balance stays unchanged, and no token mint or bank deposit is submitted.'));
 const form=node('form');
 const operationField=field('native-preparation-operation','Request type','select'),operation=operationField.input;
 for(const [value,label] of [[mint,'NUSD mint request'],[bank,'USD bank request']]){const option=node('option',label);option.value=value;operation.append(option);}
 const amountField=field('native-preparation-amount','Amount (whole NUSD)'),amount=amountField.input;
 amount.required=true;amount.maxLength=78;amount.inputMode='numeric';amount.autocomplete='off';
 const networkField=field('native-preparation-network','Network reference'),network=networkField.input;
 network.maxLength=128;network.autocomplete='off';
 const accountField=field('native-preparation-account','Bank destination reference','select'),account=accountField.input;
 const custom=node('option','Enter a public destination reference');custom.value='custom';account.append(custom);
 const accountIds=new Set();
 for(const item of Array.isArray(accounts)?accounts:[]){
  if(item?.provider!=='bank-of-america'||item.supersededBy||typeof item.id!=='string'||!reference.test(item.id)||item.id==='custom'||accountIds.has(item.id))continue;
  accountIds.add(item.id);
  const description=item.providerAccountReference?'existing account designation':'existing account designation (provider destination unverified)';
  const option=node('option',[item.legalEntity,item.accountLabel??'Bank of America',description,item.id].filter(Boolean).join(' · '));option.value=item.id;account.append(option);
 }
 const destinationField=field('native-preparation-destination','Public recipient or destination reference'),destination=destinationField.input;
 destination.maxLength=128;destination.autocomplete='off';
 const reasonField=field('native-preparation-reason','Reason for preparing this request'),reason=reasonField.input;reason.required=true;reason.maxLength=1000;
 const prepare=node('button','Review prepared request');prepare.id='native-preparation-review';prepare.type='submit';prepare.className='button secondary';
 form.append(operationField.wrapper,amountField.wrapper,networkField.wrapper,accountField.wrapper,destinationField.wrapper,reasonField.wrapper,prepare);
 const summary=node('p'),status=node('p');summary.id='native-preparation-summary';status.id='native-preparation-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const button=(id,text)=>{const n=node('button',text);n.id=id;n.type='button';n.className='button secondary';return n;};
 const commit=button('native-preparation-commit','Record PREPARED request'),edit=button('native-preparation-edit','Edit unsubmitted request'),next=button('native-preparation-new','New request'),download=button('native-preparation-download','Download request record');commit.className='button';
 const details=node('details'),record=node('pre');record.id='native-preparation-record';details.append(node('summary','Exact request and native journal proof'),record);
 section.append(form,summary,commit,edit,next,download,status,details);target.append(section);
 const recordValue=()=>({schema:'numina.treasury.preparation-record.v1',event:state.draft.event,canonicalBody:state.draft.canonicalBody,beforeBalance:state.draft.beforeBalance,transactionRequest:state.draft.transactionRequest,receipt:state.receipt??null});
 function readFields(){return {operation:operation.value,amount:amount.value.trim(),networkReference:network.value.trim(),account:account.value,destinationReference:destination.value.trim(),reason:reason.value.trim()};}
 function populate(input){operation.value=input.operation;amount.value=input.amount;network.value=input.networkReference;account.value=accountIds.has(input.account)?input.account:'custom';destination.value=input.destinationReference;reason.value=input.reason;}
 function render(){
  if(!current())return;
  const draft=state.draft,receipt=state.receipt;
  if(draft){
   const intent=draft.event.Intent;
   populate({operation:intent.operation,amount:intent.amount??intent.amountMinor,networkReference:intent.networkReference??'',account:intent.operation===bank&&accountIds.has(intent.destinationReference)?intent.destinationReference:'custom',destinationReference:intent.destinationReference,reason:intent.reason});
  }
  const isMint=operation.value===mint,selectedAccount=!isMint&&accountIds.has(account.value),locked=Boolean(draft)||state.busy;
  amountField.caption.textContent=isMint?'Amount (whole NUSD)':'Amount (USD minor units: 100 = $1.00)';
  networkField.wrapper.hidden=!isMint;network.required=isMint;
  accountField.wrapper.hidden=isMint;destinationField.wrapper.hidden=selectedAccount;destination.required=!selectedAccount;
  for(const control of [operation,amount,network,account,destination,reason])control.disabled=locked;
  network.disabled=locked||!isMint;account.disabled=locked||isMint;destination.disabled=locked||selectedAccount;
  prepare.disabled=locked;commit.hidden=!draft||Boolean(receipt);commit.disabled=state.busy;commit.textContent=state.attempted?'Retry exact request':'Record PREPARED request';
  edit.hidden=!draft||state.attempted;edit.disabled=state.busy;next.hidden=!receipt;next.disabled=state.busy;download.hidden=!draft;download.disabled=state.busy;details.hidden=!draft;
  if(draft){
   const intent=draft.event.Intent,display=intent.operation===mint?whole(intent.amount)+' NUSD':dollars(intent.amountMinor)+' USD';
   summary.textContent=display+' · destination '+intent.destinationReference+(intent.networkReference?' · network '+intent.networkReference:'')+' · native balance unchanged: '+whole(draft.beforeBalance)+' NUSD · event '+draft.event.id+' · expected revision '+draft.event.expectedRevision;
   record.textContent=JSON.stringify(recordValue(),null,2);
  }else{summary.textContent='Review the exact request against a fresh verified treasury record. Enter a public reference only; do not enter credentials or bank account numbers.';record.textContent='';}
  if(receipt)status.textContent='FINAL journal record verified · PREPARED request only · revision '+receipt.head_advancement.revision+' · head '+receipt.head_advancement.head+'. Native balance unchanged. No token mint or bank deposit submitted.'+(state.message?' '+state.message:'');
  else if(state.attempted&&!state.busy)status.textContent=uncertain;
  else status.textContent=state.message;
 }
 function accessLost(error){
  if(error?.status!==401&&error?.status!==403)return false;
  const active=state.view;if(active?.current())active.onAccessLost();return true;
 }
 function inputChanged(){if(!current()||state.busy||state.draft)return;state.input=readFields();render();}
 for(const control of [operation,amount,network,account,destination,reason]){control.onchange=inputChanged;control.oninput=inputChanged;}
 form.onsubmit=async event=>{
  event.preventDefault();if(!current()||state.busy||state.draft)return;
  const input=readFields();state.input=input;
  const destinationReference=input.operation===bank&&accountIds.has(input.account)?input.account:input.destinationReference;
  if(![mint,bank].includes(input.operation)||(input.operation===bank&&input.account!=='custom'&&!accountIds.has(input.account))||!amountPattern.test(input.amount)||!reference.test(destinationReference)||(input.operation===mint&&!reference.test(input.networkReference))||!input.reason||input.reason.length>1000||/[\u0000-\u001f]/.test(input.reason)){
   state.message='Enter a positive whole-number amount, a valid public reference and a reason. Mint requests also require a network reference. USD bank amounts are minor units (100 = $1.00).';render();return;
  }
  const intent=input.operation===mint?{operation:mint,amount:input.amount,networkReference:input.networkReference,destinationReference,reason:input.reason}:{operation:bank,amountMinor:input.amount,currency:'USD',destinationReference,reason:input.reason};
  state.busy=true;state.message='Reading and verifying the latest native treasury…';render();
  try{
   const draft=await state.client.prepare(intent);
   if(draft.event.Principal!==root)throw Error('Owner identity changed.');
   state.draft=draft;state.message='Review the exact request and unchanged native balance. Nothing has been written yet.';
  }catch(error){state.message='The request could not be prepared. Check the amount, references, reason and owner access, then try again.';accessLost(error);}
  finally{state.busy=false;renderCurrent();}
 };
 commit.onclick=async()=>{
  if(!current()||state.busy||!state.draft||state.receipt)return;
  state.busy=true;state.attempted=true;state.message='Recording this PREPARED request and verifying its native journal proof…';render();
  try{
   state.receipt=await state.client.submit(state.draft);state.message='';
   const active=state.view;
   if(active?.current())try{await active.onCommitted(state.receipt);}catch(error){state.message='The request record is verified; refreshing the owner view did not complete.';accessLost(error);}
  }catch(error){state.message=uncertain;accessLost(error);}
  finally{state.busy=false;renderCurrent();}
 };
 edit.onclick=()=>{if(!current()||state.busy||!state.draft||state.attempted)return;state.input=readFields();state.draft=null;state.message='Unsubmitted review cleared. No journal write occurred.';render();};
 next.onclick=()=>{if(!current()||state.busy||!state.receipt)return;state.draft=null;state.receipt=null;state.attempted=false;state.input=emptyInput();populate(state.input);state.message='Enter the next request. Review will read a fresh treasury revision and head.';render();};
 download.onclick=()=>{
  if(!current()||!state.draft||state.busy)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(recordValue(),null,2)+'\n'],{type:'application/json'}));
  const a=node('a');a.href=url;a.download='Numina-prepared-request-'+state.draft.event.id+'.json';doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 Object.assign(view,{render,current,onCommitted,onAccessLost});populate(state.input);render();return {section};
}
