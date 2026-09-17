'use strict';

const legacy=require('../lib/numina');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');
const {project}=require('../lib/numina-projection');

module.exports=async function attestation(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const declaration=project('release-attestation',{
    schema:'numina.release-attestation.v1',
    release:legacy.RELEASE_IDENTITY,
    manifest:NUMINA_MANIFEST,
    runtime:NUMINA_MANIFEST.runtime,
    compatibility:NUMINA_MANIFEST.compatibility
  });
  const receipt=legacy.sign(declaration,'NUMINA_RELEASE_ATTESTATION');
  res.statusCode=200;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify(receipt));
};
