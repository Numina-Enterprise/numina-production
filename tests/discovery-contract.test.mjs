import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import sourceWorker from '../src/worker.js';
import builtWorker from '../dist/server/index.js';
import {checkConnection as sourceCheck} from '../public/connection-model.js';
import {checkConnection as builtCheck} from '../dist/client/connection-model.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {publicMetadata} from '../src/public-privacy.js';

const origin='https://numina.test';
const sha=value=>createHash('sha256').update(value).digest('hex');
// Discovery may consume its rate limit, but must never access private state.
const env={NUMINA_TELEMETRY_LOGS:'false',DB:{
 prepare(sql){assert.match(sql,/numina_limits_v1/);return {bind(){return this;},async first(){return {count:1};}};},
 async batch(){return [{results:[]},{results:[{count:1}]}];}
}};
const implementations=[['source',sourceWorker,sourceCheck],['built',builtWorker,builtCheck]];
const architectureSource=new URL('../public/architecture-layers.js',import.meta.url);
const originalSourceHash=sha(readFileSync(architectureSource));
const originalModel=JSON.stringify(NUMINA_LAYERS);
const projection=publicMetadata(NUMINA_LAYERS);
const projectedHash=sha(JSON.stringify(projection));
assert.notEqual(projectedHash,sha(originalModel),'Fixture must contain privately retained fields');

for(const [name,worker,check] of implementations){
 for(const path of ['/api/control/v2/discovery-mcp','/mcp']){
  test(`${name} anonymous architecture tool at ${path} returns only the public projection`,async()=>{
   const request=new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'privacy-regression',method:'tools/call',params:{name:'numina_architecture',arguments:{}}})});
   assert.equal(request.headers.has('Authorization'),false);assert.equal(request.headers.has('Cookie'),false);
   const response=await worker.fetch(request,env);
   assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);
   const payload=await response.json();assert.equal(payload.id,'privacy-regression');assert.equal(payload.result.isError,false);
   assert.equal(payload.result.content.length,1);assert.equal(payload.result.content[0].type,'text');
   const text=payload.result.content[0].text,architecture=JSON.parse(text);
   // Compare hashes so a failing regression does not print retained private values.
   assert.equal(sha(JSON.stringify(architecture)),projectedHash,'Architecture tool must match the public metadata projection');
   assert.doesNotMatch(text,/\b(?:acct|fa|finaddr)_[A-Za-z0-9]+\b|Savings\s+\d{4}\b/);
   const inspect=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
     if(['accountLast4','linkedAccountLast4','confirmation','assertedConfirmation','providerConfirmation'].includes(key))assert.equal(item,null,`${key} must remain private`);
     inspect(item);
    }
   };
   inspect(architecture);
   assert.deepEqual(architecture.layers.map(layer=>layer.id),['L1','L2','L3','L4','L5']);
   const publicResponse=await worker.fetch(new Request(origin+'/api/control/v2/architecture'),env);
   assert.equal(publicResponse.status,200);assert.equal(sha(JSON.stringify(await publicResponse.json())),projectedHash);
   assert.equal(sha(readFileSync(architectureSource)),originalSourceHash,'Private source bytes must be preserved');
   assert.equal(JSON.stringify(NUMINA_LAYERS),originalModel,'Public projection must not mutate the private model');
  });
 }

 test(`${name} connection checker accepts the real canonical A2A handler without sending operations`,async()=>{
  let requests=0;
  const result=await check('a2a',{origin,fetchImpl:async(url,options)=>{
   requests++;assert.equal(url,origin+'/.well-known/agent-card.json');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
   assert.equal(options.redirect,'manual');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,undefined);
   const response=await worker.fetch(new Request(url,options),env);
   assert.equal(response.status,200);
   const card=await response.clone().json();assert.equal(card.name,'Numina');assert.equal(card.protocolVersion,'0.3.0');assert.equal(card.url,origin+'/api/control/v2/a2a');
   assert.deepEqual(card.securitySchemes,{bearer:{type:'http',scheme:'bearer'}});assert.deepEqual(card.security,[{bearer:[]}]);
   return response;
  }});
  assert.equal(requests,1);assert.equal(result.state,'available');assert.equal(result.label,'Discovery available');assert.match(result.message,/No agent message or operation was sent/);
 });

 test(`${name} A2A checks still reject wrong identity or protocol and preserve access failures`,async()=>{
  const response=await worker.fetch(new Request(origin+'/.well-known/agent-card.json'),env),card=await response.json();
  for(const change of [{name:'Numina Control'},{name:'Other'},{name:null},{protocolVersion:'0.2.0'},{protocolVersion:null}]){
   const result=await check('a2a',{origin,fetchImpl:async()=>Response.json({...card,...change})});assert.equal(result.state,'error');
  }
  for(const status of [302,401,403])assert.equal((await check('a2a',{origin,fetchImpl:async()=>new Response(null,{status})})).state,'access');
  await assert.rejects(check('a2a',{origin:'https://user:password@numina.test'}),/INVALID_CONNECTION_ORIGIN/);
 });
}
