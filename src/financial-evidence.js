import {FINANCIAL_SERVICES,FINANCIAL_DOCUMENT_KINDS,validateFinancialEvidence,assessFinancialEvidence} from '../public/financial-model.js';
import {controlActor,controlBody} from './control-http.js';
import {controlHash,controlError,stable} from './control.js';
import {readControl} from './control-store.js';
import {rateLimit} from './store.js';
import {treasuryDocumentHttp} from './treasury-documents.js';

const financialBase='/api/financial/v1';
function financialResponse(body,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie, Authorization'}});}
export function financialManifest(){return {schema:'numina.financial-evidence.v1',workspace:'/financial-services',package:'xyz.numinalabs.app',services:FINANCIAL_SERVICES,documentKinds:FINANCIAL_DOCUMENT_KINDS,functions:['private_document_upload','register_evidence','list_evidence','check_document_coverage','export_review_packet'],documentStorage:'/api/control/v1/treasury-documents',evidence:'/api/financial/v1/evidence',reviewPacket:'/api/financial/v1/review-packet',security:'/security',documentation:'/downloads/Numina-Financial-Services.md',templates:'/downloads/Numina-Financial-Document-Templates.md',approvalEvidence:'/downloads/Numina-Financial-Approval-Evidence.md',classification:'evidence_management_only',financialExecution:false,licensingVerified:false};}
async function financialReadRecord(bucket,key,prefix){
  const object=await bucket.get(key);if(!object||object.size>20000)controlError('EVIDENCE_RECORD_UNAVAILABLE',503);
  let record;try{record=JSON.parse(await new Response(object.body).text());}catch{controlError('EVIDENCE_RECORD_UNAVAILABLE',503);}
  if(record?.schema!=='numina.financial-evidence-record.v1'||record.classification!=='owner_submitted_unverified'||!Number.isFinite(Date.parse(record.receivedAt)))controlError('EVIDENCE_RECORD_UNAVAILABLE',503);
  let evidence;try{evidence=validateFinancialEvidence(record.evidence);}catch{controlError('EVIDENCE_RECORD_UNAVAILABLE',503);}
  const id=await controlHash(evidence);if(key!==prefix+id||record.id!==id)controlError('EVIDENCE_INTEGRITY_FAILED',503);
  return record;
}
export async function financialEvidenceHttp(req,env){
  const url=new URL(req.url),path=url.pathname;
  try{
    if(path===financialBase+'/manifest'&&req.method==='GET'){if(url.search)controlError('UNEXPECTED_PARAMETERS',400);return financialResponse(financialManifest());}
    if(!['GET','POST'].includes(req.method))return financialResponse({error:'METHOD_NOT_ALLOWED'},405);
    const actor=await controlActor(req,env);
    if(env.NUMINA_REVIEW_SESSION===true||actor!==env.NUMINA_CONTROL_OWNER)controlError('OWNER_VIEW_REQUIRED',403);
    if(req.method==='POST'&&!req.headers.has('authorization')&&req.headers.get('origin')!==url.origin)controlError('ORIGIN_REQUIRED',403);
    const current=await readControl(env.DB);if(current.manifest.root!==actor)controlError('ROOT_CONFIGURATION_MISMATCH',503);
    if(!await rateLimit(env.DB,await controlHash('financial-evidence:'+actor),Math.floor(Date.now()/1000)))controlError('RATE_LIMITED',429);
    if(!env.BUCKET)controlError('DOCUMENT_STORAGE_UNAVAILABLE',503);
    const prefix='financial-evidence/v1/'+await controlHash(actor)+'/';
    if(req.method==='POST'&&path===financialBase+'/evidence'){
      if(url.search)controlError('UNEXPECTED_PARAMETERS',400);
      const evidence=validateFinancialEvidence(await controlBody(req));
      // A reference must resolve to a real file already stored under this owner.
      const stored=await treasuryDocumentHttp(new Request(new URL('/api/control/v1/treasury-documents/'+evidence.documentId,req.url)),env,actor);
      if(!stored.ok)controlError('DOCUMENT_RECEIPT_NOT_FOUND',400);await stored.body?.cancel();
      const id=await controlHash(evidence),key=prefix+id;
      if(await env.BUCKET.head(key))return financialResponse({record:await financialReadRecord(env.BUCKET,key,prefix),replayed:true});
      const record={schema:'numina.financial-evidence-record.v1',id,receivedAt:new Date().toISOString(),classification:'owner_submitted_unverified',evidence};
      const bytes=new TextEncoder().encode(stable(record));
      const saved=await env.BUCKET.put(key,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'},customMetadata:{schema:record.schema}});
      const confirmed=await financialReadRecord(env.BUCKET,key,prefix);return financialResponse({record:confirmed,replayed:!saved},saved?201:200);
    }
    if(req.method==='GET'&&[financialBase+'/evidence',financialBase+'/review-packet'].includes(path)){
      if([...url.searchParams.keys()].some(key=>key!=='cursor'))controlError('UNEXPECTED_PARAMETERS',400);
      const cursor=url.searchParams.get('cursor')||undefined;if(cursor&&cursor.length>2048)controlError('INVALID_EVIDENCE_CURSOR',400);
      const listing=await env.BUCKET.list({prefix,limit:50,...(cursor?{cursor}:{})});
      if(listing.truncated&&!listing.cursor)controlError('EVIDENCE_RECORD_UNAVAILABLE',503);
      const records=await Promise.all(listing.objects.map(object=>financialReadRecord(env.BUCKET,object.key,prefix)));
      return financialResponse({schema:'numina.financial-review-packet.v1',generatedAt:new Date().toISOString(),records,assessment:assessFinancialEvidence(records),nextCursor:listing.truncated?listing.cursor:null,assessmentScope:'returned_page_only',verification:'document_registration_and_structure_only',financialExecution:false,readyForPlaySubmission:false,remainingChecks:['issuer_authenticity','entity_and_jurisdiction_coverage','terms_and_fee_accuracy','provider_integration_and_reconciliation','security_and_data_safety','free_reviewer_functionality','play_console_validation']});
    }
    return financialResponse({error:'NOT_FOUND'},404);
  }catch(error){return financialResponse({error:error.code||'EVIDENCE_SERVICE_UNAVAILABLE'},error.status||503);}
}
