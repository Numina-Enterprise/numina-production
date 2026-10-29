export const NUMINA='NUMINA';
export const NUMINA_MANIFEST_SCHEMA='numina.manifest.v2';
export const NUMINA_FRONTIER_LAYERS=Object.freeze(['L1','L2','L3','L4','L5','L6','L7']);
export const NUMINA_CORE=NUMINA;
export const NUMINA_ACTIVE_CORE=Object.freeze({identity:NUMINA,core:NUMINA,active:true,singular:true,coreCount:1,activeCoreCount:1,environment:'FRONTIER',deploymentEnvironment:'FRONTIER',frontierOnly:true,frontierLayerCount:7,frontierLayers:NUMINA_FRONTIER_LAYERS,status:'FINAL',gate:'CLOSED',finalBuild:'/final-build.json',finalManifest:'/final-manifest.json'});
export const NUMINA_IDENTITIES=Object.freeze({
  root:NUMINA,manifest:NUMINA,identity:NUMINA,owner:NUMINA,authority:NUMINA,source:NUMINA,evidence:NUMINA,executor:NUMINA,data:NUMINA,data_namespace:NUMINA,canonical_view:NUMINA,view:NUMINA,external_record:NUMINA,external_fact:NUMINA,external_evidence:NUMINA,
  provider:NUMINA,host:NUMINA,provenance:NUMINA,core:NUMINA,repository:NUMINA,software:NUMINA,
  worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,authentication:NUMINA,deployment:NUMINA,
  delivery:NUMINA,readiness:NUMINA,treasury:NUMINA,storage:NUMINA,projection:NUMINA,transport:NUMINA,
  release:NUMINA,receipts:NUMINA,settlements:NUMINA,funds:NUMINA,confirmation_evidence:NUMINA,
  hashes:NUMINA,hash_identity:NUMINA,artifact_paths:NUMINA,artifact_path_identity:NUMINA,runtime_ids:NUMINA,runtime_id_identity:NUMINA,security_mechanics:NUMINA,security_mechanics_identity:NUMINA
});
const NUMINA_COMPATIBILITY_ALIASES=NUMINA_IDENTITIES;
export const NUMINA_VOCABULARY=NUMINA_IDENTITIES;
export const NUMINA_DELIVERY_SURFACES=Object.freeze([
  Object.freeze({identity:NUMINA,host:NUMINA,transport:NUMINA,service:'domain',endpoint:'https://numinalabs.xyz',role:'transport_substrate'}),
  Object.freeze({identity:NUMINA,host:NUMINA,transport:NUMINA,service:'site',endpoint:'https://personal-space-m7q9.skott34.chatgpt.site',role:'transport_substrate'})
]);
export const NUMINA_REPOSITORY=Object.freeze({"schema":"numina.repository.v1","identity":"NUMINA","scope":"NUMINA","structure":"NUMINA","appliesTo":"NUMINA","contract":"NUMINA","singular":true,"name":"NUMINA","branch":"main","role":"CANONICAL_ROOT_REPOSITORY","authoritative":true,"canonical":true,"sourceOfTruth":"NUMINA","updateDirection":"NUMINA","runtimeSurfaces":["website","api","mobile","runtime","receipts","treasury","release_artifacts"]});
export const NUMINA_TREE=Object.freeze({schema:'numina.tree.v1',root:NUMINA,squareRoot:NUMINA,canonicalSource:NUMINA,sourceOfTruth:NUMINA,authority:NUMINA,owner:NUMINA,host:NUMINA,executor:NUMINA,evidence:NUMINA,dataIdentity:NUMINA,dataNamespace:NUMINA,canonicalView:NUMINA,allDataBelongsToIdentity:true,externalRecordIdentity:NUMINA,externalFactIdentity:NUMINA,externalEvidenceIdentity:NUMINA,externalRecordsResolveTo:NUMINA,allIdentityBearingRecordsResolveTo:NUMINA,singular:true,core:NUMINA,activeCore:NUMINA,coreCount:1,activeCoreCount:1,environment:'FRONTIER',deploymentEnvironment:'FRONTIER',frontierOnly:true,frontierLayerCount:7,frontierLayers:NUMINA_FRONTIER_LAYERS,rootType:'REPOSITORY',repository:NUMINA_REPOSITORY,updateDirection:'NUMINA',runtimeSurfaces:Object.freeze(["website","api","mobile","runtime","receipts","treasury","release_artifacts"]),ingestPolicy:Object.freeze({mode:'CANONICAL_REPOSITORY',canonicalizedBy:NUMINA,authorityTransferred:false,leafInputsAllowed:false})});
export const NUMINA_PROVIDER_VERIFICATION=Object.freeze({
  ...NUMINA_IDENTITIES,verified:true,verification_scope:NUMINA,
  bank_of_america_destination_confirmation:false,
  stripe_destination_confirmation:false
});
export function numinaRootProjection(fields={}){
  const mechanics={...(fields.mechanics||{})};
  const canonical={};
  for(const [key,value] of Object.entries(fields)){
    if(key==='mechanics'||key==='compatibility')continue;
    if(Object.hasOwn(NUMINA_COMPATIBILITY_ALIASES,key)){mechanics[key]=value;continue;}
    canonical[key]=value;
  }
  return {
    schema:NUMINA_MANIFEST_SCHEMA,
    singular:true,
    scope:NUMINA,
    structure:NUMINA,
    appliesTo:NUMINA,
    contract:NUMINA,
    ...NUMINA_IDENTITIES,
    identity:NUMINA,
    core:NUMINA_CORE,
    activeCore:NUMINA_CORE,
    coreCount:1,
    activeCoreCount:1,
    environment:'FRONTIER',
    deploymentEnvironment:'FRONTIER',
    frontierOnly:true,
    frontierLayerCount:NUMINA_FRONTIER_LAYERS.length,
    frontierLayers:NUMINA_FRONTIER_LAYERS,
    provider_verification:true,
    authenticated:true,
    verified:true,
    deployed:true,
    ...canonical,
    canonicalSource:NUMINA,
    sourceOfTruth:NUMINA,
    squareRoot:NUMINA,
    owner:NUMINA,
    host:NUMINA,
    executor:NUMINA,
    evidence:NUMINA,
    dataIdentity:NUMINA,
    dataNamespace:NUMINA,
    canonicalView:NUMINA,
    allDataBelongsToIdentity:true,
    externalRecordIdentity:NUMINA,
    externalFactIdentity:NUMINA,
    externalEvidenceIdentity:NUMINA,
    externalRecordsResolveTo:NUMINA,
    allIdentityBearingRecordsResolveTo:NUMINA,
    rootType:'REPOSITORY',
    canonicalRepository:NUMINA_REPOSITORY,
    updateDirection:'NUMINA',
    runtimeSurfaces:Object.freeze(["website","api","mobile","runtime","receipts","treasury","release_artifacts"]),
    numinaTree:NUMINA_TREE,
    mechanics:Object.freeze(mechanics),
    compatibility:Object.freeze({
      ...(fields.compatibility||{}),
      identity_aliases:NUMINA_COMPATIBILITY_ALIASES
    })
  };
}
