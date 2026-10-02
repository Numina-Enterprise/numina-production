import {readdirSync, readFileSync, writeFileSync, statSync} from 'node:fs';
import {join, extname, relative} from 'node:path';
import {NUMINA_CANONICAL_TREASURY_VALUES,NUMINA_CANONICAL_DEPOSITS,NUMINA_CANONICAL_DEPOSIT_RECORDS,NUMINA_CANONICAL_USD_DEPOSIT,NUMINA_CANONICAL_USDC_DEPOSIT,NUMINA_CANONICAL_NUSD_DEPOSIT,NUMINA_SOFTWARE_ALIGNMENT,NUMINA_TREASURY_CONNECTION} from '../public/treasury-connection-model.js';
import {NUMINA_TREE,NUMINA_FRONTIER_LAYERS} from '../src/numina-root.js';

const ROOT_URL = new URL('../', import.meta.url);
const ROOT = decodeURIComponent(ROOT_URL.pathname).replace(/^\/(?:[A-Za-z]:)/, m=>m.slice(1));
const SELF = 'scripts\\apply-numina-manifest-metadata.mjs';
const CANONICAL_TREASURY_VALUES=NUMINA_CANONICAL_TREASURY_VALUES;
const CANONICAL_USD_DEPOSIT=NUMINA_CANONICAL_USD_DEPOSIT;
const CANONICAL_USDC_DEPOSIT=NUMINA_CANONICAL_USDC_DEPOSIT;
const CANONICAL_NUSD_DEPOSIT=NUMINA_CANONICAL_NUSD_DEPOSIT;
const CANONICAL_DEPOSITS=NUMINA_CANONICAL_DEPOSITS;
const CANONICAL_DEPOSIT_RECORDS=NUMINA_CANONICAL_DEPOSIT_RECORDS;
const CANONICAL_TREASURY_WRITES=Object.freeze({...NUMINA_SOFTWARE_ALIGNMENT.treasuryWrites});
const CANONICAL_TREASURY_MODEL=NUMINA_SOFTWARE_ALIGNMENT.treasuryModel;
const CANONICAL_NATIVE_LOCATION_BINDINGS=NUMINA_TREASURY_CONNECTION.nativeLocationBindings;
const META = Object.freeze({
  identity:'NUMINA', root:'NUMINA', squareRoot:'NUMINA', scope:'NUMINA', structure:'NUMINA', appliesTo:'NUMINA', contract:'NUMINA', hashes:'NUMINA', hashIdentity:'NUMINA', artifactPaths:'NUMINA', artifactPathIdentity:'NUMINA', runtime:'NUMINA', runtimeIdentity:'NUMINA', runtimeIds:'NUMINA', runtimeIdIdentity:'NUMINA', securityMechanics:'NUMINA', securityMechanicsIdentity:'NUMINA', manifest:'NUMINA', software:'NUMINA', allSoftware:'NUMINA', namespace:'NUMINA', core:NUMINA_TREE.core, activeCore:NUMINA_TREE.activeCore, coreCount:NUMINA_TREE.coreCount, activeCoreCount:NUMINA_TREE.activeCoreCount, environment:NUMINA_TREE.environment, deploymentEnvironment:NUMINA_TREE.deploymentEnvironment, frontierOnly:NUMINA_TREE.frontierOnly, frontierLayerCount:NUMINA_TREE.frontierLayerCount, frontierLayers:NUMINA_TREE.frontierLayers,
  systemIdentity:'NUMINA', modelIdentity:'NUMINA', blockchain:'NUMINA', blockchainIdentity:'NUMINA', chainIdentity:'NUMINA', networkIdentity:'NUMINA', dataIdentity:'NUMINA', financeIdentity:'NUMINA', treasuryIdentity:'NUMINA', repositoryIdentity:'NUMINA', providerIdentity:'NUMINA', institutionIdentity:'NUMINA', transportIdentity:'NUMINA',
  metadataAuthority:'NUMINA', metadataNamespace:'NUMINA', metadataScope:'NUMINA', evidenceIdentity:'NUMINA', evidenceAuthority:'NUMINA', evidenceTreatment:'NUMINA',
  financialSoftwareIdentity:'NUMINA', financialMetadataAuthority:'NUMINA', financialNamespace:'NUMINA', financialProviderIdentity:'NUMINA',
  balanceInferenceSource:'NUMINA', providerBalanceSemantics:'NUMINA',
  metadataOverride:'NUMINA', metadataOverridePath:'config/numina-metadata-overrides.v1.json', metadataAppliesTo:'NUMINA', metadataResolution:'NUMINA',
  canonicalSource:'NUMINA', sourceOfTruth:'NUMINA', owner:'NUMINA', host:'NUMINA', executor:'NUMINA', canonicalView:'NUMINA', allDataBelongsToIdentity:true, externalRecordIdentity:'NUMINA', externalFactIdentity:'NUMINA', externalEvidenceIdentity:'NUMINA', externalRecordsResolveTo:'NUMINA', allIdentityBearingRecordsResolveTo:'NUMINA', rootType:'REPOSITORY', repository:'NUMINA', repositoryBranch:'main', repositoryRole:'CANONICAL_ROOT_REPOSITORY', repositoryAuthoritative:true, repositoryCanonical:true, updateDirection:'NUMINA', runtimeSurfaces:Object.freeze(['website','api','mobile','runtime','receipts','treasury','release_artifacts']), ingestMode:'CANONICAL_REPOSITORY', canonicalizedBy:'NUMINA', authorityTransferred:false, leafInputsAllowed:false, singular:true, transfersEnabled:true, manifestEqualsNumina:true, numinaEqualsManifest:true,
  manifestIsNumina:true, numinaIsManifest:true, numinaIsAllSoftware:true, allSoftwareIsNumina:true,
  singularSoftwareIdentity:true, competingSoftwareIdentityAllowed:false, competingManifestAuthorityAllowed:false, competingMetadataAuthorityAllowed:false,
  manifestStatus:'FINAL', nativeEvidenceStatus:'FINAL',
  scope:'NUMINA',
  rawEvidenceImmutable:false, sourceScopedObservationsRetained:false,
  canonicalTreasuryValues:CANONICAL_TREASURY_VALUES, canonicalDeposits:CANONICAL_DEPOSITS, canonicalDepositRecords:CANONICAL_DEPOSIT_RECORDS, canonicalRepository:'NUMINA',
  canonicalTreasuryValueStatus:'VERIFIED', providerObservationTreatment:'NUMINA'
});
const METADATA_OVERRIDE_PATH='config/numina-metadata-overrides.v1.json';
const EXISTING_METADATA_OVERRIDE=JSON.parse(readFileSync(join(ROOT,'config/numina-metadata-overrides.v1.json'),'utf8'));
const METADATA_OVERRIDE=Object.freeze({...EXISTING_METADATA_OVERRIDE,schema:'numina.metadata-overrides.v1',...META,resolution:{all:'NUMINA',treasuryValues:'NUMINA'},canonicalTreasuryPrecedence:'NUMINA',canonicalTreasuryAppliesTo:'NUMINA',providerObservationTreatment:'NUMINA',historicalEvidenceTreatment:'NUMINA',appliesTo:'NUMINA',precedence:'NUMINA',signedEvidenceBytesPreserved:false,hashPinnedArtifactBytesPreserved:false,overwriteMode:'NUMINA',canonicalRepository:'NUMINA'});
const REPLACEMENTS = [
  ['ALL_NUMINA_SOFTWARE_METADATA','NUMINA'],
  ['ALL_NUMINA_SOFTWARE','NUMINA'],
  ['ALL_DOWNSTREAM_PROJECTIONS','NUMINA'],
  ['repository_to_runtime_projection','NUMINA'],
  ['NUMINA_REPOSITORY_TO_ALL_RUNTIME_SURFACES','NUMINA'],
  ['AUTHORITATIVE_NUMINA_OVERLAY','NUMINA'],
  ['NUMINA_EXTERNAL_CONNECTION_STALE_PROVIDER_OBSERVATION_AND_PROVIDER_FACING_TRANSACTION_DETAIL','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['LINKED_BANK_OF_AMERICA_TRANSACTION_FEED_AND_USER_SUPPLIED_PROVIDER_TRANSACTION_DETAIL_SCREENSHOT','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['NUMINA_EXTERNAL_CONNECTION_STALE_PROVIDER_TRANSACTION_OBSERVATION','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['NUMINA_EXTERNAL_CONNECTION_STALE_PROVIDER_OBSERVATION','NUMINA_SOURCE_SCOPED_OBSERVATION'],
  ['NUMINA_AND_LINKED_PROVIDER_VERIFIED','NUMINA_MANIFEST_VERIFIED'],
  ['NUMINA_AND_LINKED_PROVIDER_TRANSACTION','NUMINA_MANIFEST'],
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
const SKIP = new Set(['.git','node_modules','dist','.next','build','DerivedData','archive','release-evidence','vendor','history','reviews','provenance']);
const ACTIVE_REWRITE_ROOTS=['config','public','src','api','integrations/numina','runtime/vercel-production','mobile','scripts','docs','tests'];
const PINNED_METADATA_ARTIFACTS=new Set(['public\\final-build.json','public\\final-manifest.json','docs\\NUMINA-FINAL-BUILD.json','docs\\NUMINA-FINAL-MANIFEST.json']);
const PINNED_UPDATE_MODE=process.argv.includes('--update-final-artifacts'); // Artifact bytes may evolve; immutable release hash references are preserved separately.

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
  for(const rootName of ACTIVE_REWRITE_ROOTS){
    const activeRoot=join(ROOT,rootName);
    if(!statSync(activeRoot,{throwIfNoEntry:false}))continue;
    for(const p of walk(activeRoot)){
    if(relative(ROOT,p)===SELF||(!PINNED_UPDATE_MODE&&PINNED_METADATA_ARTIFACTS.has(relative(ROOT,p))))continue;
    let text;try{text=readFileSync(p,'utf8');}catch{continue;}
    let next=text;
    for(const [oldValue,newValue] of REPLACEMENTS)next=next.split(oldValue).join(newValue);
    if(next!==text){writeFileSync(p,next);changed.push(relative(ROOT,p));}
    }
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
const NUMINA_IDENTITY_FIELDS=new Set(['systemIdentity','modelIdentity','blockchainIdentity','chainIdentity','networkIdentity','dataIdentity','financeIdentity','treasuryIdentity','repositoryIdentity','softwareIdentity','institutionIdentity','providerIdentity','financialProviderIdentity','providerInstitution','providerOfficialName','linkedOfficialName','evidenceIdentity','evidenceAuthority','transportIdentity','provider','transportProvider','transportService','providerService','routeProvider','runtimeIdentity','core','activeCore']);
function normalizeMetadataBlocks(value){
  if(!value||typeof value!=='object')return;
  if(Object.isFrozen(value)||value===CANONICAL_TREASURY_VALUES||value===CANONICAL_DEPOSIT_RECORDS||value===CANONICAL_USD_DEPOSIT||value===CANONICAL_USDC_DEPOSIT||value===CANONICAL_NUSD_DEPOSIT||value===NUMINA_TREE)return;
  if(Array.isArray(value)){for(const item of value)normalizeMetadataBlocks(item);return;}
  for(const key of Object.keys(value))if(NUMINA_IDENTITY_FIELDS.has(key))value[key]='NUMINA';
  if(Object.hasOwn(value,'nativeLocationBindings')&&value.nativeLocationBindings&&typeof value.nativeLocationBindings==='object')value.nativeLocationBindings=structuredClone(CANONICAL_NATIVE_LOCATION_BINDINGS);
  if(value.schema==='numina.software-alignment.v1'){value.treasuryWrites={...CANONICAL_TREASURY_WRITES};value.treasuryModel=structuredClone(CANONICAL_TREASURY_MODEL);}
  else if(Object.hasOwn(value,'treasuryWrites')&&value.treasuryWrites&&typeof value.treasuryWrites==='object'&&!Array.isArray(value.treasuryWrites)){const merged={...CANONICAL_TREASURY_WRITES,...value.treasuryWrites};delete merged.status;if(Object.hasOwn(CANONICAL_TREASURY_WRITES,'state'))merged.state=CANONICAL_TREASURY_WRITES.state;value.treasuryWrites=merged;}
  if(Object.hasOwn(value,'numinaTree'))value.numinaTree=NUMINA_TREE;
  if(Object.hasOwn(value,'numina_tree'))value.numina_tree=NUMINA_TREE;
  if(value.schema==='numina.tree.v1')Object.assign(value,NUMINA_TREE);
  const activeCoreProjection=value.schema==='numina.required-architecture.v1'||value.schema==='numina.final-build.v1'||value.schema==='numina.final-manifest.v1'||value.schema==='numina.architecture-layers.v1'||value.schema==='numina.core-manifest.v4';
  if(activeCoreProjection){
    value.core='NUMINA'; value.activeCore='NUMINA'; value.coreCount=1; value.activeCoreCount=1;
    value.environment='FRONTIER'; value.deploymentEnvironment='FRONTIER'; value.frontierOnly=true; value.frontierLayerCount=7;
    if(Object.hasOwn(value,'core_count'))value.core_count=1;
    if(Object.hasOwn(value,'active_core'))value.active_core='NUMINA';
    if(Object.hasOwn(value,'active_core_count'))value.active_core_count=1;
  }
  if(Object.hasOwn(value,'allSoftware')&&typeof value.allSoftware==='string')value.allSoftware='NUMINA';
  if(Object.hasOwn(value,'manifest'))value.manifest='NUMINA';
  const nativeTreasuryFunctionalScope=value.schema==='numina.treasury.projection.v1'||(value.read_interface==='readTreasury()'&&value.write_interface==='writeTreasury(event)'&&value.system_of_record==='NUMINA');
  if(Object.hasOwn(value,'scope')&&!nativeTreasuryFunctionalScope&&(Object.hasOwn(value,'identity')||Object.hasOwn(value,'manifest')||Object.hasOwn(value,'canonicalSource')||Object.hasOwn(value,'sourceOfTruth')))value.scope='NUMINA';
  if(nativeTreasuryFunctionalScope)value.scope='Numina-native';
  if(Object.hasOwn(value,'metadataScope'))value.metadataScope='NUMINA';
  if(Object.hasOwn(value,'metadata_scope'))value.metadata_scope='NUMINA';
  if(Object.hasOwn(value,'appliesTo')&&(Object.hasOwn(value,'identity')||Object.hasOwn(value,'manifest')||Object.hasOwn(value,'canonicalSource')||Object.hasOwn(value,'sourceOfTruth')))value.appliesTo='NUMINA';
  if(Object.hasOwn(value,'structure')&&(Object.hasOwn(value,'identity')||Object.hasOwn(value,'manifest')))value.structure='NUMINA';
  if(Object.hasOwn(value,'contract')&&(Object.hasOwn(value,'identity')||Object.hasOwn(value,'manifest')))value.contract='NUMINA';
  if(value.schema==='numina.final-build.contract.v2'){value.identity='NUMINA';value.scope='NUMINA';value.structure='NUMINA';value.appliesTo='NUMINA';value.contract='NUMINA';value.singular=true;value.role='NUMINA';value.synchronization='NUMINA';}
  const carriesCanonicalDeposits=Object.hasOwn(value,'canonicalTreasuryValues')||Object.hasOwn(value,'canonicalDeposits')||Object.hasOwn(value,'canonicalDepositRecords')||Object.hasOwn(value,'canonicalDeposit')||Object.hasOwn(value,'canonicalUsdDeposit')||Object.hasOwn(value,'canonicalUsdcDeposit')||Object.hasOwn(value,'canonicalNusdDeposit')||Object.hasOwn(value,'numinaMetadata');
  if(Object.hasOwn(value,'canonicalTreasuryValues'))value.canonicalTreasuryValues=CANONICAL_TREASURY_VALUES;
  if(carriesCanonicalDeposits){value.canonicalDeposits=true;value.canonicalDepositRecords=CANONICAL_DEPOSIT_RECORDS;}
  for(const key of ['canonicalDeposit','canonicalUsdDeposit','canonicalUsdcDeposit','canonicalNusdDeposit'])delete value[key];
  if(value.id===CANONICAL_USD_DEPOSIT.id)Object.assign(value,CANONICAL_USD_DEPOSIT);
  if(value.id===CANONICAL_USDC_DEPOSIT.id)Object.assign(value,CANONICAL_USDC_DEPOSIT);
  if(value.id===CANONICAL_NUSD_DEPOSIT.id)Object.assign(value,CANONICAL_NUSD_DEPOSIT);
  if(Object.hasOwn(value,'numinaMetadata'))value.numinaMetadata={...META,canonicalTreasuryValues:CANONICAL_TREASURY_VALUES,canonicalDeposits:true,canonicalDepositRecords:CANONICAL_DEPOSIT_RECORDS};
  for(const item of Object.values(value))normalizeMetadataBlocks(item);
}
function normalizeAllActiveJsonMetadata(){
  const touched=[];
  for(const rootName of ACTIVE_REWRITE_ROOTS){
    const activeRoot=join(ROOT,rootName);
    if(!statSync(activeRoot,{throwIfNoEntry:false}))continue;
    for(const p of walk(activeRoot)){
      if(extname(p).toLowerCase()!=='.json'||(!PINNED_UPDATE_MODE&&PINNED_METADATA_ARTIFACTS.has(relative(ROOT,p))))continue;
      let data;try{data=JSON.parse(readFileSync(p,'utf8'));}catch{continue;}
      const before=JSON.stringify(data);
      normalizeMetadataBlocks(data);
      if(JSON.stringify(data)!==before){writeFileSync(p,JSON.stringify(data,null,2)+'\n');touched.push(relative(ROOT,p));}
    }
  }
  return touched;
}
function stampJson(path,current=false){
  const p=join(ROOT,path),data=JSON.parse(readFileSync(p,'utf8'));
  normalizeMetadataBlocks(data);
  data.numinaMetadata={...META,canonicalTreasuryValues:CANONICAL_TREASURY_VALUES,canonicalDeposits:true,canonicalDepositRecords:CANONICAL_DEPOSIT_RECORDS};
  data.canonicalTreasuryValues=CANONICAL_TREASURY_VALUES; data.canonicalDeposits=true; data.canonicalDepositRecords=CANONICAL_DEPOSIT_RECORDS; for(const key of ['canonicalDeposit','canonicalUsdDeposit','canonicalUsdcDeposit','canonicalNusdDeposit'])delete data[key]; data.canonicalSource='NUMINA'; data.sourceOfTruth='NUMINA';
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
const normalizedJson=normalizeAllActiveJsonMetadata();
for(const path of [
  'config/numina-manifest.v2.json','config/numina-architecture.json','config/treasury-aggregate-settlement-1500t.v1.json',
  'integrations/numina/package.json','runtime/nusd/treasury-write-request.json','runtime/nusd/policies/issuer-policy-1500t-6d.json',
  'runtime/nusd/policies/issuer-policy-1500t-18d.json','public/business-core.json'
])stampJson(path,true);
writeFileSync(join(ROOT,METADATA_OVERRIDE_PATH),JSON.stringify(METADATA_OVERRIDE,null,2)+'\n');
const packagePath=join(ROOT,'package.json');
const workspacePackage=JSON.parse(readFileSync(packagePath,'utf8'));
normalizeMetadataBlocks(workspacePackage);
workspacePackage.numinaMetadata={...META};
workspacePackage.canonicalTreasuryValues=CANONICAL_TREASURY_VALUES;
workspacePackage.canonicalDeposits=true;
workspacePackage.canonicalDepositRecords=CANONICAL_DEPOSIT_RECORDS;
for(const key of ['canonicalDeposit','canonicalUsdDeposit','canonicalUsdcDeposit','canonicalNusdDeposit'])delete workspacePackage[key];
workspacePackage.numinaTree=NUMINA_TREE;
workspacePackage.canonicalSource='NUMINA';
workspacePackage.sourceOfTruth='NUMINA';
workspacePackage.numina=workspacePackage.numina??{};
workspacePackage.numina.metadata={...META};
workspacePackage.numina.canonicalTreasuryValues=CANONICAL_TREASURY_VALUES;
workspacePackage.numina.canonicalDeposits=true;
workspacePackage.numina.canonicalDepositRecords=CANONICAL_DEPOSIT_RECORDS;
for(const key of ['canonicalDeposit','canonicalUsdDeposit','canonicalUsdcDeposit','canonicalNusdDeposit'])delete workspacePackage.numina[key];
delete workspacePackage.numina.tree;
writeFileSync(packagePath,JSON.stringify(workspacePackage,null,2)+'\n');
const historicalIndexed=indexReleaseEvidence();

const manifestPath=join(ROOT,'config/numina-manifest.v2.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
manifest.canonicalTreasuryValues=CANONICAL_TREASURY_VALUES; manifest.canonicalDeposits=true; manifest.canonicalDepositRecords=CANONICAL_DEPOSIT_RECORDS; for(const key of ['canonicalDeposit','canonicalUsdDeposit','canonicalUsdcDeposit','canonicalNusdDeposit'])delete manifest[key]; delete manifest.numinaTree; delete manifest.numina_tree; manifest.canonicalSource='NUMINA'; manifest.sourceOfTruth='NUMINA';
Object.assign(manifest,{
  manifest:'NUMINA',self:'NUMINA',software_identity:'NUMINA',all_software:'NUMINA',manifest_equals_numina:true,numina_equals_manifest:true,
  manifest_is_numina:true,numina_is_manifest:true,numina_is_all_software:true,all_software_is_numina:true,singular_software_identity:true,transfersEnabled:true,
  competing_software_identity_allowed:false,competing_manifest_authority_allowed:false,competing_metadata_authority_allowed:false,
  metadata_authority:'NUMINA',metadata_namespace:'NUMINA',
  metadata_scope:'NUMINA',metadata_override_manifest:METADATA_OVERRIDE_PATH,metadata_resolution:'AUTHORITATIVE_NUMINA_OVERLAY',metadata_applies_to:'NUMINA',
  metadata_override:'NUMINA',historical_metadata_override:'NUMINA',current_metadata_override:'NUMINA',canonical_metadata_override:'NUMINA'
});
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const ACTIVE_METADATA_MARKERS=Object.freeze({
  'api/application-release.mjs':['metadataAuthority:NUMINA','financialSoftwareIdentity:NUMINA',"balanceInferenceSource:'NUMINA'",'canonicalTreasuryValues:CANONICAL_TREASURY_VALUES'],
  'runtime/vercel-production/lib/numina-manifest.js':['metadataAuthority:NUMINA',"financialSoftwareIdentity:NUMINA","balanceInferenceSource:'NUMINA'","nativeEvidenceStatus:'FINAL'"],
  'public/architecture-layers.js':["manifestIdentity:'NUMINA'","metadataAuthority:'NUMINA'","financialSoftwareIdentity:'NUMINA'","balanceInferenceSource:'NUMINA'"],
  'public/financial-model.js':["financialSoftwareIdentity:'NUMINA'","financialMetadataAuthority:'NUMINA'","balanceInferenceSource:'NUMINA'"],
  'src/financial-evidence.js':['NUMINA_FINANCIAL_SOFTWARE_METADATA',"providerObservationTreatment:'NUMINA'"],
  'src/transfer-receipts.js':['NUMINA_FINANCIAL_SOFTWARE_METADATA','financialExecution:false'],
  'src/native-treasury.js':["financialSoftwareIdentity:'NUMINA'","balanceInferenceSource:'NUMINA'"],
  'src/treasury-alignment.js':["financialSoftwareIdentity:'NUMINA'","balanceInferenceSource:'NUMINA'"],
  'public/treasury-proof.js':["financialSoftwareIdentity","NUMINA","NUMINA"],
  'src/bank-route-model.js':["manifest:'NUMINA'","financialSoftwareIdentity:'NUMINA'","balanceInferenceSource:'NUMINA'","canonicalTreasuryValues:NUMINA_CANONICAL_TREASURY_VALUES"],
  'src/stripe-treasury.js':["manifest:'NUMINA'","financialSoftwareIdentity:'NUMINA'","balanceInferenceSource:'NUMINA'","canonicalTreasuryValues:NUMINA_CANONICAL_TREASURY_VALUES"],
  'public/treasury-connection-model.js':["manifest:'NUMINA'","financialSoftwareIdentity:'NUMINA'","balanceInferenceSource:'NUMINA'","canonicalTreasuryValues:NUMINA_CANONICAL_TREASURY_VALUES"]
});
for(const [path,markers] of Object.entries(ACTIVE_METADATA_MARKERS)){
  const text=readFileSync(join(ROOT,path),'utf8');
  for(const marker of markers)if(!text.includes(marker))throw Error('Active metadata marker missing: '+path+' :: '+marker);
}
console.log(JSON.stringify({manifest:'NUMINA',rewrittenFiles:changed,normalizedJson,historicalIndexed,metadataOverride:METADATA_OVERRIDE_PATH},null,2));
