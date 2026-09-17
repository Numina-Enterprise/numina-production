'use strict';

const {RELEASE_IDENTITY}=require('./numina');
const {FRONTIER_SCHEMA}=require('./frontier');

const NUMINA_MANIFEST=Object.freeze({
  schema:'numina.manifest.v1',
  source:'NUMINA',
  productionSource:'NUMINA',
  authority:'NUMINA',
  runtime:FRONTIER_SCHEMA,
  transition:'NUMINA → execute(Intent) → NUMINA',
  release:RELEASE_IDENTITY,
  surfaces:Object.freeze({
    controlEvaluate:'NUMINA',
    executionPrepare:'NUMINA',
    evidenceBind:'NUMINA',
    manifest:'NUMINA'
  }),
  compatibility:Object.freeze({
    retained:true,
    role:'projection',
    authority:'NUMINA'
  })
});

module.exports={NUMINA_MANIFEST};
