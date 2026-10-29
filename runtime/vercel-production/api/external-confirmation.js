'use strict';

const {confirmExternalEvent}=require('../lib/external-confirmation');
const {persistConfirmation}=require('../lib/durable-confirmation-store');
const {project}=require('../lib/numina-projection');

function respond(res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));}
function body(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{return {};}}

module.exports=async function externalConfirmation(req,res){
  if(req.method!=='POST')return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
  try{
    const input=body(req);
    const result=confirmExternalEvent({expected:input.expected,providerResponse:input.providerResponse,provider:input.provider});
    const durable=await persistConfirmation({expected:input.expected,provider:input.provider,providerResponse:input.providerResponse,verification:result.verification,receipt:result.receipt});
    const output=project('external-confirmation',{...result,durable});
    return respond(res,result.verification.verification_status==='EXTERNALLY_CONFIRMED'?200:409,output);
  }catch(error){
    const message=String(error&&error.message||error);
    const persistenceFailure=/NUMINA_DATABASE_URL_REQUIRED|database|postgres|connect|timeout|ECONN/i.test(message);
    return respond(res,persistenceFailure?503:400,{error:persistenceFailure?'DURABLE_CONFIRMATION_UNAVAILABLE':message,detail:persistenceFailure?message:undefined});
  }
};
