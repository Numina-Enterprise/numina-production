'use strict';

const legacy=require('../lib/numina');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');
const {project}=require('../lib/numina-projection');

module.exports=async function controlState(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const state=project('control-state',{
    schema:'numina.control-state.v1',
    release:legacy.RELEASE_IDENTITY.production_version,
    manifest:NUMINA_MANIFEST.schema,
    controls:legacy.controls()
  });
  const receipt=legacy.sign(state,'NUMINA_CONTROL_STATE');
  res.statusCode=200;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify({state,receipt}));
};
