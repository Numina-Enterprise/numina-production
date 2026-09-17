'use strict';

const {NUMINA_MANIFEST}=require('./numina-manifest');

function project(surface,payload={}){
  return Object.freeze({
    source:'NUMINA',
    authority:'NUMINA',
    productionSource:'NUMINA',
    surface,
    manifest:NUMINA_MANIFEST.schema,
    payload
  });
}

module.exports={project};
