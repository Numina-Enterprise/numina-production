'use strict';

const legacy=require('./numina');
const {createRuntimeNumina}=require('./numina-runtime');

function body(req){
  if(req.body&&typeof req.body==='object')return req.body;
  try{return JSON.parse(req.body||'{}')}catch{return {};}
}
function respond(res,status,value){
  res.statusCode=status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify(value));
}
function requireMethod(req,res,method){
  if(req.method===method)return true;
  respond(res,405,{error:'METHOD_NOT_ALLOWED'});return false;
}

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
        return respond(res,200,{decision,receipt:legacy.sign(decision,'NUMINA_CONTROL_DECISION'),external_execution_performed:false});
      }
      if(kind==='execution-prepare'){
        const handoff=last.handoff;
        return respond(res,200,{handoff,receipt:legacy.sign(handoff,'NUMINA_EXECUTION_HANDOFF'),external_execution_performed:false});
      }
      const binding=last.binding;
      return respond(res,200,{binding,receipt:legacy.sign(binding,'NUMINA_EXTERNAL_EVIDENCE_BINDING')});
    }catch(error){
      return respond(res,400,{error:String(error&&error.message||error)});
    }
  };
}

module.exports={makeFrontierHandler};
