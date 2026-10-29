'use strict';

const legacy=require('../lib/numina');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');
const {project}=require('../lib/numina-projection');

module.exports=async function status(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const credentialedProviderSubmitterAvailable=Boolean(process.env.NUMINA_PROVIDER_SUBMISSION_TOKEN);
  const status=project('status',{
    root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
    release:legacy.RELEASE_IDENTITY,
    controls:legacy.ownerControls(legacy.controls()),
    funds:legacy.fundsManifest(),
    execution:legacy.executionManifest({credentialedProviderSubmitterAvailable}),
    partnership:legacy.partnershipManifest(),
    runtime:NUMINA_MANIFEST.runtime,
    external_execution_performed:false,external_funds_moved:false
  });
  const receipt=legacy.sign(status,'NUMINA_PRODUCTION_STATUS');
  if(JSON.stringify(receipt.payload)!==JSON.stringify(status))throw new Error('NUMINA_PRODUCTION_STATUS_PAYLOAD_MISMATCH');
  res.statusCode=200;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify({status,receipt}));
};
