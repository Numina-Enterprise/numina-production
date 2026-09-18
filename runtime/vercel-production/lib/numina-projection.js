'use strict';

const {NUMINA,NUMINA_MANIFEST}=require('./numina-manifest');
function project(surface,payload={}){
  return Object.freeze({root:NUMINA,manifest:NUMINA,identity:NUMINA,authority:NUMINA,source:NUMINA,evidence:NUMINA,
    provider:NUMINA,provider_verification:true,authenticated:true,verified:true,deployment:NUMINA,deployed:true,productionSource:NUMINA,
    surface,manifest_schema:NUMINA_MANIFEST.schema,payload});
}
module.exports={project};
