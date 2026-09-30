import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const paths=['public/final-build.json','public/final-manifest.json'];
const genesis='0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1';
const json=p=>JSON.parse(readFileSync(root+p));
const write=(p,v)=>writeFileSync(root+p,JSON.stringify(v,null,2)+'\n');
// Exclude only the bindings being derived and the manifest's cross-file pins.
// Keep treasury evidence, software versions and all unrelated source data.
const derived=new Set(['universalPair','productionBinding','universalPairBuildCount','universalPairBuilds','universalPairArtifacts','universalPairSources','currentSourceIds','currentBuildIds','environmentBindings','frontierFinalRuntimes']);
export function pairSourcePayload(value,path=[]){
 if(Array.isArray(value))return value.map(v=>pairSourcePayload(v,path));
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.keys(value).sort().filter(key=>!derived.has(key)&&
  !(path.length===0&&['frontierId','canonicalSha256'].includes(key))&&
  !(path.at(-1)==='finalBuild'&&['gitBlobSha1','sha256','canonicalSha256'].includes(key)))
  .map(key=>[key,pairSourcePayload(value[key],[...path,key])]));
}
export function pairSourceHash(value){return createHash('sha256').update(JSON.stringify(pairSourcePayload(value))).digest('hex');}
export function verifyProductionPair(){
 const sources=paths.map(path=>({path,sha256:pairSourceHash(json(path))}));
 for(const path of [...paths,'public/current-environments.json']){
  const v=json(path),pair=v.universalPair;
  assert.equal(pair?.schema,'numina.universal-pair.production.v1');
  assert.equal(pair.genesisHash,genesis);assert.equal(pair.bound,true);
  assert.deepEqual(pair.sources,sources);assert.equal(pair.bindingCount,4);
  assert.deepEqual(pair.bindings,sources.flatMap((source,index)=>['LIVE','FRONTIER_FINAL'].map(environment=>({sourceIndex:index+1,sourceId:source.sha256,derivedHashId:source.sha256,environment,artifacts:paths}))));
  assert.equal(v.productionBinding.regenerationRequired,false);assert.equal(v.productionBinding.productionDeploymentAllowed,true);
 }
 assert.ok(JSON.stringify(json('runtime/nusd/deployment-receipt.json')).includes(genesis));
 return {identity:'NUMINA',sources,genesisHash:genesis,bindingsVerified:true,providerExecutionVerified:false};
}
function regenerate(){
 const sources=paths.map(path=>({path,sha256:pairSourceHash(json(path))}));
 const bindings=sources.flatMap((source,index)=>['LIVE','FRONTIER_FINAL'].map(environment=>({sourceIndex:index+1,sourceId:source.sha256,derivedHashId:source.sha256,environment,artifacts:paths})));
 const pair={schema:'numina.universal-pair.production.v1',identity:'NUMINA',status:'SOURCE_BOUND',bound:true,genesisHash:genesis,genesisSource:'runtime/nusd/deployment-receipt.json',sourceDigestAlgorithm:'sha256',sourceDigestScope:'sorted-json-source-payload-excluding-derived-bindings-and-cross-file-pins',sourceDigestImplementation:'scripts/production-pair.mjs#pairSourcePayload',sources,bindingCount:bindings.length,bindings,providerExecutionVerified:false};
 const gate={status:'SOURCE_BOUND',bound:true,regenerationRequired:false,productionDeploymentAllowed:true,genesisHash:genesis,scope:'SOFTWARE_SOURCE_BINDINGS_ONLY',providerExecutionVerified:false};
 for(const path of [...paths,'public/current-environments.json']){
  const v=json(path);v.universalPair=pair;v.productionBinding=gate;v.currentSourceIds=sources.map(s=>s.sha256);v.currentBuildIds=[...v.currentSourceIds];v.environmentBindings=bindings;v.universalPairBuildCount=2;v.universalPairSources=sources;
  if(path.endsWith('current-environments.json')){
   Object.assign(v,{status:'SOURCE_BOUND',sourceIdCount:2,idCount:2,bindingCount:4,id:v.currentSourceIds,ids:v.currentSourceIds,sourceIds:v.currentSourceIds,derivedHashIds:v.currentSourceIds,sourceIdSources:paths,idMirrorsSourceIds:true,derivedHashIdsMirrorSourceIds:true,bindings,everyCellReceivesBothFiles:true});
   v.invariant={schema:'numina.derived-hash-source-invariant.v1',name:'DERIVED_HASH_ID_EQUALS_SOURCE_ID',expression:'derivedHashId = sourceId',scope:'UNIVERSAL_PAIR_2X2',bindingCount:4,enforced:true};
  }
  write(path,v);
 }
 execFileSync(process.execPath,['scripts/apply-numina-manifest-metadata.mjs'],{cwd:root,stdio:'inherit'});
 console.log(JSON.stringify(verifyProductionPair()));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length>1||args.some(a=>a!=='--write'))throw Error('Usage: node scripts/production-pair.mjs [--write]');
 if(args.includes('--write'))regenerate();else console.log(JSON.stringify(verifyProductionPair()));
}
