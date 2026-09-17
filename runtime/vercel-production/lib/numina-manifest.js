'use strict';

const {RELEASE_IDENTITY}=require('./numina');

const NUMINA_MANIFEST=Object.freeze({
  schema:'numina.manifest.v1',
  root:'NUMINA',
  source:'NUMINA',
  productionSource:'NUMINA',
  authority:'NUMINA',
  runtime:'NUMINA',
  identity:'NUMINA',
  transition:'NUMINA → NUMINA',
  release:RELEASE_IDENTITY,
  surfaces:Object.freeze({
    controlEvaluate:'NUMINA',executionPrepare:'NUMINA',evidenceBind:'NUMINA',externalConfirmation:'NUMINA',manifest:'NUMINA',status:'NUMINA',controlState:'NUMINA',supplyChain:'NUMINA',releaseAttestation:'NUMINA'
  }),
  evidence:Object.freeze({root:'NUMINA',systemOfRecord:'NUMINA',verificationAuthority:'NUMINA',provenancePreserved:true}),
  compatibility:Object.freeze({retained:true,role:'projection',root:'NUMINA',authority:'NUMINA'})
});

module.exports={NUMINA_MANIFEST};
