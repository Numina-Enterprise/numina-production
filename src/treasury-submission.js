import {readFileSync} from 'node:fs';
import {readPrivateBankRoute} from './bank-route-config.js';

const record=JSON.parse(readFileSync(new URL('../release-evidence/treasury-submission-requests-2026-09-18.json',import.meta.url),'utf8'));

// Fail-closed integration boundary. No provider write or blockchain broadcast exists here.
// A future live adapter must authenticate the owner, resolve a funded source and exact
// destination, persist idempotency before submission, then independently reconcile receipts.
export async function treasurySubmissionHttp(req,res,{authorize=readPrivateBankRoute}={}){
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','private, no-store');
  res.setHeader('vary','Cookie, Authorization');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('allow','GET, POST');
  const send=(status,body)=>{res.statusCode=status;return res.end(JSON.stringify(body));};
  if(!['GET','POST'].includes(req.method))return send(405,{error:'METHOD_NOT_ALLOWED'});
  if(req.method==='POST'&&!req.headers?.authorization&&!['https://numinalabs.xyz','https://www.numinalabs.xyz'].includes(req.headers?.origin)){
    return send(403,{error:'ORIGIN_REQUIRED',submissionPerformed:false});
  }
  try{await authorize(req);}
  catch(error){return send([401,403].includes(error.status)?error.status:503,{error:'OWNER_AUTH_UNAVAILABLE',submissionPerformed:false});}
  if(req.method==='GET')return send(200,record);
  // Never accept a caller-provided status, receipt or funding assertion as evidence.
  return send(503,{error:'SUBMISSION_ADAPTER_NOT_CONNECTED',status:'BLOCKED_NOT_SUBMITTED',
    submissionPerformed:false,settled:false,receipt:null,requestRecords:'/api/treasury/v1/submissions',
    required:['FUNDED_PROVIDER_SOURCE','PROVIDER_DESTINATION_AND_RAIL','SUBMISSION_CAPABILITY','DURABLE_IDEMPOTENCY_AND_RECEIPT_RECONCILIATION']});
}
