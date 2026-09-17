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
  const controls={...legacy.controls(),public_execution_route_exposed:false};
  const state=project('control-state',{
    schema:'numina.control-state.v1',
    release:legacy.RELEASE_IDENTITY.production_version,
    manifest:NUMINA_MANIFEST.schema,
    controls,
    funds_state:{
      schema:'numina.funds-state.v1',
      status:controls.real_funds_enabled?'CONFIGURED_NOT_EXTERNALLY_VERIFIED':'DISABLED',
      real_funds_enabled:controls.real_funds_enabled,
      external_balance_verified:false,
      external_funds_moved:false,
      evidence_basis:controls.real_funds_enabled?'runtime_configuration_only':'runtime_control_disabled'
    },
    execution_state:{
      schema:'numina.execution-state.v1',
      status:controls.public_execution_api_enabled?'CONFIGURED_ROUTE_CLOSED':'CLOSED',
      public_execution_api_enabled:controls.public_execution_api_enabled,
      public_execution_route_exposed:false,
      live_provider_submitter_exposed:false,
      external_execution_performed:false
    },
    partnership_state:{
      schema:'numina.partnership-state.v1',
      status:'NOT_ASSERTED',
      external_evidence_bound:false,
      evidence_basis:'no_external_partnership_evidence_bound'
    }
  });
  // Sign the exact object returned as `state`; no derived or reduced payload.
  const receipt=legacy.sign(state,'NUMINA_CONTROL_STATE');
  if(JSON.stringify(receipt.payload)!==JSON.stringify(state)){
    throw new Error('NUMINA_CONTROL_STATE_SIGNATURE_PAYLOAD_MISMATCH');
  }
  res.statusCode=200;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify({state,receipt}));
};
