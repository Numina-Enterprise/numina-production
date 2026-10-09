import {controlActor} from './control-http.js';
import {NUMINA_TREASURY_CONNECTION} from '../public/treasury-connection-model.js';
import {privateBankRouteConfiguration} from './bank-route-model.js';
import TREASURY_SUBMISSION_REQUESTS from '../release-evidence/treasury-submission-requests-2026-09-18.json' with {type:'json'};

export async function treasuryConnectionHttp(req,env,{authorize=controlActor}={}){
  const path=new URL(req.url).pathname;
  const send=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'}});
  if(!['/api/treasury/v1/model','/api/treasury/v1/bank-route','/api/treasury/v1/submissions'].includes(path))return send({error:'NOT_FOUND'},404);
  if(req.method!=='GET'&&!(path==='/api/treasury/v1/submissions'&&req.method==='POST'))return send({error:'METHOD_NOT_ALLOWED'},405);
  if(path==='/api/treasury/v1/model')return send(NUMINA_TREASURY_CONNECTION);
  if(req.method==='POST'&&!req.headers.has('authorization')&&req.headers.get('origin')!==new URL(req.url).origin)return send({error:'ORIGIN_REQUIRED',submissionPerformed:false},403);
  try{
    const actor=await authorize(req,env);
    if(env.NUMINA_REVIEW_SESSION===true||!env.NUMINA_CONTROL_OWNER||actor!==env.NUMINA_CONTROL_OWNER)return send({error:'OWNER_VIEW_REQUIRED'},403);
    if(path==='/api/treasury/v1/bank-route')return send(privateBankRouteConfiguration(env));
    if(req.method==='GET')return send(TREASURY_SUBMISSION_REQUESTS);
    return send({error:'SUBMISSION_ADAPTER_NOT_CONNECTED',status:'BLOCKED_NOT_SUBMITTED',submissionPerformed:false,settled:false,receipt:null,
      required:['FUNDED_PROVIDER_SOURCE','PROVIDER_DESTINATION_AND_RAIL','SUBMISSION_CAPABILITY','DURABLE_IDEMPOTENCY_AND_RECEIPT_RECONCILIATION']},503);
  }catch(error){return send({error:'OWNER_AUTH_UNAVAILABLE',submissionPerformed:false},[401,403].includes(error.status)?error.status:503);}
}
