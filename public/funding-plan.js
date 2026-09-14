const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
export async function renderFundingPlan(target,treasury,api,refresh,{signal}={}){
  const readReceipt=async path=>{const receipt=await api(path,undefined,{signal});if(signal?.aborted)throw Error('Request cancelled.');return receipt;};
  target.replaceChildren(node('h3','Canonical funding plan'));
  const evidence=node('button','Read signed treasury evidence');evidence.className='button secondary';
  evidence.onclick=async()=>{evidence.disabled=true;try{const receipt=await readReceipt('treasury/evidence');const details=node('details','');details.open=true;details.append(node('summary','Native proof, provider observation and supporting documents'),node('p','This Numina signature binds the captured records. Bank funding has its own verification status.'),node('pre',JSON.stringify(receipt,null,2)));target.append(details);}catch(error){if(signal?.aborted)return;target.append(node('p',error.message));}finally{evidence.disabled=false;}};
  target.append(evidence);
  const plan=treasury.fundingPlan;
  if(!plan){
    target.append(node('p','Record one funding target from the canonical NUSD projection, shared across the designated accounts. Numina binds the plan, journal event and signature in one receipt.'));
    const button=node('button','Record authorized funding plan');button.className='button secondary';button.disabled=!treasury.treasury.projection;
    button.onclick=async()=>{if(button.disabled)return;button.disabled=true;try{const latest=await api('state');await api('treasury/funding',{id:crypto.randomUUID(),expectedRevision:latest.revision,data:{id:'numina-canonical-funding-v1',reason:'Owner-authorized funding plan for the singular NUSD treasury across designated business accounts; external funding remains unconfirmed.'}});await refresh();}catch(error){if(signal?.aborted)return;target.append(node('p',error.message));button.disabled=false;}};target.append(button);return;
  }
  const nativeTarget=treasury.nativeFundingView?.nativeTarget??plan.target;
  target.append(node('p',BigInt(nativeTarget.amount).toLocaleString()+' '+nativeTarget.unit+' · One native treasury shared across account views'));
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
