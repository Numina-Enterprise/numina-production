'use strict';

const legacy=require('../lib/numina');
const authority=require('../lib/owner-authority');

function body(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{return {};}}
function respond(res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));}

module.exports=async function executionSubmit(req,res){
  if(req.method!=='POST'){res.setHeader('allow','POST');return respond(res,405,{error:'METHOD_NOT_ALLOWED'});}
  const request=body(req);
  const handoffReceipt=request.handoff_receipt;
  if(!legacy.verifyEnvelope(handoffReceipt,'NUMINA_EXECUTION_HANDOFF'))return respond(res,400,{error:'EXECUTION_HANDOFF_RECEIPT_INVALID'});
  const handoff=handoffReceipt.payload||{};
  if(handoff.execution_permitted!==true)return respond(res,409,{error:'EXECUTION_NOT_PERMITTED_BY_HANDOFF'});
  const provider=String(handoff.provider||request.provider||'').trim().toLowerCase();
  if(!provider)return respond(res,400,{error:'EXECUTION_PROVIDER_REQUIRED'});
  const credentialAvailable=Boolean(process.env.NUMINA_PROVIDER_SUBMISSION_TOKEN);
  const state={
    schema:'numina.execution-submission-state.v1',
    provider,
    authorization_id:authority.OWNER_AUTHORIZATION.authorization_id,
    execution_authorized:true,
    provider_submitter_approved:true,
    live_submission_enabled:true,
    route:'/v1/execution/submit',
    credentialed_provider_submitter_available:credentialAvailable,
    submitted:false,
    external_execution_performed:false
  };
  const receipt=legacy.sign(state,'NUMINA_EXECUTION_SUBMISSION_STATE');
  if(!credentialAvailable)return respond(res,503,{state,receipt,error:'PROVIDER_CREDENTIALS_UNAVAILABLE'});
  return respond(res,503,{state,receipt,error:'PROVIDER_ADAPTER_NOT_BOUND'});
};
