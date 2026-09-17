'use strict';

const legacy=require('../lib/numina');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');
const {project}=require('../lib/numina-projection');
const {authorizedControls}=require('../lib/execution-controls');

module.exports=async function status(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const controls=authorizedControls(legacy.controls());
  const status=project('status',{
    release:legacy.RELEASE_IDENTITY,
    controls,
    execution:{
      schema:'numina.live-execution-capability.v1',
      status:'GOVERNED_LIVE_SUBMISSION_ENABLED',
      provider:'arc',
      route:'/v1/execution/submit',
      owner_authorization_required:true,
      pre_signed_payload_required:true,
      live_provider_submitter_exposed:true,
      external_execution_performed:false,
      partnership_status:'not_asserted'
    },
    runtime:NUMINA_MANIFEST.runtime
  });
  const receipt=legacy.sign(status,'NUMINA_PRODUCTION_STATUS');
  if(JSON.stringify(receipt.payload)!==JSON.stringify(status)){
    throw new Error('NUMINA_PRODUCTION_STATUS_PAYLOAD_MISMATCH');
  }
  res.statusCode=200;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify({status,receipt}));
};
