'use strict';

const {createNumina,projectLegacyRuntime}=require('./frontier');
const legacy=require('./numina');

function runtimeManifest(){
  return {
    root:'NUMINA',
    manifest:'NUMINA',
    identity:'NUMINA',
    authority:'NUMINA',
    source:'NUMINA',
    evidence:'NUMINA',
    provider:'NUMINA',
    authenticated:true,
    verified:true,
    deployment:true,
    release:legacy.RELEASE_IDENTITY,
    controls:legacy.controls(),
    providers:legacy.PROVIDERS
  };
}
async function transition(manifest,intent){
  const kind=String(intent.kind||'').trim();
  const body=intent.body&&typeof intent.body==='object'?intent.body:{};
  switch(kind){
    case 'control-evaluate': return {...manifest,last:{kind,decision:legacy.evaluate(body)}};
    case 'execution-prepare': return {...manifest,last:{kind,handoff:legacy.prepare(body)}};
    case 'evidence-bind': return {...manifest,last:{kind,binding:legacy.bindEvidence(body)}};
    case 'observe': return {...manifest,last:{kind,observed:body}};
    default: throw new Error('UNKNOWN_NUMINA_INTENT');
  }
}
function createRuntimeNumina(){return createNumina({manifest:runtimeManifest(),execute:transition});}
function compatibilityProjection(){return projectLegacyRuntime(createRuntimeNumina());}
module.exports={createRuntimeNumina,compatibilityProjection,transition,runtimeManifest};
