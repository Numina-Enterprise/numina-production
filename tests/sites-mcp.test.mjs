import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sitesMcpHttp} from '../src/sites-mcp-http.js';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {controlHash,stable} from '../src/control.js';
import {createNuminaTreasury} from '../src/native-treasury.js';

const origin='https://numina.test',owner='email:owner@example.test';
const ownerHeaders={'oai-authenticated-user-id':'synthetic-owner','oai-authenticated-user-email':'owner@example.test'};
const canary='PRIVATE_DEPENDENCY_DETAIL_MUST_NOT_ESCAPE';
const registry=JSON.parse(readFileSync(new URL('../public/security-surfaces.json',import.meta.url),'utf8'));
function request(method,params={},headers={}){
  return new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
}
async function call(name,env,headers={}){
  const response=await sitesMcpHttp(request('tools/call',{name,arguments:{}},headers),env,{requestId:'synthetic-request'});
  return {status:response.status,body:await response.json()};
}
async function fixture(t){
  const DB=database();t.after(()=>DB.close());
  await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));
  return {DB,NUMINA_CONTROL_OWNER:owner};
}
function logs(t){
  const captured=[];
  t.mock.method(console,'error',value=>captured.push(JSON.parse(value)));
  return captured;
}
function assertDependency(result,captured,{toolName,backendPath,code}){
  assert.equal(result.status,503);
  assert.equal(result.body.error.data.reason,code);
  assert.deepEqual(captured.filter(log=>log.event==='numina_request_failure'),[{event:'numina_request_failure',requestId:'synthetic-request',path:'/mcp',method:'POST',stage:'mcp_backend_response',exception:'Error',code,toolName,backendPath}]);
  assert.doesNotMatch(JSON.stringify({result,captured}),new RegExp(canary));
}

test('initialize negotiates a supported version when the client sends a newer transport header',async()=>{
  const response=await sitesMcpHttp(request('initialize',{protocolVersion:'2026-07-28'},{'MCP-Protocol-Version':'2026-07-28'}),{});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.result.protocolVersion,'2025-11-25');
  assert.equal(body.result.serverInfo.name,'numina');
});

test('calls after initialize still reject unsupported transport versions',async()=>{
  for(const method of ['ping','tools/list','tools/call']){
    const response=await sitesMcpHttp(request(method,method==='tools/call'?{name:'numina_head',arguments:{}}:{},{'MCP-Protocol-Version':'2026-07-28'}),{});
    assert.equal(response.status,400,method);
    assert.equal((await response.json()).error.data.reason,'UNSUPPORTED_PROTOCOL_VERSION');
  }
});

test('notifications after initialize still reject unsupported transport versions',async()=>{
  const req=new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json','MCP-Protocol-Version':'2026-07-28'},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  const response=await sitesMcpHttp(req,{});
  assert.equal(response.status,400);
  assert.equal((await response.json()).error.data.reason,'UNSUPPORTED_PROTOCOL_VERSION');
});

test('public MCP reads succeed without storage or owner authority',async()=>{
  const env={ASSETS:{fetch:async()=>Response.json(registry)}};
  for(const name of ['numina_connections','numina_architecture','numina_capabilities','numina_head']){
    const result=await call(name,env);
    assert.equal(result.status,200,name);
    assert.equal(result.body.result.isError,false,name);
  }
});

test('owner tools reject anonymous, partial identity, wrong owner and invalid bearer before storage',async()=>{
  const validToken='synthetic-owner-token';
  const env={NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(validToken),DB:{prepare(){assert.fail('unauthorized storage access');}}};
  for(const name of ['numina_owner_state','numina_provider_routes','numina_treasury_evidence']){
    for(const [headers,status] of [[{},401],[{'oai-authenticated-user-id':'synthetic-owner'},401],[{...ownerHeaders,'oai-authenticated-user-email':'delegate@example.test'},403],[{...ownerHeaders,'oai-authenticated-user-email':'delegate@example.test',Authorization:'Bearer '+validToken},403],[{Authorization:'Bearer invalid-owner-token'},401]]){
      assert.equal((await call(name,env,headers)).status,status,name);
    }
  }
});

test('provider configuration failures identify the bounded dependency and tool without changing the journal',async t=>{
  const env=await fixture(t),captured=logs(t),before=await readControl(env.DB);
  const result=await call('numina_provider_routes',env,ownerHeaders);
  assertDependency(result,captured,{toolName:'numina_provider_routes',backendPath:'/api/control/v2/treasury/provider-routes',code:'STRIPE_TREASURY_NOT_CONNECTED'});
  const after=await readControl(env.DB);
  assert.equal(after.revision,before.revision);assert.equal(after.head_hash,before.head_hash);
});

test('missing receipt signing identifies the bounded dependency without producing evidence',async t=>{
  const env=await fixture(t),captured=logs(t);
  const result=await call('numina_treasury_evidence',env,ownerHeaders);
  assertDependency(result,captured,{toolName:'numina_treasury_evidence',backendPath:'/api/control/v2/treasury/evidence',code:'SIGNING_UNAVAILABLE'});
  assert.equal(result.body.result,undefined);
});

test('native treasury replay failures retain their safe code and block evidence',async t=>{
  const env=await fixture(t),captured=logs(t);
  const row=await readControl(env.DB);
  await createNuminaTreasury({db:env.DB,principal:owner,root:owner}).writeTreasury({id:'synthetic-native-init',expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Isolated MCP fixture'}});
  const current=await readControl(env.DB),event=structuredClone(current.journalEvents.at(-1));
  event.result.privateDetail=canary;
  const hash=await controlHash(event);
  await env.DB.prepare('UPDATE numina_control_events SET event_json=?,hash=? WHERE id=?').bind(stable(event),hash,event.id).run();
  await env.DB.prepare('UPDATE numina_control_manifest SET head_hash=? WHERE id=1').bind(hash).run();
  const before=await readControl(env.DB);
  const result=await call('numina_treasury_evidence',env,ownerHeaders);
  assertDependency(result,captured,{toolName:'numina_treasury_evidence',backendPath:'/api/control/v2/treasury/evidence',code:'TREASURY_REPLAY_MISMATCH'});
  assert.deepEqual(captured.filter(log=>log.event==='numina_treasury_replay_failure'),[{event:'numina_treasury_replay_failure',stage:'event_result',eventRevision:1,differingFields:['unknown_fields']}]);
  assert.equal((await readControl(env.DB)).head_hash,before.head_hash);
});

test('unknown backend codes and exception messages remain private',async t=>{
  const captured=logs(t),env={NUMINA_CONTROL_OWNER:owner,DB:{prepare(){throw Object.assign(new Error(canary),{code:canary});}}};
  const result=await call('numina_owner_state',env,ownerHeaders);
  assertDependency(result,captured,{toolName:'numina_owner_state',backendPath:'/api/control/v1/state',code:'DEPENDENCY_UNAVAILABLE'});
});

test('dispatch exceptions retain only bounded diagnostic fields',async t=>{
  const captured=logs(t),env={ASSETS:{async fetch(){throw Object.assign(new Error(canary),{code:canary,name:canary});}}};
  const result=await call('numina_connections',env);
  assert.equal(result.status,503);
  assert.equal(result.body.error.data.reason,'DEPENDENCY_UNAVAILABLE');
  assert.deepEqual(captured,[{event:'numina_request_failure',requestId:'synthetic-request',path:'/mcp',method:'POST',stage:'mcp_backend_dispatch',exception:'Error',code:'DEPENDENCY_UNAVAILABLE',toolName:'numina_connections',backendPath:'/api/control/v2/discovery-mcp'}]);
  assert.doesNotMatch(JSON.stringify({result,captured}),new RegExp(canary));
});
