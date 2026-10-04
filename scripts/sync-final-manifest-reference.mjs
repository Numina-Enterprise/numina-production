import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {pairSourceHash,verifyProductionPair} from './production-pair.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>readFileSync(path.join(root,file));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// Verify the private originals before deriving a deliberately small public
// reference. This does not change the pair, prove live balances, or authorize
// execution. Never spread a FINAL object into a public projection.
export function createFinalManifestReference({manifestBytes,buildBytes,applicationVersion}){
 const manifest=JSON.parse(manifestBytes),build=JSON.parse(buildBytes);
 for(const [record,schema]of [[manifest,'numina.final-manifest.v1'],[build,'numina.final-build.v1']]){
  assert.equal(record.schema,schema);assert.equal(record.identity,'NUMINA');
  assert.equal(record.status,'FINAL');assert.equal(record.applicationVersion,applicationVersion);
  assert.equal(record.sourceOfTruth,'NUMINA');assert.equal(record.canonicalSource,'NUMINA');
  assert.equal(record.productionBinding.scope,'SOFTWARE_SOURCE_BINDINGS_ONLY');
  assert.equal(record.productionBinding.providerExecutionVerified,false);
 }
 assert.equal(manifest.finalBuild.sha256,sha(buildBytes),'Exact private FINAL build preimage');
 const sources=[{path:'public/final-build.json',sha256:pairSourceHash(build)},{path:'public/final-manifest.json',sha256:pairSourceHash(manifest)}];
 for(const record of [manifest,build])assert.deepEqual(record.universalPair.sources,sources,'Exact normalized private source pair');
 assert.deepEqual(manifest.canonicalTreasuryValues,build.canonicalTreasuryValues,'Private recorded values agree');
 return {
  applicationVersion,
  scope:'SOFTWARE_SOURCE_BINDINGS_ONLY',
  manifest:{route:'/final-manifest.json',access:'authenticated_owner'},
  build:{route:'/final-build.json',access:'authenticated_owner'},
  currentTreasury:{route:'/api/control/v1/treasury',status:'AUTHENTICATED_CURRENT_RECORD_REQUIRED'}
 };
}

export function syncFinalManifestReference({write=false}={}){
 verifyProductionPair();
 const manifestBytes=read('public/final-manifest.json'),buildBytes=read('public/final-build.json');
 assert.deepEqual(manifestBytes,read('docs/NUMINA-FINAL-MANIFEST.json'));
 assert.deepEqual(buildBytes,read('docs/NUMINA-FINAL-BUILD.json'));
 const applicationVersion=JSON.parse(read('package.json')).version;
 const reference=createFinalManifestReference({manifestBytes,buildBytes,applicationVersion});
 const config=JSON.parse(read('config/numina-manifest.v2.json'));
 config.finalManifestReference=reference;
 const outputs=new Map([
  ['public/final-manifest-reference.js','// Generated owner-evidence discovery only; private identities and values are not projected.\nexport const NUMINA_FINAL_MANIFEST_REFERENCE=Object.freeze('+JSON.stringify(reference,null,2)+');\n'],
  ['runtime/vercel-production/final-manifest-reference.json',JSON.stringify(reference,null,2)+'\n'],
  ['config/numina-manifest.v2.json',JSON.stringify(config,null,2)+'\n']
 ]);
 const staleFiles=[...outputs].filter(([file,body])=>{try{return read(file).toString()!==body;}catch(error){if(error.code==='ENOENT')return true;throw error;}}).map(([file])=>file);
 if(write)for(const file of staleFiles)writeFileSync(path.join(root,file),outputs.get(file));
 return {consistent:staleFiles.length===0,staleFiles,privateOriginalsModified:false,providerExecutionPerformed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).some(arg=>arg!=='--write'))throw Error('Usage: node scripts/sync-final-manifest-reference.mjs [--write]');
 const write=process.argv.includes('--write'),result=syncFinalManifestReference({write});
 console.log(JSON.stringify(result));if(!write&&!result.consistent)process.exitCode=1;
}
