import {MAX_RECEIPT_BYTES,reviewReceiptText,receiptEvidenceTemplate} from './receipt-intake-model.js';

function save(value,name,doc,win){
 const url=win.URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
 const a=doc.createElement('a');a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();
 win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);
}
const messages={RECEIPT_REQUIRED:'Paste or select the public observation JSON first.',RECEIPT_TOO_LARGE:'Use an observation file no larger than 2 MiB.',RECEIPT_JSON_INVALID:'The input is not valid JSON. Keep the original and check its format.',RECEIPT_STRUCTURE_INVALID:'Use the observation structure shown in the required-fields template.',RECEIPT_SCHEMA_UNSUPPORTED:'Use the required-fields template to structure the actual observations. A receipt or review report alone is not sufficient.',RECEIPT_PROFILE_MISMATCH:'This checker covers the pinned 1,500T constructor mint only. Do not use a different amount, policy or later mint operation.',PRIVATE_MATERIAL_NOT_ACCEPTED:'Wallet or secret material is not accepted. It has been cleared; select public transaction observations only.'};

export function mountReceiptIntake({doc=document,win=window,review=reviewReceiptText,download=save}={}){
 const $=id=>doc.getElementById('receipt-intake-'+id),input=$('text'),file=$('file');
 let alive=true,generation=0,busy=false,record=null;
 function render(){if(!alive)return;$('check').disabled=busy||!input.value.trim();$('download').disabled=busy||!record;$('result').hidden=!record;}
 function reset(message){generation++;busy=false;record=null;$('result').textContent='';$('status').textContent=message;render();}
 input.oninput=()=>reset('Ready to check the supplied observations.');
 file.onchange=async()=>{
  if(!alive)return;reset('Reading public observations locally…');const token=generation,selected=file.files?.[0];
  input.value='';file.value='';render();if(!selected){reset('No observation file selected.');return;}
  busy=true;render();
  try{
   if(!Number.isSafeInteger(selected.size)||selected.size<1||selected.size>MAX_RECEIPT_BYTES)throw Object.assign(new Error(),{code:'RECEIPT_TOO_LARGE'});
   const buffer=await selected.arrayBuffer();if(!alive||generation!==token)return;
   if(buffer.byteLength>MAX_RECEIPT_BYTES)throw Object.assign(new Error(),{code:'RECEIPT_TOO_LARGE'});
   const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
   if(text.length>MAX_RECEIPT_BYTES||new TextEncoder().encode(text).length>MAX_RECEIPT_BYTES)throw Object.assign(new Error(),{code:'RECEIPT_TOO_LARGE'});
   input.value=text;$('status').textContent='Public observations loaded on this device. Select Check receipt to review them.';
  }catch(error){if(alive&&generation===token)$('status').textContent=messages[error.code]||'The selected file could not be read.';}
  finally{if(alive&&generation===token){busy=false;render();}}
 };
 $('check').onclick=async()=>{
  if(!alive||busy||!input.value.trim())return;
  record=null;$('result').textContent='';const token=++generation,text=input.value;busy=true;$('status').textContent='Checking the transaction, mint event and supplied chain observations…';render();
  try{
   const checked=await review(text);if(!alive||generation!==token)return;record=checked;
   $('result').textContent=JSON.stringify(checked,null,2);
   $('status').textContent=checked.result.valid
    ?'Supplied observations are consistent with the pinned 1,500T NUSD deployment and treasury recipient. This local check does not independently authenticate the chain or establish USD/USDC settlement.'
    :'Receipt checks did not pass: '+checked.result.errors.join(', ')+'. No confirmed mint has been recorded by this checker.';
  }catch(error){if(alive&&generation===token){if(error.code==='PRIVATE_MATERIAL_NOT_ACCEPTED')input.value='';$('status').textContent=messages[error.code]||'The observations could not be checked. Keep the original for review.';}}
  finally{if(alive&&generation===token){busy=false;render();}}
 };
 $('download').onclick=()=>{if(alive&&!busy&&record)download(record,'Numina-NUSD-Receipt-Review.json',doc,win);};
 $('template').onclick=()=>{if(alive)download(receiptEvidenceTemplate(),'Numina-NUSD-Receipt-Required-Fields.json',doc,win);};
 $('clear').onclick=()=>{if(!alive)return;input.value='';file.value='';reset('No receipt observations loaded.');};
 const dispose=()=>{if(!alive)return;generation++;busy=false;record=null;input.value='';file.value='';$('result').textContent='';$('status').textContent='No receipt observations loaded.';render();alive=false;win.removeEventListener('pagehide',dispose);};
 win.addEventListener('pagehide',dispose,{once:true});render();return{dispose};
}
if(typeof document!=='undefined'){
 mountReceiptIntake();
 window.addEventListener('pageshow',event=>{if(event.persisted)mountReceiptIntake();});
}
