const docElement=id=>document.getElementById(id),docEndpoint='/api/control/v1/treasury-documents';
let docGeneration=0,docController=null,docOwnerActive=false,docReady=false,docLoading=false,docUploading=false,docCursor=null;
const docItems=new Map();
const docNode=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
function docControls(){docElement('document-file').disabled=!docReady||docUploading||docLoading;docElement('document-upload').disabled=!docReady||docUploading||docLoading;docElement('document-more').disabled=docLoading||docUploading;}
export function clearTreasuryDocuments(){docGeneration++;docController?.abort();docController=null;docOwnerActive=false;docReady=false;docLoading=false;docUploading=false;docCursor=null;docItems.clear();docElement('treasury-document-panel').hidden=true;docElement('document-list').replaceChildren();docElement('document-form').reset();docElement('document-message').textContent='';docElement('document-summary').textContent='Documents not loaded.';docElement('document-more').hidden=true;docControls();}
function docValid(item){return item&&/^[a-f0-9]{64}$/.test(item.id)&&item.sha256===item.id&&typeof item.name==='string'&&item.name.length<=160&&Number.isSafeInteger(item.size)&&item.size>0&&item.size<=10*1024*1024&&Number.isFinite(Date.parse(item.received_at))&&item.classification==='owner_uploaded_unverified'&&item.bank_issuer_verified===false;}
function docRender(){
 const list=docElement('document-list');list.replaceChildren();
 for(const item of docItems.values()){
  const row=docNode('li',''),link=docNode('a','Download '+item.name);link.href=docEndpoint+'/'+item.id;link.download=item.name;
  row.append(link,docNode('p',new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(item.size/1024)+' KB · Received '+new Date(item.received_at).toLocaleString()),docNode('p','Stored file — contents and bank origin unverified.'));
  const details=docNode('details','');details.append(docNode('summary','File fingerprint'),docNode('code',item.sha256),docNode('p','This fingerprint identifies the uploaded bytes. It does not verify the document’s claims.'));row.append(details);list.append(row);
 }
 docElement('document-summary').textContent=docItems.size?docItems.size+' supporting '+(docItems.size===1?'document':'documents')+' received'+(docCursor?' loaded; more available.':'.'):docCursor?'No documents on this page; more results are available.':'No supporting documents received.';
 docElement('document-more').hidden=!docCursor;
}
function docDenied(status){if(status===401||status===403){document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return true;}return false;}
async function docRequest(url,options,timeout){
 const session=docController,controller=new AbortController(),abort=()=>controller.abort();
 if(!session||session.signal.aborted)controller.abort();else session.signal.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeout);
 try{const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal});const data=response.status===401||response.status===403?null:await response.json();return {status:response.status,ok:response.ok,data};}
 finally{clearTimeout(timer);session?.signal.removeEventListener('abort',abort);}
}
async function docFetchPage(append=false){
 const generation=docGeneration;if(!docOwnerActive||docLoading)return;docLoading=true;docControls();
 try{
  const response=await docRequest(docEndpoint+(append&&docCursor?'?cursor='+encodeURIComponent(docCursor):''),{},15000);
  if(generation!==docGeneration)return;if(docDenied(response.status))return;if(!response.ok)throw Error('Documents unavailable');
  const data=response.data;if(generation!==docGeneration)return;
  if(data.schema!=='numina.supporting_documents.v1'||!Array.isArray(data.documents)||!data.documents.every(docValid)||(data.next_cursor!==null&&typeof data.next_cursor!=='string')||data.financial_execution!==false)throw Error('Invalid document receipt');
  if(!append)docItems.clear();for(const item of data.documents)docItems.set(item.id,item);docCursor=data.next_cursor;docReady=true;docRender();
 }catch{if(generation===docGeneration){docReady=false;docElement('document-summary').textContent='Documents unavailable. Receipt could not be checked.';}}
 finally{if(generation===docGeneration){docLoading=false;docControls();}}
}
export async function loadTreasuryDocuments(){docOwnerActive=true;docController=new AbortController();docElement('treasury-document-panel').hidden=false;docElement('document-summary').textContent='Checking received documents…';await docFetchPage();}
docElement('document-more').onclick=()=>docFetchPage(true);
docElement('document-form').onsubmit=async event=>{
 event.preventDefault();if(!docOwnerActive||!docReady||docUploading||docLoading)return;
 const file=docElement('document-file').files?.[0];if(!file){docElement('document-message').textContent='Choose a PDF, PNG or JPEG file.';return;}
 const type=/\.pdf$/i.test(file.name)?'application/pdf':/\.png$/i.test(file.name)?'image/png':/\.jpe?g$/i.test(file.name)?'image/jpeg':null;
 if(!type||!file.size||file.size>10*1024*1024){docElement('document-message').textContent='Choose a nonempty PDF, PNG or JPEG no larger than 10 MiB.';return;}
 const generation=docGeneration;docUploading=true;docControls();docElement('document-message').textContent='Uploading privately…';
 try{
  const response=await docRequest(docEndpoint,{method:'POST',headers:{'Content-Type':type,'X-Document-Name':encodeURIComponent(file.name)},body:file},45000);
  if(generation!==docGeneration)return;if(docDenied(response.status))return;
  const result=response.data;if(generation!==docGeneration)return;
  if(!response.ok){const messages={DOCUMENT_TOO_LARGE:'The file exceeds 10 MiB.',DOCUMENT_FORMAT_MISMATCH:'The file contents do not match its PDF, PNG or JPEG format.',INVALID_DOCUMENT_NAME:'Use a file name under 160 UTF-8 bytes without path characters.',DOCUMENT_TYPE_NOT_SUPPORTED:'Choose a PDF, PNG or JPEG.',EMPTY_DOCUMENT:'The file is empty.'};throw Object.assign(Error(messages[result.error]||'Receipt could not be confirmed. Use Refresh state before retrying.'),{userMessage:true});}
  if(!docValid(result.document))throw Error('Receipt could not be confirmed. Use Refresh state before retrying.');
  docElement('document-form').reset();docElement('document-message').textContent=result.replayed?'This exact file was already received. No duplicate was created.':'File received privately. Its contents and bank origin have not been verified.';
  await docFetchPage(false);
 }catch(error){if(generation===docGeneration)docElement('document-message').textContent=error.userMessage?error.message:'Receipt could not be confirmed. Use Refresh state before retrying.';}
 finally{if(generation===docGeneration){docUploading=false;docControls();}}
};
