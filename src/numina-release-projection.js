'use strict';

function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}

function requireNuminaProjection(value,surface){
  if(!object(value))throw new Error('NUMINA_PROJECTION_INVALID');
  if(value.source!=='NUMINA'||value.authority!=='NUMINA'||value.productionSource!=='NUMINA')throw new Error('NUMINA_PROJECTION_AUTHORITY_MISMATCH');
  if(surface&&value.surface!==surface)throw new Error('NUMINA_PROJECTION_SURFACE_MISMATCH');
  if(!object(value.payload))throw new Error('NUMINA_PROJECTION_PAYLOAD_INVALID');
  return value;
}

function releaseFromManifest(value){
  if(object(value)&&value.schema==='numina.manifest.v1'&&value.source==='NUMINA'&&value.productionSource==='NUMINA'&&value.authority==='NUMINA'&&object(value.release))return value.release;
  const projection=requireNuminaProjection(value,'manifest');
  if(object(projection.payload.release))return projection.payload.release;
  throw new Error('NUMINA_MANIFEST_RELEASE_MISSING');
}

function releaseFromAttestation(envelope){
  if(!object(envelope)||!object(envelope.payload))throw new Error('NUMINA_ATTESTATION_INVALID');
  const projection=requireNuminaProjection(envelope.payload,'release-attestation');
  if(object(projection.payload.release))return projection.payload.release;
  throw new Error('NUMINA_ATTESTATION_RELEASE_MISSING');
}

function controlFromProjection(value){
  const projection=requireNuminaProjection(value,'control-state');
  return projection.payload;
}

module.exports={requireNuminaProjection,releaseFromManifest,releaseFromAttestation,controlFromProjection};
