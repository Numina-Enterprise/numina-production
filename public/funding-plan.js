import {journalTreasuryMetadata} from './treasury-connection-model.js';
const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
export function renderTreasuryReconciliation(receipt,treasury){
  const payload=receipt?.payload,record=payload?.reconciliation,canonical=record?.canonicalTreasury,expected=treasury?.treasury;
  const native=payload?.nativeSettlement,journal=journalTreasuryMetadata(expected?.projection);
  if(record?.schema!=='numina.treasury.reconciliation.v1'||!['NOT_RECONCILED','NOT_INITIALIZED'].includes(record.status)||
    record.capturedAt!==payload.capturedAt||payload.root!==expected?.root||payload.revision!==expected?.revision||payload.head!==expected?.head||
    canonical?.revision!==payload.revision||canonical?.head!==payload.head||canonical?.id!==(treasury?.canonicalTreasury?.id??null)||record.depositReadiness?.status!=='NOT_READY'||
    record.depositReadiness.externalSubmissionImplemented!==false||record.depositReadiness.submissionPerformed!==false||record.depositReadiness.receipt!==null||
    native?.status!==journal.settlementStatus||native.submissionPerformed!==journal.submissionPerformed||native.settlementPerformed!==journal.settlementPerformed||
    (native.receipt?.id??null)!==journal.singularSettlementReceiptId||(native.receipt?.path??null)!==journal.singularSettlementReceipt||
    native.currentJournalProjection?.balance!==journal.journalProjectionBalance||native.currentJournalProjection?.unit!==journal.journalProjectionUnit||
    native.currentJournalProjection?.revision!==expected.revision||native.currentJournalProjection?.head!==expected.head||
    native.currentJournalProjection?.eventId!==(expected.projection?.last_event_id??null))throw Error('Reconciliation does not match this treasury snapshot. Refresh the treasury and try again.');
  const panel=node('section','');panel.className='treasury-reconciliation';
  const status=value=>({VERIFIED:'Native record checked',AUTHENTICATED_OBSERVATION:'Provider observation available',UNAVAILABLE:'Unavailable',NOT_REPORTED:'Not reported',NOT_VERIFIED:'Unverified',BANK_PROVIDER_NOT_CONNECTED:'Bank connection unavailable',ASSET_NOT_VERIFIED:'Asset identity unverified'}[value]??'Unverified');
  panel.append(node('h4','Native settlement and provider observations'),node('p','One native treasury reference · journal revision '+payload.revision),node('p','Snapshot captured '+record.capturedAt));
  const list=node('dl',''),row=(label,value)=>{const group=node('div','');group.append(node('dt',label),node('dd',value));list.append(group);};
  row('Current native settlement',native.status==='SETTLED'?'SETTLED · '+native.receipt.id:'Unverified in current journal');
  if(native.currentJournalProjection.balance!==null)row('Journal NUSD projection',native.currentJournalProjection.balance+' '+native.currentJournalProjection.unit);
  if(native.historicalReceipt?.historicalRecord===true)row('Historical release receipt',native.historicalReceipt.id+' · not current journal confirmation');
  row('Numina-native record',status(record.records?.nativeTreasury?.status));
  for(const unit of ['usd','usdc'])row('Stripe '+unit.toUpperCase()+' available balance',status(record.records?.stripe?.currencies?.[unit]?.balances?.available?.verification?.status));
  row('Bank of America',status(record.records?.bank?.status));
  const documents=record.records?.supportingDocuments;
  row('Supporting documents',documents?.status==='OWNER_UPLOADED_UNVERIFIED'?'Stored files; issuer and contents unverified'+(documents.complete?'':' (partial list)'):'Unavailable');
  row('External provider submission','Not ready for submission');
  panel.append(list,node('p','Funding source, reserve allocation and provider acceptance remain required for submission. Settlement evidence is required to confirm completion after submission. A shared native reference is counted once; these checks do not move funds.'));
  const guide=node('a','Provider confirmation requirements');guide.href='/downloads/Provider-Confirmation-Request-v4.md';panel.append(guide);
  return panel;
}
export async function renderFundingPlan(target,treasury,api,refresh,{signal}={}){
  const readReceipt=async path=>{const receipt=await api(path,undefined,{signal});if(signal?.aborted)throw Error('Request cancelled.');return receipt;};
  target.replaceChildren(node('h3','Canonical funding plan'));
  const evidence=node('button','Read treasury reconciliation and evidence');evidence.className='button secondary';
  const evidenceResult=node('div','');
  evidence.onclick=async()=>{evidence.disabled=true;evidenceResult.replaceChildren();try{const receipt=await readReceipt('treasury/evidence');const summary=renderTreasuryReconciliation(receipt,treasury),details=node('details','');details.append(node('summary','Inspect source records and Numina signature'),node('p','The server returns a signed snapshot of these records. Provider funding has its own verification status.'),node('pre',JSON.stringify(receipt,null,2)));evidenceResult.replaceChildren(summary,details);}catch(error){if(signal?.aborted)return;evidenceResult.replaceChildren(node('p',error.message));}finally{evidence.disabled=false;}};
  target.append(evidence,evidenceResult);
  const plan=treasury.fundingPlan;
  if(!plan){
    target.append(node('p','Record one funding target from the canonical NUSD projection, shared across the designated accounts. Numina binds the plan, journal event and signature in one receipt.'));
    const button=node('button','Record authorized funding plan');button.className='button secondary';button.disabled=!treasury.treasury.projection;
    button.onclick=async()=>{if(button.disabled)return;button.disabled=true;try{const latest=await api('state');await api('treasury/funding',{id:crypto.randomUUID(),expectedRevision:latest.revision,data:{id:'numina-canonical-funding-v1',reason:'Owner-authorized funding plan for the singular NUSD treasury across designated business accounts; external funding remains unconfirmed.'}});await refresh();}catch(error){if(signal?.aborted)return;target.append(node('p',error.message));button.disabled=false;}};target.append(button);return;
  }
  const treasuryLink=node('a','View the canonical native treasury ↗');treasuryLink.href='/api/control/v1/treasury';target.append(treasuryLink);
  target.append(node('p','Current native funding status · '+treasury.nativeFundingView.status+' · '+(treasury.nativeFundingView.ownerDeclaredFunded?'Owner declaration':'Recorded plan')));
  target.append(node('p','Original plan status · '+plan.status));
  target.append(node('p','Numina record · '+plan.id+' · Journal event '+plan.eventId));
  const button=node('button','Read signed plan receipt');button.className='button secondary';
  button.onclick=async()=>{button.disabled=true;try{const receipt=await readReceipt('receipts/'+plan.eventId);const details=node('details','');details.open=true;details.append(node('summary','Internal funding-plan provenance'),node('pre',JSON.stringify(receipt,null,2)));target.append(details);}catch(error){if(signal?.aborted)return;target.append(node('p',error.message));button.disabled=false;}};
  target.append(button);
  const declaration=treasury.fundingDeclaration;
  if(declaration){
    target.append(node('p','Owner declaration · Journal event '+declaration.eventId));
    const proof=node('button','Read signed owner declaration');proof.className='button secondary';
    proof.onclick=async()=>{proof.disabled=true;try{const receipt=await readReceipt('receipts/'+declaration.eventId);const details=node('details','');details.open=true;details.append(node('summary','Owner-declaration provenance'),node('pre',JSON.stringify(receipt,null,2)));target.append(details);}catch(error){if(signal?.aborted)return;target.append(node('p',error.message));proof.disabled=false;}};target.append(proof);
  }else{
    const declare=node('button','Record FUNDED_PLAN owner declaration');declare.className='button secondary';
    declare.onclick=async()=>{if(declare.disabled)return;declare.disabled=true;try{const latest=await api('state');await api('treasury/funding-declaration',{id:crypto.randomUUID(),expectedRevision:latest.revision,data:{FUNDED_PLAN:true,reason:'Owner declares FUNDED_PLAN=true for the Numina internal funding plan. This is an owner statement recorded in the canonical journal.'}});await refresh();}catch(error){if(signal?.aborted)return;target.append(node('p',error.message));declare.disabled=false;}};target.append(declare);
  }
}
