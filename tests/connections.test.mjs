import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONNECTION_TARGETS,validateConnectionManifest,checkConnection,connectionReport} from '../public/connection-model.js';
import worker from '../src/worker.js';
import {database} from '../scripts/sqlite.mjs';
const registry=JSON.parse(readFileSync(new URL('../public/security-surfaces.json',import.meta.url)));
const origin='https://numina.test';
const json=value=>Response.json(value);
test('provider route discovery is fixed, read-only and does not report private response fields',async()=>{
 const value={schema:'numina.treasury.provider-routes.v1',connection:'read_only',privateAccountReference:'private-fixture',balance:'123456'};
 const result=await checkConnection('provider-routes',{origin,fetchImpl:async(url,options)=>{
  assert.equal(url,origin+'/api/control/v2/treasury/provider-routes');assert.equal(options.method,'GET');return json(value);
 }});
 assert.equal(result.state,'available');assert.doesNotMatch(JSON.stringify(result),/private-fixture|123456/);
 assert.equal((await checkConnection('provider-routes',{origin,fetchImpl:async()=>json({...value,connection:'unverified'})})).state,'error');
});
test('a changed manifest cannot redirect checks, omit surfaces or duplicate identities',()=>{
  assert.equal(validateConnectionManifest(registry),registry);
  for(const change of [r=>r.rootCount=2,r=>r.surfaces.pop(),r=>r.surfaces[0].entry='https://other.test/',r=>r.surfaces[0].id='__proto__',r=>r.surfaces[0]=r.surfaces[1]]){
    const changed=structuredClone(registry);change(changed);assert.throws(()=>validateConnectionManifest(changed),/INVALID/);
  }
});
test('checks only send allowlisted reads or fixed MCP initialization without credentials in the body',async()=>{
  for(const id of Object.keys(CONNECTION_TARGETS)){
    const target=CONNECTION_TARGETS[id];
    await checkConnection(id,{origin,fetchImpl:async(url,options)=>{
      assert.equal(url,origin+target.path);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,undefined);
      if(target.kind==='mcp'){assert.equal(options.method,'POST');const body=JSON.parse(options.body);assert.equal(body.method,'initialize');assert.deepEqual(Object.keys(body.params).sort(),['capabilities','clientInfo','protocolVersion']);}
      else{assert.equal(options.method,'GET');assert.equal(options.body,undefined);}
      return new Response('',{status:401});
    }});
  }
  await assert.rejects(checkConnection('https://other.test',{origin}),/UNKNOWN/);
  await assert.rejects(checkConnection('website',{origin:'https://user:password@numina.test'}),/ORIGIN/);
});
test('MCP connection requires matching initialization and never calls a tool',async()=>{
  const valid={jsonrpc:'2.0',id:'numina-connection-check',result:{protocolVersion:'2025-11-25',serverInfo:{name:'numina-discovery'}}};
  assert.equal((await checkConnection('mcp-discovery',{origin,fetchImpl:async()=>json(valid)})).state,'available');
  for(const bad of [{...valid,id:'other'}, {...valid,result:{...valid.result,serverInfo:{name:'unknown'}}}, {jsonrpc:'2.0',error:{message:'private account data'}}])assert.equal((await checkConnection('mcp-discovery',{origin,fetchImpl:async()=>json(bad)})).state,'error');
});
test('redirects and authorization failures stay access requirements; HTTP success alone is insufficient',async()=>{
  for(const status of [302,401,403])assert.equal((await checkConnection('treasury',{origin,fetchImpl:async()=>new Response(null,{status})})).state,'access');
  assert.equal((await checkConnection('treasury',{origin,fetchImpl:async()=>json({message:'ok'})})).state,'error');
  assert.equal((await checkConnection('website',{origin,fetchImpl:async()=>json({message:'ok'})})).state,'error');
});
test('headers and stalled response bodies share a deadline; oversized or malformed JSON fails',async()=>{
  const stalledHeaders=await checkConnection('treasury',{origin,timeoutMs:20,fetchImpl:()=>new Promise(()=>{})});assert.equal(stalledHeaders.label,'Timed out');
  const stalledBody=await checkConnection('treasury',{origin,timeoutMs:20,fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}),{headers:{'Content-Type':'application/json'}})});assert.equal(stalledBody.label,'Timed out');
  for(const body of ['{',' '.repeat(1048577)])assert.equal((await checkConnection('treasury',{origin,fetchImpl:async()=>new Response(body,{headers:{'Content-Type':'application/json'}})})).state,'error');
  const controller=new AbortController();controller.abort();const cancelled=await checkConnection('treasury',{origin,signal:controller.signal,fetchImpl:()=>{throw Error('Must not contact a cancelled target');}});assert.equal(cancelled.state,'cancelled');
});
test('a responding financial status never implies activation and native records never imply installation',async()=>{
  for(const capabilities of [{mint:false,status:true},{mint:true}])assert.equal((await checkConnection('financial-status',{origin,fetchImpl:async()=>json({schema:'numina.nusd.status.v1',capabilities})})).state,'attention');
  const native=await checkConnection('android',{origin,fetchImpl:async()=>json({schema:'numina.native-package.v1',proposedPackageIdentity:'xyz.numinalabs.app'})});assert.equal(native.label,'Package record available');assert.match(native.message,/installation/);
});
test('observation reports omit private payloads and credential fields',async()=>{
  const result=await checkConnection('treasury',{origin,fetchImpl:async()=>json({schema:'numina.treasury.v1',status:'READY',projection:{balance:'PRIVATE_BALANCE'},email:'PRIVATE_EMAIL',token:'PRIVATE_TOKEN'})});
  const report=connectionReport([{...result,responseBody:'PRIVATE_BODY',account:'PRIVATE_ACCOUNT',token:'PRIVATE_TOKEN'}],origin);
  assert.equal(result.state,'available');assert.doesNotMatch(JSON.stringify(report),/PRIVATE_/);assert.equal(report.financialOperationsPerformed,false);
});
test('manifest endpoint reads only the packaged registry and rejects writes and parameters',async()=>{
  const env={NUMINA_TELEMETRY_LOGS:'false',get DB(){throw Error('Must not read private state');},ASSETS:{fetch(req){assert.equal(new URL(req.url).pathname,'/security-surfaces.json');assert.equal(req.headers.has('cookie'),false);return json(registry);}}};
  const response=await worker.fetch(new Request(origin+'/api/connections/v1/manifest',{headers:{Cookie:'private'}}),env);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(await response.json(),registry);
  assert.equal((await worker.fetch(new Request(origin+'/api/connections/v1/manifest?url=https://other.test'),env)).status,400);
  assert.equal((await worker.fetch(new Request(origin+'/api/connections/v1/manifest',{method:'POST'}),env)).status,405);
  assert.equal((await worker.fetch(new Request(origin+'/api/connections/v1/manifest'),Object.assign(Object.create(env),{ASSETS:{fetch:()=>json({})}}))).status,503);
});
test('MCP discovery exposes the same canonical registry through a read-only tool',async()=>{
  const db=database();
  try{
    const env={DB:db,NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch:()=>json(registry)}};
    const call=async(method,params)=>worker.fetch(new Request(origin+'/api/control/v2/discovery-mcp',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);
    const listed=await (await call('tools/list',{})).json(),tool=listed.result.tools.find(item=>item.name==='numina_connections');assert.equal(tool.annotations.readOnlyHint,true);
    const invoked=await (await call('tools/call',{name:'numina_connections',arguments:{}})).json();assert.deepEqual(JSON.parse(invoked.result.content[0].text),registry);
  }finally{db.close();}
});
