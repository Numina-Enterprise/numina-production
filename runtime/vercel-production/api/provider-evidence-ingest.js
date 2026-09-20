'use strict';

const {persistProviderEvidence}=require('../lib/provider-evidence-ingest');

function respond(res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));}
function parseBody(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{return {};}}

module.exports=async function providerEvidenceIngest(req,res){
  if(req.method!=='POST'){res.setHeader('allow','POST');return respond(res,405,{error:'METHOD_NOT_ALLOWED'});}
  try{
    const auth=String(req.headers?.authorization||'');
    if(!auth.startsWith('Bearer '))return respond(res,401,{error:'GITHUB_OIDC_TOKEN_REQUIRED'});
    const body=parseBody(req);
    const manifest=body&&typeof body==='object'&&body.manifest?body.manifest:body;
    const result=await persistProviderEvidence({token:auth.slice(7).trim(),manifest});
    return respond(res,200,{...result,git_commit_sha:result.git_commit_sha||result.source_commit,deployment_id:result.deployment_id||result.transport_deployment_id});
  }catch(error){
    const message=String(error&&error.message||error);
    const authFailure=/GITHUB_OIDC/.test(message);
    const durableFailure=/DURABLE_EVIDENCE|NUMINA_DURABLE_EVIDENCE/.test(message);
    return respond(res,authFailure?401:durableFailure?503:400,{error:message});
  }
};
