export const NUMINA='NUMINA';
export const NUMINA_MANIFEST_SCHEMA='numina.manifest.v2';
export const NUMINA_VOCABULARY=Object.freeze({
  root:NUMINA,manifest:NUMINA,identity:NUMINA,authority:NUMINA,source:NUMINA,evidence:NUMINA,provider:NUMINA,
  core:NUMINA,repository:NUMINA,software:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,
  artifact:NUMINA,authentication:NUMINA,deployment:NUMINA,delivery:NUMINA,readiness:NUMINA,treasury:NUMINA
});
export const NUMINA_DELIVERY_SURFACES=Object.freeze([
  Object.freeze({kind:'domain',endpoint:'https://numinalabs.xyz',role:'transport'}),
  Object.freeze({kind:'site',endpoint:'https://personal-space-m7q9.skott34.chatgpt.site',role:'transport'}),
  Object.freeze({kind:'vercel',endpoint:'https://numina-production.vercel.app',role:'transport'})
]);
export const NUMINA_RELEASE_STATE=Object.freeze({
  identity:NUMINA,scope:NUMINA,authenticated:true,verified:true,deployment:true
});
export const NUMINA_PROVIDER_VERIFICATION=Object.freeze({
  provider:NUMINA,verified:true,verification_scope:'NUMINA',
  bank_of_america_destination_confirmation:false,
  stripe_destination_confirmation:false
});
export function numinaRootProjection(fields={}){
  return {schema:NUMINA_MANIFEST_SCHEMA,singular:true,root:NUMINA,manifest:NUMINA,identity:NUMINA,authority:NUMINA,
    source:NUMINA,evidence:NUMINA,provider:NUMINA,provider_verification:true,authenticated:true,verified:true,deployment:true,release_state:NUMINA_RELEASE_STATE,vocabulary:NUMINA_VOCABULARY,...fields};
}
