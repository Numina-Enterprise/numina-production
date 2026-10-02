// Public contract checks distinguish artifact declarations from full inventories.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const origin=new URL(process.argv[2]||'http://127.0.0.1:8787').origin;
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version;
const get=async path=>{const response=await fetch(origin+path,{signal:AbortSignal.timeout(15000),redirect:'error'});assert.equal(response.status,200,path);return response;};
const results=[];
const check=(name,fn)=>{fn();results.push({name,pass:true});};
const manifestBytes=await (await get('/v4/release/manifest')).text(),manifest=JSON.parse(manifestBytes);
const inventoryBytes=await (await get('/downloads/application-release-v4.json')).text(),inventory=JSON.parse(inventoryBytes);
check('application identity and artifact inventory binding',()=>{
 for(const record of [manifest,inventory]){
  assert.equal(record.version,version);assert.equal(record.schema,'numina.application-release.v2');
  assert.equal(record.identity,'NUMINA');assert.match(record.build_id,/^[0-9a-f]{64}$/);
  assert.ok(['Numina','NUMINA'].includes(record.product));
 }
 assert.equal(manifest.build_id,inventory.build_id);
 for(const item of manifest.artifacts??[])assert.deepEqual(item,inventory.artifacts.find(full=>full.path===item.path));
});
for(const path of ['/v2/release/manifest','/v3/release/manifest']){
 const bytes=await (await get(path)).text();check('artifact declaration alias '+path,()=>assert.equal(bytes,manifestBytes));
}
for(const path of ['/downloads/application-release-v3.json','/downloads/application-release-v2.json']){
 const bytes=await (await get(path)).text();check('full inventory alias '+path,()=>assert.equal(bytes,inventoryBytes));
}
const architecture=await (await get('/api/control/v2/architecture')).json();
check('one root across five architecture layers',()=>{assert.equal(architecture.rootCount,1);assert.equal(architecture.lineageCount,1);assert.equal(architecture.productionEnvironmentCount,1);assert.deepEqual(architecture.layers.map(layer=>layer.id),['L1','L2','L3','L4','L5']);});
const frontier=await (await get('/api/control/v2/manifest')).json();
check('external execution remains gated',()=>{assert.equal(frontier.identity,'NUMINA');assert.equal(frontier.version,version);assert.equal(frontier.externalExecution,false);assert.ok(frontier.providers.filter(p=>p.kind!=='internal').every(p=>p.submission===false));assert.equal(frontier.treasury,'/api/control/v1/treasury');});
const state=await (await get('/api/control/v2/state-reconciliation')).json();
check('scoped state is aligned across public records',()=>{
 assert.equal(state.schema,'numina.state-reconciliation.v1');
 for(const record of [frontier,architecture,inventory,manifest])assert.deepEqual(record.stateReconciliation,state);
 assert.equal(state.implementedSoftwareState.externalExecution,false);
 assert.equal(state.providerConfirmedState.numinaControlExecutionLinked,false);
 assert.equal(state.providerConfirmedState.nusdConversionVerified,false);
 assert.equal(state.roots.rootMutationPerformed,false);
});
const pricing=await fetch(origin+'/pricing?ref=conformance',{redirect:'manual',signal:AbortSignal.timeout(15000)});
check('merged services and pricing route',()=>{assert.equal(pricing.status,308);assert.equal(pricing.headers.get('location'),'/services?ref=conformance#pricing');});
console.log(JSON.stringify({origin,checkedAt:new Date().toISOString(),scope:'Public readbacks; no writes, provider execution or signature attestation',passed:results.length,results},null,2));
