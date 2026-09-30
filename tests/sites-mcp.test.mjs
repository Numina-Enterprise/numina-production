import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const env={NUMINA_TELEMETRY_LOGS:'false',NUMINA_LIVEMODE:'true',DB:{prepare(sql){assert.match(sql,/numina_limits_v1/);return {bind(){return this;},async first(){return {count:1};}};},async batch(){return [{results:[]},{results:[{count:1}]}];}}};
const rpc=(method,params={},headers={})=>new Request('https://numina.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
test('hosted MCP initializes statelessly and exposes only public discovery tools',async()=>{
 const init=await(await worker.fetch(rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}),env)).json();
 assert.equal(init.result.serverInfo.name,'numina-discovery');
 const tools=await(await worker.fetch(rpc('tools/list'),env)).json();
 assert.deepEqual(tools.result.tools.map(t=>t.name),['numina_connections','numina_architecture','numina_capabilities','numina_head','numina_open_panel']);
 for(const tool of tools.result.tools){assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);}
 const value=await(await worker.fetch(rpc('tools/call',{name:'numina_capabilities',arguments:{}}),env)).json();assert.equal(value.result.isError,false);assert.equal(JSON.parse(value.result.content[0].text).externalExecution,false);
});
test('public panel registration serves only its immutable UI and declares sidebar and conversation entrypoints',async()=>{
 const tools=await(await worker.fetch(rpc('tools/list'),env)).json();
 const panel=tools.result.tools.find(t=>t.name==='numina_open_panel');
 assert.deepEqual(panel._meta['openai/ui'].entrypoints,[{type:'global'},{type:'thread'}]);
 const init=await(await worker.fetch(rpc('initialize'),env)).json();assert.equal(init.result.capabilities.resources.subscribe,false);
 const listed=await(await worker.fetch(rpc('resources/list'),env)).json();assert.equal(listed.result.resources.length,1);
 const uri=listed.result.resources[0].uri;assert.equal(panel._meta.ui.resourceUri,uri);
 const read=await(await worker.fetch(rpc('resources/read',{uri}),env)).json();
 assert.equal(read.result.contents[0].mimeType,'text/html;profile=mcp-app');
 assert.match(read.result.contents[0].text,/Numina workspace/);assert.doesNotMatch(read.result.contents[0].text,/<script|fetch\(|localStorage|treasury\/accounts/);
 assert.deepEqual(read.result.contents[0]._meta.ui.csp,{connectDomains:[],resourceDomains:[]});
 const opened=await(await worker.fetch(rpc('tools/call',{name:panel.name,arguments:{}}),env)).json();assert.equal(opened.result.structuredContent.externalExecution,false);
 for(const params of [{uri:'file:///private'},{uri,authorized:true}])assert.equal((await(await worker.fetch(rpc('resources/read',params),env)).json()).error.code,-32602);
 for(const args of [{token:'secret'},[],null])assert.equal((await(await worker.fetch(rpc('tools/call',{name:panel.name,arguments:args}),env)).json()).error.code,-32602);
 assert.equal((await worker.fetch(rpc('resources/read',{uri},{Origin:'https://attacker.invalid'}),env)).status,403);
 const unsupported=rpc('resources/read',{uri},{'MCP-Protocol-Version':'invalid'});assert.equal((await(await worker.fetch(unsupported,env)).json()).error.code,-32602);
 const unsupportedPanel=rpc('tools/call',{name:panel.name,arguments:{}},{'MCP-Protocol-Version':'invalid'});assert.equal((await(await worker.fetch(unsupportedPanel,env)).json()).error.code,-32602);
});
test('hosted MCP rejects private tool names, argument smuggling and cross-origin requests',async()=>{
 for(const params of [{name:'numina_read_treasury',arguments:{}},{name:'numina_capabilities',arguments:{authorized:true}}]){
  const value=await(await worker.fetch(rpc('tools/call',params),env)).json();assert.equal(value.error.code,-32602);
 }
 assert.equal((await worker.fetch(rpc('tools/list',{}, {Origin:'https://attacker.invalid'}),env)).status,403);
 for(const method of ['GET','HEAD','DELETE'])assert.equal((await worker.fetch(new Request('https://numina.test/mcp',{method}),env)).status,405);
});
