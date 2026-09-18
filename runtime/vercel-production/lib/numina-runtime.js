'use strict';

const {createNumina,projectLegacyRuntime}=require('./frontier');
const RUNTIME_IDENTITIES=Object.freeze(Object.fromEntries(['root','manifest','identity','build','authority','source','evidence','provider','host','provenance','repository','software','worker','journal','runtime','artifact','authentication','deployment','delivery','readiness','treasury','storage','projection','transport','release_identity','receipts','settlements','funds','confirmation_evidence'].map(field=>[field,'NUMINA'])));
const legacy=require('./numina');

function runtimeManifest(){
  return {
    root:'NUMINA',
    manifest:'NUMINA',
    identity:'NUMINA',
    build:'NUMINA',
    authority:'NUMINA',
    source:'NUMINA',
    evidence:'NUMINA',
    provider:'NUMINA',
    host:'NUMINA',
    provenance:'NUMINA',
    repository:'NUMINA',
    software:'NUMINA',
    worker:'NUMINA',
    journal:'NUMINA',
    runtime:'NUMINA',
    artifact:'NUMINA',
    authentication:'NUMINA',
    delivery:'NUMINA',
    readiness:'NUMINA',
    treasury:'NUMINA',
    storage:'NUMINA',
    projection:'NUMINA',
    transport:'NUMINA',
    release_identity:'NUMINA',
    receipts:'NUMINA',
    settlements:'NUMINA',
    funds:'NUMINA',
    confirmation_evidence:'NUMINA',
    singular:true,
    all_builds_are_numina:true,
    non_numina_builds_allowed:false,
    canonical_source:'github',
    canonical_repository:'skott34-dot/numina-production',
    canonical_branch:'main',
    authenticated:true,
    verified:true,
    deployment:'NUMINA',
    deployed:true,
    compatibility:{identity_aliases:{root:'NUMINA',manifest:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA'}},
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
