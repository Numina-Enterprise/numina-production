'use strict';

const legacy=require('./numina');
const {createRuntimeNumina}=require('./numina-runtime');

function body(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{return {};}}
function respond(res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));}
function requireMethod(req,res,method){if(req.method===method)return true;respond(res,405,{error:'METHOD_NOT_ALLOWED'});return false;}
function exactReceipt(payload,type){const receipt=legacy.sign(payload,type);if(JSON.stringify(receipt.payload)!==JSON.stringify(payload))throw new Error(`${type}_PAYLOAD_MISMATCH`);return receipt;}

function makeFrontierHandler(kind){
  const legacyHandler=legacy.makeHandler(kind);
  if(!['control-evaluate','execution-prepare','evidence-bind'].includes(kind))return legacyHandler;
  return async function(req,res){
    try{
      if(!requireMethod(req,res,'POST'))return;
      const numina=createRuntimeNumina();
      const next=await numina.execute({kind,body:body(req)});
      const last=next.state.last||{};
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

module.exports={makeFrontierHandler};
