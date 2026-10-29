import {controlActor,controlBody} from './control-http.js';
import {controlHash,controlError,stable} from './control.js';
import {readControl} from './control-store.js';
import {rateLimit} from './store.js';
import {treasuryDocumentHttp} from './treasury-documents.js';
import {verifyAchReceipt} from './ach-receipt-verifier.js';
import {verifyUsdcReceipt} from './usdc-receipt-verifier.js';
import {NUMINA_FINANCIAL_SOFTWARE_METADATA} from '../public/financial-model.js';

export const TRANSFER_RECEIPTS_ROUTE='/api/financial/v1/receipts';
const transferReceiptHash=/^[a-f0-9]{64}$/;
const transferReceiptAddress=/^0x[0-9a-fA-F]{40}$/;
function transferReceiptAssert(ok){if(!ok)controlError('INVALID_TRANSFER_RECEIPT',400);}
export function validateTransferReceipt(input){
  transferReceiptAssert(input&&typeof input==='object'&&!Array.isArray(input));
  const ach=input.rail==='ACH',usdc=input.rail==='USDC';
  transferReceiptAssert(ach||usdc);
  const allowed=ach?['rail','requestId','amount','provider','providerReference','destinationReference','documentId']:['rail','requestId','amount','network','transactionHash','from','to','logIndex'];
  transferReceiptAssert(Object.keys(input).every(key=>allowed.includes(key)));
  transferReceiptAssert(input.requestId===(ach?'numina-ach-500t-20260918':'numina-usdc-500t-20260918')&&input.amount==='500000000000000');
  const evidence={rail:input.rail,requestId:input.requestId,amount:input.amount};
  if(ach){
    if(input.provider==='bank_document'){
      transferReceiptAssert(typeof input.documentId==='string'&&transferReceiptHash.test(input.documentId)&&!Object.hasOwn(input,'destinationReference'));
      Object.assign(evidence,{provider:'bank_document',documentId:input.documentId});
      if(Object.hasOwn(input,'providerReference')){transferReceiptAssert(typeof input.providerReference==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(input.providerReference));evidence.providerReference=input.providerReference;}
      return evidence;
    }
    transferReceiptAssert(input.provider==='stripe'&&typeof input.providerReference==='string'&&/^ob[tp]_[A-Za-z0-9]{8,128}$/.test(input.providerReference));
    transferReceiptAssert(typeof input.destinationReference==='string'&&/^[A-Za-z][A-Za-z0-9_]{7,199}$/.test(input.destinationReference));
    Object.assign(evidence,{provider:'stripe',providerReference:input.providerReference,destinationReference:input.destinationReference});
    if(Object.hasOwn(input,'documentId')){transferReceiptAssert(typeof input.documentId==='string'&&transferReceiptHash.test(input.documentId));evidence.documentId=input.documentId;}
  }else{
    transferReceiptAssert(input.network==='base'&&typeof input.transactionHash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(input.transactionHash)&&!/^0x0+$/.test(input.transactionHash));
    for(const name of ['from','to'])transferReceiptAssert(typeof input[name]==='string'&&transferReceiptAddress.test(input[name])&&!/^0x0+$/.test(input[name]));
    transferReceiptAssert(input.from.toLowerCase()!==input.to.toLowerCase()&&Number.isSafeInteger(input.logIndex)&&input.logIndex>=0&&input.logIndex<=4294967295);
    Object.assign(evidence,{network:input.network,transactionHash:input.transactionHash.toLowerCase(),from:input.from.toLowerCase(),to:input.to.toLowerCase(),logIndex:input.logIndex});
  }
  return evidence;
}
function transferReceiptResponse(value,status=200){return Response.json({...NUMINA_FINANCIAL_SOFTWARE_METADATA,...value,financialExecution:false},{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'}});}
async function transferReceiptStoredJson(bucket,key){
  const object=await bucket.get(key);if(!object)controlError('RECEIPT_NOT_FOUND',404);
  if(!Number.isSafeInteger(object.size)||object.size>20000)controlError('RECEIPT_INTEGRITY_FAILED',503);
  const bytes=new Uint8Array(await new Response(object.body).arrayBuffer());
  if(bytes.byteLength!==object.size||bytes.byteLength>20000)controlError('RECEIPT_INTEGRITY_FAILED',503);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{controlError('RECEIPT_INTEGRITY_FAILED',503);}
}
async function transferReceiptReadImport(bucket,key,prefix){
  const record=await transferReceiptStoredJson(bucket,key);
  try{
    const evidence=validateTransferReceipt(record.evidence),id=await controlHash(evidence);
    const payload={schema:record.schema,id:record.id,receivedAt:record.receivedAt,classification:record.classification,evidence};
    if(Object.keys(record).sort().join(',')!=='classification,evidence,id,integrityHash,receivedAt,schema'||record.schema!=='numina.transfer-receipt-import.v1'||record.classification!=='owner_submitted_unverified'||!Number.isFinite(Date.parse(record.receivedAt))||record.id!==id||key!==prefix+id||stable(record.evidence)!==stable(evidence)||record.integrityHash!==await controlHash(payload))throw Error();
    return record;
  }catch{controlError('RECEIPT_INTEGRITY_FAILED',503);}
}
function transferReceiptVerificationValid(value,rail){
  const success=rail==='ACH'?'VERIFIED_PROVIDER_REPORT':'VERIFIED_ONCHAIN_TRANSFER';
  return value&&typeof value==='object'&&!Array.isArray(value)&&[success,'PENDING','NOT_VERIFIED','UNAVAILABLE'].includes(value.status)
    &&typeof value.verified==='boolean'&&value.verified===(value.status===success)
    &&typeof value.reason==='string'&&value.reason.length<=500&&typeof value.scope==='string'&&value.scope.length<=1000
    &&typeof value.observedAt==='string'&&Number.isFinite(Date.parse(value.observedAt))
    &&value.source&&typeof value.source==='object'&&!Array.isArray(value.source)
    &&!Object.hasOwn(value,'settled')&&!Object.hasOwn(value,'financialExecution')&&new TextEncoder().encode(stable(value)).byteLength<=12000;
}
async function transferReceiptReadObservation(bucket,key,prefix,receipt){
  const record=await transferReceiptStoredJson(bucket,key),{id,...payload}=record;
  if(Object.keys(record).sort().join(',')!=='financialExecution,id,observedAt,receiptId,schema,verification'||record.schema!=='numina.transfer-receipt-observation.v1'||record.receiptId!==receipt.id||record.financialExecution!==false||record.observedAt!==record.verification?.observedAt||!transferReceiptVerificationValid(record.verification,receipt.evidence.rail)||key!==prefix+id||id!==await controlHash(payload))controlError('RECEIPT_INTEGRITY_FAILED',503);
  return record;
}
async function transferReceiptPut(bucket,key,value){return bucket.put(key,new TextEncoder().encode(stable(value)),{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'},customMetadata:{schema:value.schema}});}
async function transferReceiptList(bucket,prefix,url,read){
  if([...url.searchParams.keys()].some(key=>key!=='cursor')||url.searchParams.getAll('cursor').length>1)controlError('UNEXPECTED_PARAMETERS',400);
  const cursor=url.searchParams.get('cursor')||undefined;if(cursor&&cursor.length>2048)controlError('INVALID_RECEIPT_CURSOR',400);
  const listing=await bucket.list({prefix,limit:25,...(cursor?{cursor}:{})});
  if(!Array.isArray(listing.objects)||listing.objects.length>25||(listing.truncated&&!listing.cursor))controlError('RECEIPT_STORAGE_UNAVAILABLE',503);
  const values=await Promise.all(listing.objects.map(item=>{if(!item.key.startsWith(prefix))controlError('RECEIPT_INTEGRITY_FAILED',503);return read(item.key);}));
  return {values,nextCursor:listing.truncated?listing.cursor:null};
}
export async function transferReceiptsHttp(req,env,{verifyAch=verifyAchReceipt,verifyUsdc=verifyUsdcReceipt}={}){
  const url=new URL(req.url),path=url.pathname;
  try{
    if(!['GET','POST'].includes(req.method))return transferReceiptResponse({error:'METHOD_NOT_ALLOWED'},405);
    const actor=await controlActor(req,env);
    if(env.NUMINA_REVIEW_SESSION===true||actor!==env.NUMINA_CONTROL_OWNER)controlError('OWNER_VIEW_REQUIRED',403);
    if(req.method==='POST'&&!req.headers.has('authorization')&&req.headers.get('origin')!==url.origin)controlError('ORIGIN_REQUIRED',403);
    const current=await readControl(env.DB);if(current.manifest.root!==actor)controlError('ROOT_CONFIGURATION_MISMATCH',503);
    if(!await rateLimit(env.DB,await controlHash('transfer-receipts:'+actor),Math.floor(Date.now()/1000)))controlError('RATE_LIMITED',429);
    if(!env.BUCKET)controlError('RECEIPT_STORAGE_UNAVAILABLE',503);
    const prefix='transfer-receipts/v1/'+await controlHash(actor)+'/',imports=prefix+'imports/';
    if(path===TRANSFER_RECEIPTS_ROUTE){
      if(req.method==='GET'){
        const page=await transferReceiptList(env.BUCKET,imports,url,key=>transferReceiptReadImport(env.BUCKET,key,imports));
        return transferReceiptResponse({records:page.values,nextCursor:page.nextCursor});
      }
      if(url.search)controlError('UNEXPECTED_PARAMETERS',400);
      const evidence=validateTransferReceipt(await controlBody(req));
      if(evidence.documentId){
        const doc=await treasuryDocumentHttp(new Request(new URL('/api/control/v1/treasury-documents/'+evidence.documentId,req.url)),env,actor);
        if(!doc.ok)controlError('DOCUMENT_RECEIPT_NOT_FOUND',400);await doc.body?.cancel();
      }
      const id=await controlHash(evidence),key=imports+id;
      if(await env.BUCKET.head(key))return transferReceiptResponse({record:await transferReceiptReadImport(env.BUCKET,key,imports),replayed:true});
      const payload={schema:'numina.transfer-receipt-import.v1',id,receivedAt:new Date().toISOString(),classification:'owner_submitted_unverified',evidence};
      const record={...payload,integrityHash:await controlHash(payload)};
      const saved=await transferReceiptPut(env.BUCKET,key,record);
      return transferReceiptResponse({record:await transferReceiptReadImport(env.BUCKET,key,imports),replayed:!saved},saved?201:200);
    }
    const suffix=path.startsWith(TRANSFER_RECEIPTS_ROUTE+'/')?path.slice(TRANSFER_RECEIPTS_ROUTE.length+1).split('/'):[];
    if(!transferReceiptHash.test(suffix[0]||'')||suffix.length>2||suffix.length===2&&!['verify','verifications'].includes(suffix[1]))return transferReceiptResponse({error:'NOT_FOUND'},404);
    const receipt=await transferReceiptReadImport(env.BUCKET,imports+suffix[0],imports),observations=prefix+'observations/'+receipt.id+'/';
    if(suffix.length===1&&req.method==='GET'){
      if(url.search)controlError('UNEXPECTED_PARAMETERS',400);
      return transferReceiptResponse({record:receipt});
    }
    if(suffix[1]==='verifications'&&req.method==='GET'){
      const page=await transferReceiptList(env.BUCKET,observations,url,key=>transferReceiptReadObservation(env.BUCKET,key,observations,receipt));
      return transferReceiptResponse({observations:page.values,nextCursor:page.nextCursor});
    }
    if(suffix[1]==='verify'&&req.method==='POST'){
      if(url.search)controlError('UNEXPECTED_PARAMETERS',400);
      const body=await controlBody(req);if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)controlError('UNEXPECTED_VERIFICATION_INPUT',400);
      let verification;
      try{verification=await (receipt.evidence.rail==='ACH'?verifyAch:verifyUsdc)(receipt.evidence,env);}catch{verification={status:'UNAVAILABLE',verified:false,reason:'VERIFIER_UNAVAILABLE',scope:'No external transaction verification completed',observedAt:new Date().toISOString(),source:{provider:receipt.evidence.rail==='ACH'?'stripe':'base_rpc'}};}
      if(!transferReceiptVerificationValid(verification,receipt.evidence.rail))controlError('VERIFIER_RESPONSE_INVALID',503);
      const payload={schema:'numina.transfer-receipt-observation.v1',receiptId:receipt.id,observedAt:verification.observedAt,verification,financialExecution:false};
      const id=await controlHash(payload),key=observations+id,saved=await transferReceiptPut(env.BUCKET,key,{...payload,id});
      const observation=await transferReceiptReadObservation(env.BUCKET,key,observations,receipt);
      return transferReceiptResponse({observation,id,replayed:!saved},saved?201:200);
    }
    return transferReceiptResponse({error:'METHOD_NOT_ALLOWED'},405);
  }catch(error){return transferReceiptResponse({error:typeof error.code==='string'&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'RECEIPT_SERVICE_UNAVAILABLE'},Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:503);}
}
