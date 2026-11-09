import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers.mjs';
import {createTreasuryService} from '../../local/treasury/service.mjs';
import {createMcpClient,oauthAuth,PROTOCOL_VERSION} from '../../local/treasury/mcp-client.mjs';
import {createTokenStore} from '../../local/treasury/token-store.mjs';
import {REGISTRY} from '../../local/treasury/registry.mjs';
import * as mcpClient from '../../local/treasury/mcp-client.mjs';

test('mcp-client does not export apiKeyAuth',()=>{
  assert.equal('apiKeyAuth' in mcpClient,false);
  assert.equal(typeof mcpClient.oauthAuth,'function');
});

test('MCP client: initialize, initialized notification, paginated SSE tools/list, session header',async()=>{
  const t=await setup();
  try{
    const store=createTokenStore({file:t.config.profiles.sandbox.auth.tokenFile,keyEnv:t.config.profiles.sandbox.auth.tokenKeyEnv,env:t.env,profile:'sandbox'});
    const c=createMcpClient({serverUrl:t.sbx.url,auth:oauthAuth({store,refresh:async()=>false}),fetchImpl:fetch});
    const init=await c.initialize();assert.equal(init.serverInfo.name,'mock-stripe-mcp');
    const tools=await c.listTools();
    assert.equal(tools.length,REGISTRY.tools.length);
    const methods=t.sbx.requests.map(r=>r.body?.method);
    assert.deepEqual(methods.slice(0,2),['initialize','notifications/initialized']);
    assert.ok(methods.filter(m=>m==='tools/list').length>=3,'paginated across pages');
    assert.equal(t.sbx.requests[0].body.params.protocolVersion,PROTOCOL_VERSION);
    assert.ok(t.sbx.requests.slice(1).every(r=>r.headers['mcp-session-id']?.startsWith('mock-session-')));
    assert.ok(t.sbx.requests.slice(1).every(r=>r.headers['mcp-protocol-version']===PROTOCOL_VERSION));
    await c.close();assert.equal(t.sbx.requests.at(-1).method,'DELETE');
  }finally{await t.teardown();}
});

test('discovery reports registry tools missing from the server and unregistered server tools',async()=>{
  const t=await setup({sandbox:{omitTools:['stripe_reports'],extraTools:[{name:'brand_new_tool',inputSchema:{type:'object'}}]}});
  try{
    const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
    const d=await s.discover('sandbox');
    assert.deepEqual(d.missingFromServer,['stripe_reports']);
    assert.deepEqual(d.unregistered,['brand_new_tool']);
    assert.equal(d.available.length,REGISTRY.tools.length-1);
    const r=await s.call('stripe_reports',{query:'x'},{profile:'sandbox'});
    assert.equal(r.status,'blocked');assert.equal(r.reason,'TOOL_NOT_ON_SERVER');
    assert.equal(t.sbx.calls().length,0);
  }finally{await t.teardown();}
});

test('calls are validated against the discovered inputSchema, not hardcoded shapes',async()=>{
  const strict={type:'object',properties:{account_ref:{type:'string'}},required:['account_ref'],additionalProperties:false};
  const t=await setup({sandbox:{schemaOverrides:{get_balance_summary:strict}}});
  try{
    const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
    const bad=await s.call('get_balance_summary',{},{profile:'sandbox'});
    assert.equal(bad.status,'blocked');assert.equal(bad.reason,'INVALID_INPUT');assert.match(bad.message,/account_ref: required/);
    const extra=await s.call('get_balance_summary',{account_ref:'x',other:1},{profile:'sandbox'});
    assert.equal(extra.status,'blocked');assert.match(extra.message,/not allowed by the server schema/);
    const ok=await s.call('get_balance_summary',{account_ref:'x'},{profile:'sandbox'});
    assert.equal(ok.status,'ok');
    assert.equal(t.sbx.calls().length,1);
  }finally{await t.teardown();}
});

test('balance read works in sandbox (default profile) with OAuth 2.1 bearer',async()=>{
  const t=await setup();
  try{
    const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
    const r=await s.call('get_balance_summary',{});
    assert.equal(r.status,'ok');assert.equal(r.result.structuredContent.tool,'get_balance_summary');
    assert.equal(t.sbx.calls().length,1);assert.equal(t.lv.requests.length,0,'live server untouched');
    assert.match(t.sbx.calls()[0].headers.authorization,/^Bearer mock_at_/);
  }finally{await t.teardown();}
});
