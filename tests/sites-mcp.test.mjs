import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const env={NUMINA_TELEMETRY_LOGS:'false',NUMINA_LIVEMODE:'true',DB:{prepare(sql){assert.match(sql,/numina_limits_v1/);return {bind(){return this;},async first(){return {count:1};}};},async batch(){return [{results:[]},{results:[{count:1}]}];}}};
const rpc=(method,params={},headers={})=>new Request('https://numina.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
test('hosted MCP initializes statelessly and exposes only public discovery tools',async()=>{
 const init=await(await worker.fetch(rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}),env)).json();
 assert.equal(init.result.serverInfo.name,'numina-discovery');
 const tools=await(await worker.fetch(rpc('tools/list'),env)).json();
 assert.deepEqual(tools.result.tools.map(t=>t.name),['numina_connections','numina_architecture','numina_capabilities','numina_head']);
 for(const tool of tools.result.tools){assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);}
 const value=await(await worker.fetch(rpc('tools/call',{name:'numina_capabilities',arguments:{}}),env)).json();assert.equal(value.result.isError,false);assert.equal(JSON.parse(value.result.content[0].text).externalExecution,false);
});
test('hosted MCP rejects private tool names, argument smuggling and cross-origin requests',async()=>{
 for(const params of [{name:'numina_read_treasury',arguments:{}},{name:'numina_capabilities',arguments:{authorized:true}}]){
  const value=await(await worker.fetch(rpc('tools/call',params),env)).json();assert.equal(value.error.code,-32602);
 }
 assert.equal((await worker.fetch(rpc('tools/list',{}, {Origin:'https://attacker.invalid'}),env)).status,403);
 for(const method of ['GET','HEAD','DELETE'])assert.equal((await worker.fetch(new Request('https://numina.test/mcp',{method}),env)).status,405);
});
