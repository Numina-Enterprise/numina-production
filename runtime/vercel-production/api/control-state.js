'use strict';

const legacy=require('../lib/numina');
const authority=require('../lib/owner-authority');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');
const {project}=require('../lib/numina-projection');

module.exports=async function controlManifest(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const controls=authority.controls(legacy.controls());
  const credentialedProviderSubmitterAvailable=Boolean(process.env.NUMINA_PROVIDER_SUBMISSION_TOKEN);
  const manifest=project('control-manifest',{
    schema:'numina.control-manifest.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
    release:legacy.RELEASE_IDENTITY.production_version,controls,
    funds:authority.fundsManifest(),
    execution:authority.executionManifest({credentialedProviderSubmitterAvailable}),
    partnership:authority.partnershipManifest(),
    external_execution_performed:false,external_funds_moved:false
  });
  const receipt=legacy.sign(manifest,'NUMINA_CONTROL_MANIFEST');
  if(JSON.stringify(receipt.payload)!==JSON.stringify(manifest))throw new Error('NUMINA_CONTROL_MANIFEST_SIGNATURE_PAYLOAD_MISMATCH');
  res.statusCode=200;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify({manifest,receipt,compatibility:{route:'/v1/control/state',role:'legacy_route_only'}}));
};
