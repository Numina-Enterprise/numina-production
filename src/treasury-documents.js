import {controlHash,controlError} from './control.js';

export const TREASURY_DOCUMENT_LIMIT=10*1024*1024;
const treasuryDocumentHeaders={'Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'};
function treasuryDocumentResponse(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...treasuryDocumentHeaders,'Content-Type':'application/json'}});}
function treasuryDocumentName(raw){
 let name;try{name=decodeURIComponent(raw||'');}catch{controlError('INVALID_DOCUMENT_NAME',400);}
 if(!name||name!==name.trim()||new TextEncoder().encode(name).length>160||/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/.test(name)||!/[.](pdf|png|jpe?g)$/i.test(name))controlError('INVALID_DOCUMENT_NAME',400);
 return name;
}
function treasuryDocumentReceipt(object,prefix){
 const m=object?.customMetadata,id=object?.key?.slice(prefix.length);
 if(!object?.key?.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(id)||m?.schema!=='numina.supporting_document.v1'||m.sha256!==id||Number(m.size)!==object.size||object.size<1||object.size>TREASURY_DOCUMENT_LIMIT||!Number.isFinite(Date.parse(m.received_at))||!['application/pdf','image/png','image/jpeg'].includes(m.content_type))controlError('DOCUMENT_RECORD_UNAVAILABLE',503);
 return {id,name:treasuryDocumentName(m.encoded_name),size:object.size,content_type:m.content_type,sha256:id,received_at:m.received_at,classification:'owner_uploaded_unverified',bank_issuer_verified:false,independent_verification:'not_completed'};
}
async function treasuryDocumentBytes(req){
 if(req.headers.has('content-encoding'))controlError('ENCODED_DOCUMENT_NOT_SUPPORTED',415);
 const declared=req.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>TREASURY_DOCUMENT_LIMIT))controlError('DOCUMENT_TOO_LARGE',413);
 const reader=req.body?.getReader();if(!reader)controlError('EMPTY_DOCUMENT',400);
 const chunks=[];let length=0;const deadline=Date.now()+20000;
 try{for(;;){let timer;let part;try{part=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('DOCUMENT_UPLOAD_TIMEOUT'),{code:'DOCUMENT_UPLOAD_TIMEOUT',status:408})),Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}if(part.done)break;length+=part.value.byteLength;if(length>TREASURY_DOCUMENT_LIMIT)controlError('DOCUMENT_TOO_LARGE',413);chunks.push(part.value);}}
 catch(error){void reader.cancel().catch(()=>{});throw error;}
 if(!length)controlError('EMPTY_DOCUMENT',400);if(declared!==null&&Number(declared)!==length)controlError('DOCUMENT_LENGTH_MISMATCH',400);
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
function treasuryDocumentFormat(bytes,type,name){
 const signature=type==='application/pdf'?bytes.length>=8&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'&&/\.pdf$/i.test(name):type==='image/png'?bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&/\.png$/i.test(name):type==='image/jpeg'?bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217&&/\.jpe?g$/i.test(name):false;
 if(!signature)controlError('DOCUMENT_FORMAT_MISMATCH',415);
}
export async function treasuryDocumentHttp(req,env,actor){
 // Caller has already checked authenticated root ownership, configuration and write origin.
 if(!env.BUCKET)controlError('DOCUMENT_STORAGE_UNAVAILABLE',503);
 const url=new URL(req.url),base='/api/control/v1/treasury-documents',prefix='treasury-documents/v1/'+await controlHash(actor)+'/',path=url.pathname;
 if(path===base&&req.method==='GET'){
  const cursor=url.searchParams.get('cursor')||undefined;if(cursor&&cursor.length>2048)controlError('INVALID_DOCUMENT_CURSOR',400);
  const result=await env.BUCKET.list({prefix,limit:50,include:['customMetadata'],...(cursor?{cursor}:{})});
  if(result.truncated&&!result.cursor)controlError('DOCUMENT_RECORD_UNAVAILABLE',503);
  return treasuryDocumentResponse({schema:'numina.supporting_documents.v1',documents:result.objects.map(object=>treasuryDocumentReceipt(object,prefix)),next_cursor:result.truncated?result.cursor:null,upload_limit_bytes:TREASURY_DOCUMENT_LIMIT,accepted_types:['application/pdf','image/png','image/jpeg'],receipt_scope:'file_storage_only',bank_issuer_verified:false,financial_execution:false});
 }
 if(path===base&&req.method==='POST'){
  const type=req.headers.get('content-type')?.split(';')[0];if(!['application/pdf','image/png','image/jpeg'].includes(type))controlError('DOCUMENT_TYPE_NOT_SUPPORTED',415);
  const name=treasuryDocumentName(req.headers.get('x-document-name')),bytes=await treasuryDocumentBytes(req);treasuryDocumentFormat(bytes,type,name);
  const digest=await crypto.subtle.digest('SHA-256',bytes),id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),key=prefix+id;
  const previous=await env.BUCKET.head(key);if(previous)return treasuryDocumentResponse({document:treasuryDocumentReceipt(previous,prefix),replayed:true});
  const metadata={schema:'numina.supporting_document.v1',encoded_name:encodeURIComponent(name),sha256:id,size:String(bytes.length),content_type:type,received_at:new Date().toISOString()};
  const stored=await env.BUCKET.put(key,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:digest,httpMetadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'},customMetadata:metadata});
  const confirmed=stored||await env.BUCKET.head(key);if(!confirmed)controlError('DOCUMENT_RECEIPT_UNCONFIRMED',503);
  return treasuryDocumentResponse({document:treasuryDocumentReceipt(confirmed,prefix),replayed:!stored},stored?201:200);
 }
 const match=path.match(/^\/api\/control\/v1\/treasury-documents\/([a-f0-9]{64})$/);
 if(match&&req.method==='GET'){
  const object=await env.BUCKET.get(prefix+match[1]);if(!object)controlError('DOCUMENT_NOT_FOUND',404);const receipt=treasuryDocumentReceipt(object,prefix);
  const fallback=receipt.name.replace(/[^A-Za-z0-9._-]/g,'_');
  return new Response(object.body,{headers:{...treasuryDocumentHeaders,'Content-Type':'application/octet-stream','Content-Length':String(receipt.size),'Content-Disposition':'attachment; filename="'+fallback+'"; filename*=UTF-8\'\''+encodeURIComponent(receipt.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),'Content-Security-Policy':"sandbox; default-src 'none'"}});
 }
 return treasuryDocumentResponse({error:req.method==='GET'?'DOCUMENT_NOT_FOUND':'METHOD_NOT_ALLOWED'},req.method==='GET'?404:405);
}
