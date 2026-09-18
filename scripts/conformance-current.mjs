// Public-contract conformance only. No journal writes or signature claims.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RUNTIME_VERSION} from '../public/runtime-contract.js';
const origin=new URL(process.argv[2]||'http://127.0.0.1:8787').origin;
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version;
const get=async path=>{const response=await fetch(origin+path,{signal:AbortSignal.timeout(15000),redirect:'error'});assert.equal(response.status,200,path);return response;};
const results=[];
const check=(name,fn)=>{fn();results.push({name,pass:true});};
const manifestBytes=await (await get('/v'+version.split('.')[0]+'/release/manifest')).text(),manifest=JSON.parse(manifestBytes);
check('current application identity',()=>{assert.equal(manifest.version,version);assert.equal(manifest.schema,'numina.application-release.v2');for(const field of ['root','manifest','identity','authority','source','evidence','provider','core','worker','journal','runtime','artifact','authentication','delivery','readiness','treasury'])assert.equal(manifest[field],'NUMINA');assert.equal(manifest.provider_verification,true);assert.match(manifest.build_id,/^[0-9a-f]{64}$/);});
check('one root across five layers',()=>{assert.equal(manifest.source_alignment.root,'NUMINA');assert.deepEqual(manifest.source_alignment.layers,['L1','L2','L3','L4','L5']);assert.equal(manifest.core_release_binding.rootCount,1);assert.ok(manifest.core_release_binding.release.endsWith(RUNTIME_VERSION));});
for(const path of ['/v2/release/manifest','/v3/release/manifest','/v4/release/manifest','/downloads/application-release-v4.json','/downloads/application-release-v3.json','/downloads/application-release-v2.json']){
 const bytes=await (await get(path)).text();check('identical manifest alias '+path,()=>assert.equal(bytes,manifestBytes));
}
const architecture=await (await get('/api/control/v2/architecture')).json();
check('canonical architecture',()=>{assert.equal(architecture.rootCount,1);assert.equal(architecture.lineageCount,1);assert.equal(architecture.productionEnvironmentCount,1);assert.deepEqual(architecture.layers.map(layer=>layer.id),['L1','L2','L3','L4','L5']);});
const frontier=await (await get('/api/control/v2/manifest')).json();
check('external execution remains gated',()=>{for(const field of ['root','manifest','identity','authority','source','evidence','provider'])assert.equal(frontier[field],'NUMINA');assert.equal(frontier.provider_verification,true);assert.equal(frontier.version,version);assert.equal(frontier.externalExecution,false);assert.ok(frontier.providers.filter(p=>p.kind!=='internal').every(p=>p.submission===false));assert.equal(frontier.treasury,'/api/control/v1/treasury');});
const pricing=await fetch(origin+'/pricing?ref=conformance',{redirect:'manual',signal:AbortSignal.timeout(15000)});
check('merged services and pricing route',()=>{assert.equal(pricing.status,308);assert.equal(pricing.headers.get('location'),'/services?ref=conformance#pricing');});
console.log(JSON.stringify({origin,checkedAt:new Date().toISOString(),scope:'Public contract; no writes, provider execution or signature claims',passed:results.length,results},null,2));
