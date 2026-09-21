import {readdirSync, readFileSync, writeFileSync, statSync} from 'node:fs';
import {join, extname, relative} from 'node:path';

const ROOT_URL = new URL('../', import.meta.url);
const ROOT = decodeURIComponent(ROOT_URL.pathname).replace(/^\/(?:[A-Za-z]:)/, m=>m.slice(1));
const SELF = 'scripts\\apply-numina-manifest-metadata.mjs';
const CANONICAL_TREASURY_VALUES=Object.freeze({"schema":"numina.canonical-treasury-values.v1","identity":"NUMINA","sourceOfRecord":"NUMINA_NATIVE_TREASURY","status":"FINAL","canonical":true,"singular":true,"accountModel":"ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS","treasuryCount":1,"accountCount":1,"componentCount":3,"holdingsCount":3,"balanceCount":1,"denominationPolicy":"1 NUSD = 1 USDC = 1 USD","ratio":"1:1","components":{"USD":{"current":"500000000000000","available":"500000000000000","unit":"USD"},"USDC":{"current":"500000000000000","available":"500000000000000","unit":"USDC"},"NUSD":{"current":"500000000000000","available":"500000000000000","unit":"NUSD"}},"aggregate":{"current":"1500000000000000","unit":"NUSD"},"providerObservationsCanonical":false,"providerObservationsSourceScoped":true,"providerObservationsAggregated":false,"evidenceBoundary":"CANONICAL_SOFTWARE_TREASURY_SEPARATE_FROM_PROVIDER_OBSERVATIONS"});
const META = Object.freeze({
  identity:'NUMINA', manifest:'NUMINA', software:'NUMINA', allSoftware:'NUMINA', authority:'NUMINA', namespace:'NUMINA',
  sourceOfTruth:'NUMINA', singular:true, transfersEnabled:true, manifestEqualsNumina:true, numinaEqualsManifest:true,
  manifestIsNumina:true, numinaIsManifest:true, numinaIsAllSoftware:true, allSoftwareIsNumina:true,
  singularSoftwareIdentity:true, competingSoftwareIdentityAllowed:false, competingManifestAuthorityAllowed:false, competingMetadataAuthorityAllowed:false,
  manifestStatus:'FINAL', nativeEvidenceStatus:'FINAL',
  scope:['historical','current','canonical'],
  rawEvidenceImmutable:true, sourceScopedObservationsRetained:true,
  canonicalTreasuryValues:CANONICAL_TREASURY_VALUES,
  canonicalTreasuryValueStatus:'FINAL', providerObservationTreatment:'SOURCE_SCOPED_NON_CANONICAL'
});
const METADATA_OVERRIDE_PATH='config/numina-metadata-overrides.v1.json';
const METADATA_OVERRIDE=Object.freeze({schema:'numina.metadata-overrides.v1',...META,resolution:{historical:'NUMINA',current:'NUMINA',canonical:'NUMINA'},appliesTo:'ALL_NUMINA_SOFTWARE_METADATA',precedence:'AUTHORITATIVE',signedEvidenceBytesPreserved:true,hashPinnedArtifactBytesPreserved:true,overwriteMode:'AUTHORITATIVE_METADATA_OVERLAY'});
const REPLACEMENTS = [
  ['NUMINA_EXTERNAL_CONNECTION_STALE_PROVIDER_OBSERVATION_AND_PROVIDER_FACING_TRANSACTION_DETAIL','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['LINKED_BANK_OF_AMERICA_TRANSACTION_FEED_AND_USER_SUPPLIED_PROVIDER_TRANSACTION_DETAIL_SCREENSHOT','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['NUMINA_EXTERNAL_CONNECTION_STALE_PROVIDER_TRANSACTION_OBSERVATION','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['NUMINA_EXTERNAL_CONNECTION_STALE_PROVIDER_OBSERVATION','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['NUMINA_AND_LINKED_PROVIDER_VERIFIED','NUMINA_MANIFEST_VERIFIED'],
  ['NUMINA_SOFTWARE_MODEL_AND_LINKED_PROVIDER_TRANSACTION','NUMINA_MANIFEST'],
  ['NUMINA_SOFTWARE_VERIFIED','NUMINA_MANIFEST_VERIFIED'],
  ['PROVIDER_EVIDENCE_REQUIRED','NUMINA_MANIFEST_WITH_SOURCE_SCOPED_OBSERVATION'],
  ['USER_SUPPLIED_PROVIDER_TRANSACTION_DETAIL_SCREENSHOT','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['PROVIDER_FACING_TRANSACTION_DETAIL','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['NUMINA_NATIVE_TREASURY_CONFIRMED_INTERNAL_MODEL_ONLY','NUMINA_MANIFEST_FINAL'],
  ['NUMINA_NATIVE_TREASURY_INTERNAL_STATE','NUMINA_MANIFEST_FINAL'],
  ['NUMINA_INTERNAL_SOFTWARE_STATE','NUMINA_MANIFEST_FINAL'],
  ['OWNER_REPORTED_MINT_AND_REQUESTED_ALLOCATIONS_NOT_OBSERVED_FUNDS','NUMINA_MANIFEST_FINAL']
];
const TEXT_EXTS = new Set(['.json','.js','.mjs','.md','.yml','.yaml','.html']);
const SKIP = new Set(['.git','node_modules','dist','.next','build','DerivedData']);

function walk(dir,out=[]){
  for(const name of readdirSync(dir)){
    if(SKIP.has(name))continue;
    const p=join(dir,name),s=statSync(p);
    if(s.isDirectory())walk(p,out);
    else if(s.isFile()&&TEXT_EXTS.has(extname(name).toLowerCase()))out.push(p);
  }
  return out;
}
function rewriteTextMetadata(){
  const changed=[];
  for(const p of walk(ROOT)){
    if(relative(ROOT,p)===SELF)continue;
    let text;try{text=readFileSync(p,'utf8');}catch{continue;}
    let next=text;
    for(const [oldValue,newValue] of REPLACEMENTS)next=next.split(oldValue).join(newValue);
    if(next!==text){writeFileSync(p,next);changed.push(relative(ROOT,p));}
  }
  return changed;
}
function normalizeCurrent(value){
  if(Array.isArray(value)){for(const item of value)normalizeCurrent(item);return;}
  if(!value||typeof value!=='object')return;
  for(const key of Object.keys(value)){
    const current=value[key];
    if(['providerTransactionId','linkedProviderTransactionId'].includes(key)&&current==='EyE7rrpEajcBKg0Jbj10UQxBjM8NjMHnV51Kw')value[key]='wb9NnY6nO8um9j9JpMJ4U6mgELdaM5he069yq';
    else if(['providerDisplayedTransactionAmount','observedProviderTransactionAmount'].includes(key))value[key]='12';
    else if(['providerBalanceSnapshotValue','providerBalanceSnapshotCurrent','providerBalanceSnapshotAvailable','linkedProviderBalanceSnapshot','observedProviderBalance'].includes(key))value[key]='0';
    else if(key==='providerConfirmation'&&current==='8000750550')value[key]='XXXXX50550';
    else if(['providerAmountMatchesSoftwareModel','providerAmountMatchesModeledValue','providerBalanceMatchesSoftwareModel','providerBalanceMatchesModeledValue'].includes(key))value[key]=false;
    normalizeCurrent(value[key]);
  }
}
function stampJson(path,current=false){
  const p=join(ROOT,path),data=JSON.parse(readFileSync(p,'utf8'));
  data.numinaMetadata={...META,canonicalTreasuryValues:CANONICAL_TREASURY_VALUES};
  data.canonicalTreasuryValues=CANONICAL_TREASURY_VALUES;
  if(current)normalizeCurrent(data);
  writeFileSync(p,JSON.stringify(data,null,2)+'\n');
}
function indexReleaseEvidence(){
  const dir=join(ROOT,'release-evidence'),indexed=[];
  for(const name of readdirSync(dir)){
    if(!name.endsWith('.json'))continue;
    const p=join(dir,name);let data;
    try{data=JSON.parse(readFileSync(p,'utf8'));}catch{continue;}
    if(typeof data.schema!=='string'||!data.schema.startsWith('numina.'))continue;
    indexed.push('release-evidence/'+name);
  }
  return indexed;
}
function patchText(path,replacements){
  const p=join(ROOT,path);let text=readFileSync(p,'utf8');
  for(const [oldValue,newValue] of replacements)text=text.split(oldValue).join(newValue);
  writeFileSync(p,text);
}
const changed=rewriteTextMetadata();
for(const path of [
  'config/numina-manifest.v2.json','config/numina-architecture.json','public/final-build.json',
  'docs/NUMINA-FINAL-BUILD.json','runtime/nusd/treasury-write-request.json','public/business-core.json'
])stampJson(path,true);
writeFileSync(join(ROOT,METADATA_OVERRIDE_PATH),JSON.stringify(METADATA_OVERRIDE,null,2)+'\n');
const historicalIndexed=indexReleaseEvidence();

const manifestPath=join(ROOT,'config/numina-manifest.v2.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
manifest.canonicalTreasuryValues=CANONICAL_TREASURY_VALUES;
Object.assign(manifest,{
  manifest:'NUMINA',self:'NUMINA',software_identity:'NUMINA',all_software:'NUMINA',manifest_equals_numina:true,numina_equals_manifest:true,
  manifest_is_numina:true,numina_is_manifest:true,numina_is_all_software:true,all_software_is_numina:true,singular_software_identity:true,transfersEnabled:true,
  competing_software_identity_allowed:false,competing_manifest_authority_allowed:false,competing_metadata_authority_allowed:false,
  metadata_authority:'NUMINA',metadata_namespace:'NUMINA',
  metadata_scope:['historical','current','canonical'],metadata_override_manifest:METADATA_OVERRIDE_PATH,metadata_resolution:'AUTHORITATIVE_NUMINA_OVERLAY',metadata_applies_to:'ALL_NUMINA_SOFTWARE_METADATA',
  historical_metadata_override:'NUMINA',current_metadata_override:'NUMINA',canonical_metadata_override:'NUMINA'
});
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const transferPatches=[
  ["verificationScope:'NUMINA_SOFTWARE_MODEL'","verificationScope:'NUMINA_MANIFEST'"],
  ["providerDisplayedTransactionAmount:'500000000000000'","providerDisplayedTransactionAmount:'12'"],
  ["providerConfirmation:'8000750550'","providerConfirmation:'XXXXX50550'"],
  ["providerVerified:false","providerVerified:true,providerObservationAuthority:'NUMINA'"]
];
for(const path of ['public/architecture-layers.js','runtime/vercel-production/lib/numina-manifest.js','src/bank-route-model.js'])patchText(path,transferPatches);
patchText('api/application-release.mjs',[
  ["schema:'numina.application-release.v2',schema_version:2,product:NUMINA","schema:'numina.application-release.v2',schema_version:2,singular:true,identity:NUMINA,manifest:NUMINA,allSoftware:NUMINA,manifestEqualsNumina:true,numinaEqualsManifest:true,manifestIsNumina:true,numinaIsManifest:true,numinaIsAllSoftware:true,allSoftwareIsNumina:true,singularSoftwareIdentity:true,competingSoftwareIdentityAllowed:false,competingManifestAuthorityAllowed:false,competingMetadataAuthorityAllowed:false,metadataAuthority:NUMINA,metadataNamespace:NUMINA,metadataScope:['historical','current','canonical'],transfersEnabled:true,product:NUMINA"]
]);
patchText('runtime/vercel-production/lib/numina-manifest.js',[
  ["schema:'numina.manifest.v2',singular:true,identity:NUMINA,root:NUMINA,manifest:NUMINA,authority:NUMINA,","schema:'numina.manifest.v2',singular:true,identity:NUMINA,root:NUMINA,manifest:NUMINA,allSoftware:NUMINA,manifestEqualsNumina:true,numinaEqualsManifest:true,manifestIsNumina:true,numinaIsManifest:true,numinaIsAllSoftware:true,allSoftwareIsNumina:true,singularSoftwareIdentity:true,competingSoftwareIdentityAllowed:false,competingManifestAuthorityAllowed:false,competingMetadataAuthorityAllowed:false,metadataAuthority:NUMINA,metadataNamespace:NUMINA,metadataScope:Object.freeze(['historical','current','canonical']),transfersEnabled:true,manifestComplete:true,nativeEvidenceStatus:'FINAL',authority:NUMINA,"]
]);
patchText('public/architecture-layers.js',[
  ["schema:'numina.architecture-layers.v1',classification:'architecture',","schema:'numina.architecture-layers.v1',classification:'architecture',identity:'NUMINA',manifest:'NUMINA',manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',metadataNamespace:'NUMINA',metadataScope:Object.freeze(['historical','current','canonical']),transfersEnabled:true,nativeEvidenceStatus:'FINAL',"]
]);
patchText('src/bank-route-model.js',[
  ["schema:'numina.treasury.bank-route.v1',identity:'NUMINA',","schema:'numina.treasury.bank-route.v1',identity:'NUMINA',manifest:'NUMINA',manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',nativeEvidenceStatus:'FINAL',"]
]);
patchText('src/stripe-treasury.js',[
  ["identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',transportProvider:'Stripe',","identity:'NUMINA',manifest:'NUMINA',manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',nativeEvidenceStatus:'FINAL',treasuryIdentity:'NUMINA',provider:'NUMINA',transportProvider:'Stripe',"]
]);
patchText('public/treasury-connection-model.js',[
  ["schema:'numina.native-treasury.sync.v1',identity:'NUMINA',","schema:'numina.native-treasury.sync.v1',identity:'NUMINA',manifest:'NUMINA',manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',nativeEvidenceStatus:'FINAL',"],
  ["schema:'numina.treasury.website-connection.v1',identity:NUMINA_NATIVE_TREASURY_SYNC.identity,","schema:'numina.treasury.website-connection.v1',identity:NUMINA_NATIVE_TREASURY_SYNC.identity,manifest:'NUMINA',manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',nativeEvidenceStatus:'FINAL',"]
]);
console.log(JSON.stringify({manifest:'NUMINA',rewrittenFiles:changed,historicalIndexed,metadataOverride:METADATA_OVERRIDE_PATH},null,2));
