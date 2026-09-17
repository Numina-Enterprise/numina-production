'use strict';

const legacy=require('../lib/numina');
const authority=require('../lib/owner-authority');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');
const {project}=require('../lib/numina-projection');

module.exports=async function controlState(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const controls=authority.controls(legacy.controls());
  const credentialedProviderSubmitterAvailable=Boolean(process.env.NUMINA_PROVIDER_SUBMISSION_TOKEN);
  const state=project('control-state',{
    schema:'numina.control-state.v1',
    release:legacy.RELEASE_IDENTITY.production_version,
    manifest:NUMINA_MANIFEST.schema,
    controls,
    funds_state:authority.fundsState(),
    execution_state:authority.executionState({credentialedProviderSubmitterAvailable}),
    partnership_state:authority.partnershipState(),
    external_execution_performed:false,
    external_funds_moved:false
  });
  const receipt=legacy.sign(state,'NUMINA_CONTROL_STATE');
  if(JSON.stringify(receipt.payload)!==JSON.stringify(state)){
    throw new Error('NUMINA_CONTROL_STATE_SIGNATURE_PAYLOAD_MISMATCH');
  }
  res.statusCode=200;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify({state,receipt}));
};
