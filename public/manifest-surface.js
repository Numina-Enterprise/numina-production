// Fixed routes in the Numina Sites worker. Historical RC26 URLs stay in its
// signed records; they are not current health or manifest destinations.
export const MANIFEST_ROUTES=Object.freeze({
  manifest:'/api/control/v1/manifest',
  release:'/v4/release/manifest',
  inventory:'/downloads/application-release-v4.json',
  health:'/api/control/v1/health',
  capabilities:'/api/control/v2/manifest',
  head:'/api/control/v2/head',
  networkEvidence:'/api/nusd/v1/status'
});
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value);

export function canonicalManifest(value){
  if(value?.schema!=='numina.manifest.v2'||value.singular!==true||
    !['root','identity','manifest','authority','repository'].every(key=>value[key]==='NUMINA')||
    !version(value.version)||!version(value.applicationVersion)||value.applicationRelease!=='numina-v'+value.applicationVersion||
    value.mechanics?.repository?.identity!=='NUMINA'||value.mechanics.repository.source!=='/NUMINA'||
    !hash(value.mechanics?.artifact?.build_id)||!version(value.mechanics?.runtime?.version)||
    typeof value.mechanics.runtime.release!=='string')throw Error('Canonical manifest identity is incomplete or unexpected.');
  return value;
}

export function alignedApplication(manifest,value){
  canonicalManifest(manifest);
  const runtime=value?.runtime_dependency;
  if(value?.schema!=='numina.application-release.v2'||value.schema_version!==2||value.singular!==true||
    value.identity!=='NUMINA'||value.manifest!=='NUMINA'||value.product!=='Numina'||value.release_channel!=='production'||
    value.version!==manifest.applicationVersion||value.release!==manifest.applicationRelease||
    value.frontier?.version!==value.version||value.distribution?.codex_plugin?.version!==value.version||
    value.build_id!==manifest.mechanics.artifact.build_id||runtime?.identity!=='NUMINA'||runtime.singular!==true||
    runtime.version!==manifest.mechanics.runtime.version||runtime.release!==manifest.mechanics.runtime.release)
    throw Error('Application inventory and canonical manifest do not identify the same build and runtime dependency.');
  return value;
}

export function controlHealth(value){
  if(value?.identity!=='NUMINA'||value.root!=='NUMINA'||!version(value.version)||!['ready','degraded'].includes(value.status)||
    !['storage','manifestIntegrity','evidenceHead','journalContinuity','authorityConfigured'].every(key=>typeof value.checks?.[key]==='boolean')||
    !Number.isSafeInteger(value.revision)||value.revision<0||!Number.isSafeInteger(value.eventCount)||value.eventCount<0||
    value.status==='ready'&&(!Object.values(value.checks).every(flag=>flag===true)||value.eventCount!==value.revision+1))
    throw Error('Control health response is incomplete or unexpected.');
  return value;
}
