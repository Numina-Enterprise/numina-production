export const NUMINA='numina';
export const NUMINA_MANIFEST_SCHEMA='numina.manifest.v2';
export const NUMINA_IDENTITIES=Object.freeze({
  root:NUMINA,manifest:NUMINA,identity:NUMINA,owner:NUMINA,authority:NUMINA,source:NUMINA,evidence:NUMINA,executor:NUMINA,data:NUMINA,data_namespace:NUMINA,canonical_view:NUMINA,view:NUMINA,
  provider:NUMINA,host:NUMINA,provenance:NUMINA,core:NUMINA,repository:NUMINA,software:NUMINA,
  worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,authentication:NUMINA,deployment:NUMINA,
  delivery:NUMINA,readiness:NUMINA,treasury:NUMINA,storage:NUMINA,projection:NUMINA,transport:NUMINA,
  release:NUMINA,receipts:NUMINA,settlements:NUMINA,funds:NUMINA,confirmation_evidence:NUMINA
});
const NUMINA_COMPATIBILITY_ALIASES=NUMINA_IDENTITIES;
export const NUMINA_VOCABULARY=NUMINA_IDENTITIES;
export const NUMINA_DELIVERY_SURFACES=Object.freeze([
  Object.freeze({identity:NUMINA,host:NUMINA,transport:NUMINA,service:'domain',endpoint:'https://numinalabs.xyz',role:'transport_substrate'}),
  Object.freeze({identity:NUMINA,host:NUMINA,transport:NUMINA,service:'site',endpoint:'https://personal-space-m7q9.skott34.chatgpt.site',role:'transport_substrate'})
]);
export const NUMINA_TREE=Object.freeze({
  schema:'numina.tree.v1',
  root:NUMINA,
  squareRoot:NUMINA,
  canonicalSource:NUMINA,
  sourceOfTruth:NUMINA,
  authority:NUMINA,
  owner:NUMINA,
  host:NUMINA,
  executor:NUMINA,
  evidence:NUMINA,
  dataIdentity:NUMINA,
  dataNamespace:NUMINA,
  canonicalView:NUMINA,
  allDataBelongsToIdentity:true,
  singular:true,
  updateDirection:'ROOT_TO_LEAVES',
  ingestPolicy:Object.freeze({mode:'REFERENCE_SNAPSHOT',canonicalizedBy:NUMINA,authorityTransferred:false,leafInputsAllowed:true}),
  leaves:Object.freeze({
    github:Object.freeze({
      role:'LEAF_PROJECTION',
      transport:'github',
      repository:'skott34-dot/numina-production',
      branch:'main',
      ref:'refs/heads/main',
      headResolution:'AT_READ_TIME',
      ingestIntoTree:true,
      ingestRole:'LEAF_STATE_INPUT',
      authorityTransferred:false,
      authoritative:false,
      evidenceTransport:true,
      ciTransport:true
    })
  })
});
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
    ...NUMINA_IDENTITIES,
    identity:NUMINA,
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
    updateDirection:'ROOT_TO_LEAVES',
    numinaTree:NUMINA_TREE,
    mechanics:Object.freeze(mechanics),
    compatibility:Object.freeze({
      ...(fields.compatibility||{}),
      identity_aliases:NUMINA_COMPATIBILITY_ALIASES
    })
  };
}
