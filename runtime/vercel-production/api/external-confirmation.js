'use strict';

const {confirmExternalEvent}=require('../lib/external-confirmation');
const {project}=require('../lib/numina-projection');

function respond(res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));}
function body(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{return {};}}

module.exports=async function externalConfirmation(req,res){
  if(req.method!=='POST')return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
  try{
    const input=body(req);
    // providerResponse must be the response captured from the independently queried provider/network.
    const result=confirmExternalEvent({expected:input.expected,providerResponse:input.providerResponse,provider:input.provider});
    return respond(res,result.verification.verification_status==='EXTERNALLY_CONFIRMED'?200:409,project('external-confirmation',result));
  }catch(error){return respond(res,400,{error:String(error&&error.message||error)});}
};
