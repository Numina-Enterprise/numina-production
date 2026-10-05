import {requestJson} from './http-client.js';
const opsPath='/api/control/v2/operations/notices';
const opsCanonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(opsCanonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+opsCanonical(value[key])).join(',')+'}';
async function opsDigest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(opsCanonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
export function createOperationsClient({request=requestJson,onChange=()=>{},onAccessLost=()=>{}}={}){
 let generation=0,controller=new AbortController(),state={status:'idle',view:null,pending:null,message:'Private records are not loaded.',receipt:null};
 const emit=(change)=>{state={...state,...change};onChange(structuredClone(state));};
 const reset=()=>{generation++;controller.abort();controller=new AbortController();return generation;};
 const clear=()=>{reset();emit({status:'idle',view:null,pending:null,receipt:null,message:'Private records cleared.'});};
 const denied=error=>error.status===401||error.status===403;
 const accessLost=()=>{reset();emit({status:'unauthorized',view:null,pending:null,receipt:null,message:'Owner sign-in is required.'});onAccessLost();};
 const validView=view=>view?.schema==='numina.operations-inbox.v1'&&Number.isSafeInteger(view.revision)&&/^[a-f0-9]{64}$/.test(view.head)&&Array.isArray(view.notices)&&Array.isArray(view.rooms)&&Array.isArray(view.templates)&&view.delivery==='not_configured';
 async function load(){
  if(state.pending?.submitted)return reconcile();
  const current=reset();emit({status:'loading',view:null,pending:null,receipt:null,message:'Loading private records…'});
  try{const view=await request(opsPath,{signal:controller.signal});if(current!==generation)return;if(!validView(view))throw Error('Invalid inbox response');emit({status:'ready',view,message:view.notices.length?'Current owner records loaded.':'No notices recorded yet.'});}
  catch(error){if(current!==generation)return;if(denied(error))accessLost();else emit({status:'error',view:null,message:'Records unavailable. Freshness is unknown. Refresh to try again.'});}
 }
 function prepare(data){
  if(state.status!=='ready'||!state.view||state.pending)throw Error('Refresh and review current records first.');
  emit({status:'review',pending:{command:{id:crypto.randomUUID(),expectedRevision:state.view.revision,data:structuredClone(data)},submitted:false},receipt:null,message:'Review the complete change before recording it.'});
 }
 function dismiss(){if(state.status==='review')emit({status:'ready',pending:null,message:'Review cancelled. No write was attempted.'});}
 async function verifiedReceipt(receipt,command){
  const p=receipt?.payload;
  return receipt?.schema==='numina.provenance-receipt.v2'&&p?.type==='frontier.operations_notice'&&p.eventId===command.id&&p.commandHash===await opsDigest({...command,type:'frontier.operations_notice'})&&p.result?.recorded===true&&p.result.delivery==='not_configured';
 }
 async function confirmed(receipt,current){
  if(current!==generation)return;
  emit({pending:null,receipt,message:'Recorded in the private journal.'});
  await load();if(current+1===generation&&state.status==='ready')emit({receipt,message:'Recorded in the private journal. External delivery is not configured.'});
 }
 async function reconcile(){
  const pending=state.pending;if(!pending?.submitted||state.status==='saving'||state.status==='reconciling')return;
  const current=generation;emit({status:'reconciling',view:null,message:'Checking the existing command receipt before any retry…'});
  try{
   const receipt=await request('/api/control/v2/receipts/'+encodeURIComponent(pending.command.id),{signal:controller.signal});if(current!==generation)return;
   if(!await verifiedReceipt(receipt,pending.command))throw Error('Receipt mismatch');if(current!==generation)return;await confirmed(receipt,current);
  }catch(error){
   if(current!==generation)return;if(denied(error)){accessLost();return;}
   if(error.status===404){
    try{const view=await request(opsPath,{signal:controller.signal});if(current!==generation)return;if(!validView(view))throw Error('Invalid inbox response');
     if(view.revision!==pending.command.expectedRevision){emit({status:'stale',view:null,pending:null,message:'The journal changed. Refresh and review a new command.'});return;}
     emit({status:'retry_review',view,message:'No receipt was found and the journal revision is unchanged. Review before retrying the exact same command.'});return;
    }catch(readError){if(current!==generation)return;if(denied(readError)){accessLost();return;}}
   }
   emit({status:'unknown',view:null,message:'Write outcome is unknown. Check this command again before making another change.'});
  }
 }
 async function save(){
  if(!['review','retry_review'].includes(state.status)||!state.pending)return;
  const current=generation,command=structuredClone(state.pending.command);emit({status:'saving',pending:{command,submitted:true},message:'Recording the reviewed change…'});
  try{const value=await request(opsPath,{signal:controller.signal,method:'POST',headers:{'Content-Type':'application/json'},body:opsCanonical(command)});if(current!==generation)return;if(!await verifiedReceipt(value.receipt,command))throw Error('Receipt mismatch');if(current!==generation)return;await confirmed(value.receipt,current);}
  catch(error){
   if(current!==generation)return;if(denied(error)){accessLost();return;}
   if(error.code==='STALE_REVISION'){emit({status:'stale',view:null,pending:null,message:'The journal changed. Refresh and review a new command.'});return;}
   if(['NOTICE_CAPACITY','NOTICE_HISTORY_CAPACITY','NOTICE_BYTE_CAPACITY'].includes(error.code)){emit({status:'capacity',view:null,pending:null,message:'The private record capacity was reached. Refresh to review existing records. No records were removed.'});return;}
   if(error.status>=400&&error.status<500&&![408,429].includes(error.status)){emit({status:'error',view:null,pending:null,message:'Change rejected: '+(error.code||'Invalid request')+'. Refresh and review again.'});return;}
   emit({status:'unknown',view:null,message:'Checking whether the command was recorded…'});await reconcile();
  }
 }
 return {load,prepare,dismiss,save,reconcile,clear};
}
