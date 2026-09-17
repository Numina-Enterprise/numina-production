'use strict';

const legacy=require('../lib/numina');
const {makeFrontierHandler}=require('../lib/frontier-handler');
const {authorizedControls,applyAuthorizedExecution}=require('../lib/execution-controls');
const {submitArc}=require('../lib/provider-submitter');

const prepareHandler=makeFrontierHandler('execution-prepare');
function body(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{return {};}}
function respond(res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');return res.end(JSON.stringify(value));}

module.exports=async function execution(req,res){
  const url=new URL(req.url,'https://numina-production.vercel.app');
  if(String(url.searchParams.get('mode')||'prepare').toLowerCase()!=='submit'){
    applyAuthorizedExecution();
    return prepareHandler(req,res);
  }
  if(req.method!=='POST'){res.setHeader('allow','POST');return respond(res,405,{error:'METHOD_NOT_ALLOWED'});}
  try{
    applyAuthorizedExecution();
    const controls=authorizedControls(legacy.controls());
    const result=await submitArc({body:body(req),verifyEnvelope:legacy.verifyEnvelope,sign:legacy.sign,controls});
    return respond(res,200,result);
  }catch(error){
    const message=String(error&&error.message||error);
    const status=message.startsWith('ARC_SUBMISSION_REJECTED_')?502:400;
    return respond(res,status,{error:message});
  }
};
