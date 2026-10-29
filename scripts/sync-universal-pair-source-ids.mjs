import fs from 'node:fs';
import crypto from 'node:crypto';

const BUILD='public/final-build.json';
const MANIFEST='public/final-manifest.json';
const PACKAGE='package.json';
const BINDING='config/numina-current-environments.json';
const PUBLIC_BINDING='public/current-environments.json';
const SOURCE_RECORD='config/numina-universal-pair-source-ids.json';
const FILES=[BUILD,MANIFEST];
const ROUTES=['/final-build.json','/final-manifest.json'];
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const IMMUTABLE_RELEASE_HASHES=Object.freeze({finalBuildSha256:'996f0ce7cc8cc5809969c6aaf5188d5c3a9a6332dbe5fd231cca974152a115fa',finalManifestSha256:'c9300f87f0ccfe1f2e2e132ecfa9e5de9a23f144dcdfa682849fe6f7bcc09b63'});

const record=read(SOURCE_RECORD);
const SOURCE_IDS=record.sourceIds;
const SOURCE_SOURCES=record.sourceIdSources||[];
const ENVIRONMENTS=record.environments||['FRONTIER'];
if(!Array.isArray(SOURCE_IDS)||SOURCE_IDS.length!==1)throw Error('NUMINA_SOURCE_ID_COUNT');
if(SOURCE_IDS.some(id=>!/^[0-9a-f]{64}$/.test(id)))throw Error('NUMINA_SOURCE_ID_FORMAT');

const removed=new Set([
  'state','derivedHashId','derivedHashIds','derivedHashIdEqualsSourceId','derivedHashIdsMirrorSourceIds',
  'cells','sourceCells','cellCount'
]);
function clean(value,parentKey=null){
  if(Array.isArray(value))return value.map(item=>clean(item,parentKey));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([k])=>!(removed.has(k)&&!(parentKey==='treasuryWrites'&&k==='state')))
    .map(([k,v])=>[k,clean(v,k)]));
}

const build=clean(read(BUILD));
const frontierInventoryRecords=(build.runtimeInventory?.frontierRuntimes||[]);
const frontierRuntimeIds=frontierInventoryRecords.map(x=>x.runtimeId).filter(Boolean);

const members=SOURCE_IDS.map((sourceId,index)=>({
  member:index+1,identity:'NUMINA',scope:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,role:'UNIVERSAL_PAIR_SOURCE',status:'FINAL',
  id:sourceId,sourceId,buildId:sourceId,sourceIdSource:SOURCE_SOURCES[index]||null,
  files:[...ROUTES],environments:[...ENVIRONMENTS],
  receives:{identity:'NUMINA',scope:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,status:'FINAL',files:[...ROUTES],environments:[...ENVIRONMENTS],
    finalBuild:ROUTES[0],finalManifest:ROUTES[1]}
}));

const sourceId=SOURCE_IDS[0];
const bindings=frontierRuntimeIds.map((runtimeTargetId,bindingIndex)=>({
  bindingIndex:bindingIndex+1,sourceIndex:1,id:sourceId,sourceId,buildId:sourceId,
  sourceIdSource:SOURCE_SOURCES[0]||null,environmentIndex:1,environment:'FRONTIER',
  identity:'NUMINA',scope:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,status:'FINAL',artifacts:[...FILES],routes:[...ROUTES],
  finalBuild:FILES[0],finalManifest:FILES[1],
  runtimeTargetId,runtimeTargets:[runtimeTargetId]
}));

const universalPair={
  schema:'numina.universal-pair.v4',identity:'NUMINA',scope:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,status:'FINAL',matrix:'1x2',
  memberCount:1,sourceCount:1,environmentCount:1,bindingCount:bindings.length,
  idField:'sourceId',id:[...SOURCE_IDS],ids:[...SOURCE_IDS],sourceIds:[...SOURCE_IDS],
  sourceIdSources:[...SOURCE_SOURCES],idMirrorsSourceIds:true,
  environments:[...ENVIRONMENTS],files:[...ROUTES],artifacts:[...FILES],
  bothReceive:['FINAL_BUILD','FINAL_MANIFEST'],everyCellReceivesBothFiles:true,
  members,appliesTo:'NUMINA',scope:'NUMINA'
};

const pairBuilds=SOURCE_IDS.map((sourceId,index)=>({
  index:index+1,identity:'NUMINA',scope:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,role:'UNIVERSAL_PAIR_BUILD',status:'FINAL',
  id:sourceId,sourceId,buildId:sourceId,sourceIdSource:SOURCE_SOURCES[index]||null,
  environments:[...ENVIRONMENTS],files:[...ROUTES],artifacts:[...FILES],
  appliesTo:'NUMINA',scope:'NUMINA'
}));

function applyPair(target){
  target.identity='NUMINA';
  target.scope='NUMINA';
  target.structure='NUMINA';
  target.appliesTo='NUMINA';
  target.contract='NUMINA';
  target.hashIdentity='NUMINA';
  target.artifactPathIdentity='NUMINA';
  target.runtimeIdIdentity='NUMINA';
  target.securityMechanicsIdentity='NUMINA';
  target.singular=true;
  target.universalPair=universalPair;
  target.universalPairBuildCount=1;
  target.universalPairBuilds=pairBuilds;
  target.universalPairSources=members;
  target.universalPairArtifacts=[...FILES];
  target.currentSourceIds=[...SOURCE_IDS];
  target.currentSourceCount=1;
  target.currentBuildIds=[...SOURCE_IDS];
  target.currentEnvironments=[...ENVIRONMENTS];
  target.environmentCount=1;
  target.environmentBindings=bindings;
  if(target.runtimeInventory){
    const frontierRuntimes=(target.runtimeInventory.frontierRuntimes||[]).map((x,index)=>({...x,index:index+1,identity:'NUMINA',scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',hashIdentity:'NUMINA',artifactPathIdentity:'NUMINA',runtimeIdIdentity:'NUMINA',securityMechanicsIdentity:'NUMINA',singular:true,role:`FRONTIER_RUNTIME_${index+1}`,status:'FINAL',deploymentEnvironment:'FRONTIER',carriedForward:true}));
    const liveRuntimes=(target.runtimeInventory.liveRuntimes||frontierRuntimes.map((x,index)=>({index:index+1,identity:'NUMINA',runtimeId:x.mergedRuntimeId,role:index===0?'LIVE_APPLICATION_RUNTIME':'LIVE_RC27_RUNTIME',status:'LIVE',version:x.mergedVersion,appliesTo:'NUMINA',scope:'NUMINA',deploymentEnvironment:'FRONTIER',carriedForward:true}))).map((x,index)=>({...x,index:index+1,identity:'NUMINA',scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',hashIdentity:'NUMINA',artifactPathIdentity:'NUMINA',runtimeIdIdentity:'NUMINA',securityMechanicsIdentity:'NUMINA',singular:true,deploymentEnvironment:'FRONTIER',carriedForward:true}));
    target.runtimeInventory={identity:'NUMINA',singular:true,deploymentEnvironment:'FRONTIER',carriedForward:true,liveRuntimeCount:liveRuntimes.length,liveRuntimes,frontierRuntimeCount:frontierRuntimes.length,totalRuntimeRecords:liveRuntimes.length+frontierRuntimes.length,frontierRuntimes};
    target.liveRuntimeCount=liveRuntimes.length;
    target.liveRuntimes=liveRuntimes;
  }
  if(target.runtimeModel){
    const frontierRuntimes=(target.runtimeInventory?.frontierRuntimes||[]).map(({mergedRecordSha256,...x})=>x);
    const liveRuntimes=(target.runtimeInventory?.liveRuntimes||[]).map(({runtimeId,appliesTo,scope,...x})=>x);
    target.runtimeModel={...target.runtimeModel,deploymentEnvironment:'FRONTIER',carriedForward:true,liveRuntimeCount:liveRuntimes.length,liveRuntimes,frontierRuntimeCount:frontierRuntimes.length,frontierRuntimes,universalPairBuildCount:1,universalPairBuilds:pairBuilds,universalPairArtifacts:[...FILES]};
    for(const key of ['frontierFinalRuntimeCount','frontierFinalRuntimes'])delete target.runtimeModel[key];
  }
  delete target.sourceCells;
}

applyPair(build);
build.immutableReleaseHashes=IMMUTABLE_RELEASE_HASHES;
build.hashSemantics={immutableReleaseHashes:'PRESERVED_RELEASE_REFERENCE',currentContentHashes:'COMPUTED_FROM_CURRENT_BYTES'};
write(BUILD,build);
const buildContentSha256=digest(BUILD);

const manifest=clean(read(MANIFEST));
applyPair(manifest);
manifest.immutableReleaseHashes=IMMUTABLE_RELEASE_HASHES;
manifest.hashSemantics={immutableReleaseHashes:'PRESERVED_RELEASE_REFERENCE',currentContentHashes:'COMPUTED_FROM_CURRENT_BYTES'};
manifest.canonicalSha256=IMMUTABLE_RELEASE_HASHES.finalBuildSha256;
manifest.frontierId=IMMUTABLE_RELEASE_HASHES.finalBuildSha256;
manifest.finalBuild={...(manifest.finalBuild||{}),path:BUILD,sha256:IMMUTABLE_RELEASE_HASHES.finalBuildSha256,sha256Semantics:'IMMUTABLE_RELEASE_REFERENCE',currentContentSha256:buildContentSha256,canonicalSha256:IMMUTABLE_RELEASE_HASHES.finalBuildSha256,
  identity:'NUMINA',scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,status:'FINAL',applicationVersion:build.applicationVersion,
  universal:true};
write(MANIFEST,manifest);
const manifestContentSha256=digest(MANIFEST);

const resolvedPair={
  schema:'numina.universal-pair.resolved.v2',identity:'NUMINA',scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',hashIdentity:'NUMINA',artifactPathIdentity:'NUMINA',runtimeIdIdentity:'NUMINA',securityMechanicsIdentity:'NUMINA',singular:true,status:'FINAL',matrix:'1x2',
  id:[...SOURCE_IDS],ids:[...SOURCE_IDS],sourceIds:[...SOURCE_IDS],
  sourceIdSources:[...SOURCE_SOURCES],idMirrorsSourceIds:true,
  members,environments:[...ENVIRONMENTS],artifacts:[...FILES],routes:[...ROUTES],
  everyCellReceivesBothFiles:true
};

const binding={
  schema:'numina.current-environments.v6',identity:'NUMINA',scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',hashIdentity:'NUMINA',artifactPathIdentity:'NUMINA',runtimeIdIdentity:'NUMINA',securityMechanicsIdentity:'NUMINA',singular:true,status:'FINAL',matrix:'1x2',
  sourceIdCount:1,idCount:1,environmentCount:1,bindingCount:bindings.length,
  id:[...SOURCE_IDS],ids:[...SOURCE_IDS],sourceIds:[...SOURCE_IDS],
  sourceIdSources:[...SOURCE_SOURCES],idMirrorsSourceIds:true,
  environments:[...ENVIRONMENTS],artifacts:[...FILES],routes:[...ROUTES],
  everyCellReceivesBothFiles:true,
  contentHashes:{...IMMUTABLE_RELEASE_HASHES},contentHashSemantics:'IMMUTABLE_RELEASE_REFERENCE',
  currentContentHashes:{finalBuildSha256:buildContentSha256,finalManifestSha256:manifestContentSha256},
  immutableReleaseHashes:IMMUTABLE_RELEASE_HASHES,
  frontierId:IMMUTABLE_RELEASE_HASHES.finalBuildSha256,universalPair:resolvedPair,bindings,
  deploymentInventory:{environment:'FRONTIER',carriedForward:true,liveRuntimeCount:build.runtimeInventory?.liveRuntimeCount??0,frontierRuntimeCount:build.runtimeInventory?.frontierRuntimeCount??0,totalRuntimeRecords:build.runtimeInventory?.totalRuntimeRecords??0,liveRuntimeIds:(build.runtimeInventory?.liveRuntimes||[]).map(x=>x.runtimeId),frontierRuntimeIds:(build.runtimeInventory?.frontierRuntimes||[]).map(x=>x.runtimeId)},
  appliesTo:'NUMINA',scope:'NUMINA'
};
write(BINDING,binding);
write(PUBLIC_BINDING,binding);

const pkg=clean(read(PACKAGE));
applyPair(pkg.numina);
pkg.numina.resolvedUniversalPair=resolvedPair;
pkg.numina.immutableReleaseHashes=IMMUTABLE_RELEASE_HASHES;
pkg.numina.finalBuildManifest={...(pkg.numina.finalBuildManifest||{}),path:BUILD,sha256:IMMUTABLE_RELEASE_HASHES.finalBuildSha256,sha256Semantics:'IMMUTABLE_RELEASE_REFERENCE',currentContentSha256:buildContentSha256,
  identity:'NUMINA',scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',role:'NUMINA',synchronization:'NUMINA',singular:true,status:'FINAL',universal:true};
pkg.numina.finalManifest={...(pkg.numina.finalManifest||{}),path:MANIFEST,sha256:IMMUTABLE_RELEASE_HASHES.finalManifestSha256,sha256Semantics:'IMMUTABLE_RELEASE_REFERENCE',currentContentSha256:manifestContentSha256,
  canonicalBuildSha256:IMMUTABLE_RELEASE_HASHES.finalBuildSha256,currentCanonicalBuildSha256:buildContentSha256,identity:'NUMINA',scope:'NUMINA',structure:'NUMINA',appliesTo:'NUMINA',contract:'NUMINA',singular:true,status:'FINAL',universal:true};
write(PACKAGE,pkg);

fs.copyFileSync(BUILD,'docs/NUMINA-FINAL-BUILD.json');
fs.copyFileSync(MANIFEST,'docs/NUMINA-FINAL-MANIFEST.json');

console.log(JSON.stringify({
  identity:'NUMINA',sourceIds:SOURCE_IDS,bindingCount:bindings.length,
  immutableReleaseHashes:IMMUTABLE_RELEASE_HASHES,currentContentHashes:{finalBuildSha256:buildContentSha256,finalManifestSha256:manifestContentSha256},matrix:'1x2'
},null,2));
