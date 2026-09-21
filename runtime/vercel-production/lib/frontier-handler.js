'use strict';

const crypto=require('crypto');
const legacy=require('./numina');
const authority=require('./owner-authority');
const {createRuntimeNumina}=require('./numina-runtime');

const CANONICAL_CONTROL_API_KEY_SHA256='d00bb7c7b85a0ff5ef6681db70aed9cdcfab1a5cd60186d334dcb57d07a4c0e6';

function body(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{return {};}}
function respond(res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));}
function requireMethod(req,res,method){if(req.method===method)return true;respond(res,405,{error:'METHOD_NOT_ALLOWED'});return false;}
function exactReceipt(payload,type){const receipt=legacy.sign(payload,type);if(JSON.stringify(receipt.payload)!==JSON.stringify(payload))throw new Error(`${type}_PAYLOAD_MISMATCH`);return receipt;}
function requestHeader(req,name){
  const headers=req&&req.headers;
  if(headers&&typeof headers.get==='function')return headers.get(name);
  const value=headers&&(headers[name]??headers[name.toLowerCase()]);
  return Array.isArray(value)?value[0]:value;
}
function controlPins(env=process.env){
  const configured=String(env.NUMINA_CONTROL_API_KEY_SHA256||'').trim().toLowerCase();
  if(configured&&!/^[0-9a-f]{64}$/.test(configured))return null;
  return configured&&configured!==CANONICAL_CONTROL_API_KEY_SHA256
    ?[CANONICAL_CONTROL_API_KEY_SHA256,configured]:[CANONICAL_CONTROL_API_KEY_SHA256];
}
function ownerBearerAuthorized(req,{env=process.env}={}){
  const authorization=String(requestHeader(req,'authorization')||'');
  if(!authorization.startsWith('Bearer '))return false;
  const token=authorization.slice(7).trim(),pins=controlPins(env);
  if(!token||!pins)return false;
  const actual=crypto.createHash('sha256').update(token,'utf8').digest();
  return pins.some(pin=>crypto.timingSafeEqual(actual,Buffer.from(pin,'hex')));
}
function requestControls(authenticated){
  if(authenticated)return authority.controls(legacy.controls());
  return {...legacy.controls(),real_funds_enabled:false,public_execution_api_enabled:false};
}

function makeFrontierHandler(kind){
  const legacyHandler=legacy.makeHandler(kind);
  if(!['control-evaluate','execution-prepare','evidence-bind'].includes(kind))return legacyHandler;
  return async function(req,res){
    try{
      if(!requireMethod(req,res,'POST'))return;
      const authenticated=ownerBearerAuthorized(req);
      if(kind!=='control-evaluate'&&!authenticated)return respond(res,401,{error:'OWNER_AUTH_REQUIRED'});
      const numina=createRuntimeNumina();
      const next=await numina.execute({kind,body:body(req),controls:requestControls(authenticated)});
      const last=next.manifest.last||{};
      if(kind==='control-evaluate'){
        const decision=last.decision;
        const receipt=exactReceipt(decision,'NUMINA_CONTROL_DECISION');
        return respond(res,200,{decision,receipt,external_execution_performed:false});
      }
      if(kind==='execution-prepare'){
        const handoff=last.handoff;
        const receipt=exactReceipt(handoff,'NUMINA_EXECUTION_HANDOFF');
        return respond(res,200,{handoff,receipt,external_execution_performed:false});
      }
      const binding=last.binding;
      const receipt=exactReceipt(binding,'NUMINA_EXTERNAL_EVIDENCE_BINDING');
      return respond(res,200,{binding,receipt});
    }catch(error){return respond(res,400,{error:String(error&&error.message||error)});}
  };
}

module.exports={makeFrontierHandler,ownerBearerAuthorized,requestControls,CANONICAL_CONTROL_API_KEY_SHA256};
