import {FINANCIAL_SERVICES,FINANCIAL_DOCUMENT_KINDS,assessFinancialEvidence} from './financial-model.js';
import {requestJson} from './http-client.js';
const financialForm=document.querySelector('#financial-form'),financialFields=document.querySelector('#financial-fields'),financialNotice=document.querySelector('#financial-notice'),financialGrid=document.querySelector('#financial-grid'),financialList=document.querySelector('#financial-records');
const financialNode=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
let financialRecords=[],financialNext=null,financialBusy=false,financialOwner=false;
function financialMessage(text){financialNotice.textContent=text;}
function financialCanonical(value){return JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);}
function financialLock(busy){financialBusy=busy;financialFields.disabled=busy||!financialOwner;document.querySelector('#financial-refresh').disabled=busy;document.querySelector('#financial-more').disabled=busy||!financialNext;document.querySelector('#financial-export').disabled=busy||!financialOwner;}
function financialDraw(){
  financialGrid.replaceChildren();for(const item of assessFinancialEvidence(financialRecords)){
    const card=financialNode('article','');card.className='financial-card';const list=financialNode('ul','');for(const kind of item.missing)list.append(financialNode('li',FINANCIAL_DOCUMENT_KINDS[kind]));
    card.append(financialNode('h3',item.name),financialNode('p',item.documents+' documents loaded · '+item.expired+' expired'),financialNode('strong',item.missing.length?'Missing from loaded records':'Documents present for review'),list);financialGrid.append(card);
  }
  financialList.replaceChildren();for(const record of financialRecords){const item=financialNode('li','');item.append(financialNode('strong',FINANCIAL_DOCUMENT_KINDS[record.evidence.kind]+' · '+FINANCIAL_SERVICES[record.evidence.service].name),financialNode('p',record.evidence.provider+' · '+record.evidence.entity+' · '+record.evidence.jurisdictions.join(', ')),financialNode('p','Owner submitted · Not independently verified'),financialNode('small','Recorded '+new Date(record.receivedAt).toLocaleString()+' · SHA-256 '+record.id));const link=financialNode('a','Download private supporting document');link.href='/api/control/v1/treasury-documents/'+record.evidence.documentId;item.append(link);financialList.append(item);}
  if(!financialRecords.length)financialList.append(financialNode('li',financialOwner?'No supporting evidence has been registered.':'Sign in as the Numina owner to load private evidence.'));
  document.querySelector('#financial-more').hidden=!financialNext;
}
function financialReport(error){if(error.status===401||error.status===403){financialOwner=false;financialRecords=[];financialNext=null;financialDraw();financialMessage('Owner sign-in is required for private evidence. Reviewer accounts keep access to their own service records.');}else financialMessage('The request could not be completed: '+(error.code||'connection unavailable')+'. Your entries are preserved. Refresh records before retrying a save.');}
async function financialLoad(append=false){if(financialBusy)return;financialLock(true);try{const page=await requestJson('/api/financial/v1/evidence'+(append&&financialNext?'?cursor='+encodeURIComponent(financialNext):''));financialOwner=true;financialRecords=append?[...new Map([...financialRecords,...page.records].map(r=>[r.id,r])).values()]:page.records;financialNext=page.nextCursor;financialDraw();financialMessage(financialRecords.length+' records loaded.'+(financialNext?' More records are available; load them before assessing full coverage.':' All registered records are loaded.')+' Issuer verification remains a separate review.');}catch(error){financialReport(error);}finally{financialLock(false);}}
for(const [id,item]of Object.entries(FINANCIAL_SERVICES)){const option=financialNode('option',item.name);option.value=id;financialForm.elements.service.append(option);}
function financialKinds(){const select=financialForm.elements.kind;select.replaceChildren();for(const id of FINANCIAL_SERVICES[financialForm.elements.service.value].required){const option=financialNode('option',FINANCIAL_DOCUMENT_KINDS[id]);option.value=id;select.append(option);}}
financialForm.elements.service.addEventListener('change',financialKinds);financialKinds();financialDraw();
document.querySelector('#financial-refresh').addEventListener('click',()=>financialLoad());document.querySelector('#financial-more').addEventListener('click',()=>financialLoad(true));
financialForm.addEventListener('submit',async event=>{
  event.preventDefault();if(financialBusy||!financialOwner||!financialForm.reportValidity())return;financialLock(true);
  try{
    const file=financialForm.elements.document.files[0];if(!file||file.size>10*1024*1024)throw Object.assign(Error(),{code:'DOCUMENT_MAXIMUM_10_MB'});
    const type=/\.pdf$/i.test(file.name)?'application/pdf':/\.png$/i.test(file.name)?'image/png':/\.jpe?g$/i.test(file.name)?'image/jpeg':null;if(!type)throw Object.assign(Error(),{code:'USE_PDF_PNG_OR_JPEG'});
    financialMessage('Storing the private supporting document…');const receipt=await requestJson('/api/control/v1/treasury-documents',{method:'POST',headers:{'Content-Type':type,'X-Document-Name':encodeURIComponent(file.name)},body:file,timeoutMs:30000});
    const fields=Object.fromEntries(['service','kind','entity','provider','relationship','reference','sourceUrl','expiresOn','note'].map(key=>[key,financialForm.elements[key].value.trim()]));fields.jurisdictions=financialForm.elements.jurisdictions.value.toUpperCase().split(',').map(x=>x.trim()).filter(Boolean);fields.documentId=receipt.document.id;
    financialMessage('Registering the document and provider details…');const saved=await requestJson('/api/financial/v1/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:financialCanonical(fields)});
    financialRecords=[saved.record,...financialRecords.filter(record=>record.id!==saved.record.id)];financialDraw();financialMessage(saved.replayed?'This exact document registration already exists.':'Document registered. Its content and operating authority still need independent review.');
  }catch(error){financialReport(error);}finally{financialLock(false);}
});
document.querySelector('#financial-export').addEventListener('click',async()=>{
  if(financialBusy||!financialOwner)return;financialLock(true);try{
    const pages=[];let cursor=null;do{const page=await requestJson('/api/financial/v1/review-packet'+(cursor?'?cursor='+encodeURIComponent(cursor):''));pages.push(page);cursor=page.nextCursor;if(pages.length>=20&&cursor)throw Object.assign(Error(),{code:'EXPORT_TOO_LARGE'});}while(cursor);
    const records=[...new Map(pages.flatMap(page=>page.records).map(record=>[record.id,record])).values()];const packet={schema:'numina.financial-review-export.v1',generatedAt:new Date().toISOString(),package:'xyz.numinalabs.app',records,assessment:assessFinancialEvidence(records),verification:'owner_submitted_documents_not_independently_verified',readyForPlaySubmission:false,financialExecution:false};
    const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)+'\n'],{type:'application/json'})),link=financialNode('a','');link.href=url;link.download='numina-financial-review-packet.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);financialMessage('Private review packet downloaded. It contains provider details and document references; share it only with authorized reviewers.');
  }catch(error){financialReport(error);}finally{financialLock(false);}
});
