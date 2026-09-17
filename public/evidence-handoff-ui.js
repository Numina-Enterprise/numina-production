import {MAX_POLICY_BYTES,identifyPolicy,createEvidenceHandoff} from './evidence-handoff-model.js';
import {NUMINA_OWNER_APPROVAL} from './owner-approval.js';

function save(record,doc,win){
 const url=win.URL.createObjectURL(new Blob([JSON.stringify(record,null,2)+'\n'],{type:'application/json'}));
 const a=doc.createElement('a');a.href=url;a.download='Numina-Evidence-Handoff.json';doc.body.append(a);a.click();a.remove();
 win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);
}
export function mountEvidenceHandoff({doc=document,win=window,identify=identifyPolicy,create=createEvidenceHandoff,download=save}={}){
 const $=id=>doc.getElementById('evidence-'+id);
 $('owner-statement').textContent=NUMINA_OWNER_APPROVAL.issuerPolicySigningStatement?.ownerReportsSigned===true?'Recorded owner statement: issuer policy signed. The signed document and signature still require verification.':'No owner signing statement is recorded in this release.';
 let alive=true,generation=0,busy=false,policy=null,record=null;
 function render(){if(!alive)return;$('create').disabled=busy;$('download').disabled=busy||!record;$('result').hidden=!record;}
 function invalidate(message='Changes need a new record.'){record=null;$('result').textContent='';$('status').textContent=message;render();}
 for(const name of ['signed','operation','hash','reference']){$(name).oninput=()=>invalidate();$(name).onchange=()=>invalidate();}
 $('policy').onchange=async()=>{
  if(!alive)return;const selected=$('policy').files?.[0],token=++generation;policy=null;$('policy').value='';
  $('policy-status').textContent='No policy document selected.';busy=false;invalidate();
  if(!selected)return;busy=true;render();$('policy-status').textContent='Identifying the selected document locally…';
  try{
   if(!Number.isSafeInteger(selected.size)||selected.size<1||selected.size>MAX_POLICY_BYTES)throw Error('Select a policy document between 1 byte and 2 MiB.');
   const bytes=await selected.arrayBuffer();if(!alive||token!==generation)return;
   const identified=await identify(new Uint8Array(bytes));if(!alive||token!==generation)return;policy=identified;
   $('policy-status').textContent='SHA-256: '+policy.sha256+' · '+policy.bytes+' bytes. '+(policy.exactPublishedPolicyBytes?'Exact published policy bytes; signature is not checked.':'Different bytes from the prepared request. Review the signed document and its policy binding before changing contract pins.');
  }catch(error){if(alive&&token===generation)$('policy-status').textContent=error.message||'The document could not be identified.';}
  finally{if(alive&&token===generation){busy=false;render();}}
 };
 $('create').onclick=()=>{
  if(!alive||busy)return;invalidate();
  try{record=create({policy,ownerReportsSigned:$('signed').checked,operation:$('operation').value,transactionHash:$('hash').value,providerReference:$('reference').value});
   $('result').textContent=JSON.stringify(record,null,2);$('status').textContent='Reference record created locally. Signature, transaction and settlement verification remain pending.';
  }catch(error){$('status').textContent=error.message||'The reference record could not be created.';}render();
 };
 $('download').onclick=()=>{if(alive&&!busy&&record)download(record,doc,win);};
 function clear(){generation++;busy=false;policy=null;record=null;$('policy').value='';$('signed').checked=false;$('operation').value='none';$('hash').value='';$('reference').value='';$('policy-status').textContent='No policy document selected.';invalidate('No evidence record created.');}
 $('clear').onclick=()=>{if(alive)clear();};
 const dispose=()=>{if(!alive)return;clear();alive=false;win.removeEventListener('pagehide',dispose);};
 win.addEventListener('pagehide',dispose,{once:true});render();return {dispose};
}
if(typeof document!=='undefined'){mountEvidenceHandoff();window.addEventListener('pageshow',event=>{if(event.persisted)mountEvidenceHandoff();});}
