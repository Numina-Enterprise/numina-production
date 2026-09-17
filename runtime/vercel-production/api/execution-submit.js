'use strict';

const legacy=require('../lib/numina');
const authority=require('../lib/owner-authority');
const {submitArc}=require('../lib/provider-submitter');

function body(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{return {};}}
function respond(res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));}

module.exports=async function executionSubmit(req,res){
  if(req.method!=='POST'){res.setHeader('allow','POST');return respond(res,405,{error:'METHOD_NOT_ALLOWED'});}
  try{
    const controls=authority.controls(legacy.controls());
    const result=await submitArc({body:body(req),verifyEnvelope:legacy.verifyEnvelope,sign:legacy.sign,controls});
    return respond(res,200,result);
  }catch(error){
    const message=String(error&&error.message||error);
    const status=message.startsWith('ARC_SUBMISSION_REJECTED_')||message.includes('ARC_RPC_')?502:400;
    return respond(res,status,{error:message,external_execution_performed:false});
  }
};
