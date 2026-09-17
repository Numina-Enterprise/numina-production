'use strict';

const legacy=require('../lib/numina');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');

module.exports=async function manifest(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const manifest=NUMINA_MANIFEST;
  const receipt=legacy.sign(manifest,'NUMINA_MANIFEST');
  if(JSON.stringify(receipt.payload)!==JSON.stringify(manifest)){
    throw new Error('NUMINA_MANIFEST_SIGNATURE_PAYLOAD_MISMATCH');
  }
  res.statusCode=200;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify({manifest,receipt}));
};
