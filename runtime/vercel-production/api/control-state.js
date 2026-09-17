'use strict';

const legacy=require('../lib/numina');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');
const {project}=require('../lib/numina-projection');
const {authorizedControls}=require('../lib/execution-controls');

module.exports=async function controlState(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const controls={...authorizedControls(legacy.controls()),public_execution_route_exposed:true};
  const state=project('control-state',{
    schema:'numina.control-state.v1',
    release:legacy.RELEASE_IDENTITY.production_version,
    manifest:NUMINA_MANIFEST.schema,
    controls,
    funds_state:{
      schema:'numina.funds-state.v1',
      status:'OWNER_GOVERNED_EXECUTION_ENABLED',
      real_funds_enabled:true,
      external_balance_verified:false,
      external_funds_moved:false,
      evidence_basis:'owner_authorized_capability_no_transaction_submitted'
    },
    execution_state:{
      schema:'numina.execution-state.v1',
      status:'GOVERNED_LIVE_SUBMISSION_ENABLED',
      public_execution_api_enabled:true,
      public_execution_route_exposed:true,
      live_provider_submitter_exposed:true,
      supported_live_providers:['arc'],
      submit_route:'/v1/execution/submit',
      owner_authorization_required:true,
      pre_signed_payload_required:true,
      arbitrary_provider_url_allowed:false,
      embedded_private_key_allowed:false,
      external_execution_performed:false
    },
    partnership_state:{
      schema:'numina.partnership-state.v1',
      status:'NOT_ASSERTED',
      external_evidence_bound:false,
      evidence_basis:'no_external_partnership_evidence_bound'
    }
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
