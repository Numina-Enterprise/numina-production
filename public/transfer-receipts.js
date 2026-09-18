import {requestJson,createViewScope} from './http-client.js';
export const TRANSFER_RECEIPT_CLIENT_ROUTE='/api/financial/v1/receipts';
export function transferReceiptCanonical(value){
 if(Array.isArray(value))return '['+value.map(transferReceiptCanonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+transferReceiptCanonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
export function transferReceiptStatusLabel(status){return ({VERIFIED_PROVIDER_REPORT:'Provider report matched — bank settlement unverified',VERIFIED_ONCHAIN_TRANSFER:'Finalized USDC event matched — scope limited to the on-chain event',PENDING:'Pending or not found — execution not confirmed',NOT_VERIFIED:'Not verified',UNAVAILABLE:'Verification unavailable'})[status]||'Not verified';}
if(typeof document!=='undefined'&&document.getElementById('transfer-receipt-form')){
 const get=id=>document.getElementById(id),form=get('transfer-receipt-form'),records=get('receipt-records'),scope=createViewScope();let cursor=null,busy=false;
 const status=text=>{get('receipt-status').textContent=text;};
 const clear=()=>{records.replaceChildren();cursor=null;get('receipt-more').hidden=true;};
 const request=(path,options={})=>requestJson(path,{...options,signal:scope.signal,timeoutMs:options.timeoutMs??15000});
 const post=(path,value)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:transferReceiptCanonical(value)});
 function error(error){if(error.name==='AbortError')return;if([401,403].includes(error.status)){scope.reset();clear();form.reset();configure();status('Sign in as the owner to import and verify private evidence.');}else status(error.code||'Evidence service unavailable. No payment was sent.');}
 function configure(){const ach=get('receipt-rail').value==='ACH',bank=get('receipt-provider').value==='bank_document';get('receipt-ach-fields').hidden=!ach;for(const item of get('receipt-ach-fields').querySelectorAll('input,select'))item.disabled=!ach;get('receipt-usdc-fields').hidden=ach;get('receipt-usdc-fields').disabled=ach;get('receipt-reference').required=ach&&!bank;get('receipt-destination-group').hidden=bank;get('receipt-destination').disabled=!ach||bank;get('receipt-destination').required=ach&&!bank;get('receipt-file').required=ach&&bank;}
 async function action(button,operation){if(busy)return;busy=true;button.disabled=true;try{await operation();}catch(e){error(e);}finally{busy=false;button.disabled=false;}}
 function render(record){
  if(record?.schema!=='numina.transfer-receipt-import.v1'||!/^[a-f0-9]{64}$/.test(record.id)||record.classification!=='owner_submitted_unverified')throw Error('Invalid record');
  const article=document.createElement('article'),heading=document.createElement('h3'),summary=document.createElement('p'),detail=document.createElement('pre');
  heading.textContent=record.evidence.rail+' · owner-submitted, unverified';summary.textContent='NUMINA record ID (not a transaction hash): '+record.id;
  detail.textContent=JSON.stringify(record,null,2);article.append(heading,summary,detail);
  const output=document.createElement('pre');output.hidden=true;
  const verify=document.createElement('button');verify.type='button';verify.className='button secondary';verify.textContent='Verify existing transaction (read-only)';
  verify.addEventListener('click',()=>void action(verify,async()=>{const generation=scope.generation;status('Reading trusted evidence; no payment or transaction is submitted.');const result=await post(TRANSFER_RECEIPT_CLIENT_ROUTE+'/'+record.id+'/verify',{});if(!scope.isCurrent(generation))return;output.hidden=false;output.textContent=JSON.stringify(result.observation,null,2);status(transferReceiptStatusLabel(result.observation.verification.status));}));
  const history=document.createElement('a');history.href=TRANSFER_RECEIPT_CLIENT_ROUTE+'/'+record.id+'/verifications';history.textContent='Read saved verification observations ↗';article.append(verify,history,output);records.append(article);
 }
 async function refresh(more=false){
  const generation=scope.generation;if(!more)clear();status('Reading private imported records…');const result=await request(TRANSFER_RECEIPT_CLIENT_ROUTE+(more&&cursor?'?cursor='+encodeURIComponent(cursor):''));
  if(!scope.isCurrent(generation))return;if(!Array.isArray(result.records)||result.financialExecution!==false)throw Error('Invalid evidence response');
  for(const record of result.records)render(record);cursor=result.nextCursor;get('receipt-more').hidden=!cursor;status(records.children.length?'Imported records are separate from server verification observations.':'No imported transfer evidence is recorded.');
 }
 form.addEventListener('submit',event=>{event.preventDefault();void action(get('receipt-import'),async()=>{
  const generation=scope.generation,ach=get('receipt-rail').value==='ACH';let evidence={rail:ach?'ACH':'USDC',requestId:ach?'numina-ach-500t-20260918':'numina-usdc-500t-20260918',amount:'500000000000000'};
  if(ach){
   evidence.provider=get('receipt-provider').value;const reference=get('receipt-reference').value.trim();if(reference)evidence.providerReference=reference;
   if(evidence.provider==='stripe')evidence.destinationReference=get('receipt-destination').value.trim();
   const file=get('receipt-file').files[0];if(file){if(file.size>10485760||!['application/pdf','image/png','image/jpeg'].includes(file.type))throw Object.assign(Error(),{code:'SUPPORTED_DOCUMENT_REQUIRED'});status('Storing the supplied document privately; issuer authenticity remains unverified.');const uploaded=await request('/api/control/v1/treasury-documents',{method:'POST',headers:{'Content-Type':file.type,'X-Document-Name':encodeURIComponent(file.name)},body:file,timeoutMs:25000});if(!scope.isCurrent(generation))return;evidence.documentId=uploaded.document.id;}
  }else Object.assign(evidence,{network:'base',transactionHash:get('receipt-hash').value.trim(),from:get('receipt-from').value.trim(),to:get('receipt-to').value.trim(),logIndex:Number(get('receipt-log').value)});
  status('Importing supplied evidence without asserting execution…');await post(TRANSFER_RECEIPT_CLIENT_ROUTE,evidence);if(!scope.isCurrent(generation))return;form.reset();configure();await refresh();
 });});
 get('receipt-rail').addEventListener('change',configure);get('receipt-provider').addEventListener('change',configure);
 get('receipt-refresh').addEventListener('click',()=>void action(get('receipt-refresh'),()=>refresh()));get('receipt-more').addEventListener('click',()=>void action(get('receipt-more'),()=>refresh(true)));
 window.addEventListener('pagehide',()=>{scope.reset();clear();form.reset();configure();});window.addEventListener('pageshow',event=>{if(event.persisted)void refresh().catch(error);});configure();void refresh().catch(error);
}
