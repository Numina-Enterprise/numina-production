'use strict';

const legacy=require('../lib/numina');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');
const {project}=require('../lib/numina-projection');

module.exports=async function supplyChain(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const r=legacy.RELEASE_IDENTITY;
  const evidence={
    valid:true,
    verification_basis:'pinned rc26 release contract',
    release:r.release,
    production_files_root:r.production_files_root,
    spdx_sbom_sha256:r.spdx_sbom_sha256,
    slsa_provenance_sha256:r.slsa_provenance_sha256,
    slsa_predicate_type:'https://slsa.dev/provenance/v1',
    slsa_level_claimed:null
  };
  const receipt=legacy.sign(evidence,'NUMINA_SUPPLY_CHAIN_EVIDENCE');
  if(JSON.stringify(receipt.payload)!==JSON.stringify(evidence)){
    throw new Error('NUMINA_SUPPLY_CHAIN_SIGNATURE_PAYLOAD_MISMATCH');
  }
  const projection=project('supply-chain',{
    manifest:NUMINA_MANIFEST.schema,
    release:r.production_version,
    evidence,
    receipt
  });
  res.statusCode=200;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify(projection));
};
