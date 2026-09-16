import test from 'node:test';
import assert from 'node:assert/strict';
import {NuminaClient,validateArguments} from '../src/client.js';
import {toolsForProfile} from '../src/tools.js';
import {providerTools,executeProviderCall} from '../src/provider-adapters.js';
import {createMcpHandler} from '../src/mcp.js';
import {EXPECTED_RELEASE} from '../src/runtime-contract.js';

// Isolated fixtures only. No live Numina, Stripe or blockchain request is made.
const token='isolated-owner-provider-routes-token';
const origin='https://numina.example.test';
const route=()=>({id:'faddr_test_fixture',currency:'usdc',settlement_currency:'usdc',status:'active',network:'base',address:'0x1111111111111111111111111111111111111111',memo:null,provider_reported_active:true});
const observation=()=>({schema:'numina.treasury.provider-routes.v1',provider:'Stripe',connection:'read_only',financial_account:'fa_isolatedfixture',account_status:'open',observed_at:'2026-09-15T23:00:00.000Z',complete:true,routes:[route()],nusd:{status:'NOT_REPORTED',provider_acceptance_verified:false},submission_performed:false,receipt:null,transfer_execution:false,scope:'Authenticated provider route observation; no NUSD asset acceptance or funding verification'});
const client=(fetch,options={})=>new NuminaClient({baseUrl:origin,token,fetch,...options});
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('provider routes require owner authentication and reject caller overrides before requests',async()=>{
 let calls=0;const fetch=async()=>{calls++;return Response.json(observation());};
 await rejects(client(fetch,{token:undefined}).readProviderRoutes({}),'SERVER_AUTH_REQUIRED');
 for(const input of [{provider:'Stripe'},{account:'fa_other'},{verified:true},{url:'https://other.example'},[],null]){
  await rejects(client(fetch).callTool('numina_provider_routes',input),'INVALID_ARGUMENTS');
 }
 assert.equal(calls,0);assert.deepEqual(validateArguments('numina_provider_routes',{}),{});
});

test('provider routes use one fixed authenticated GET and preserve server evidence scope',async()=>{
 const source=observation(),calls=[];
 const result=await client(async(url,options)=>{calls.push({url,options});return Response.json(source);}).readProviderRoutes();
 assert.equal(calls.length,1);const [{url,options}]=calls;
 assert.equal(url,origin+'/api/control/v2/treasury/provider-routes');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
 assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');
 assert.deepEqual(result.data,source);assert.equal(result.verification,'server_reported_not_independently_verified');assert.equal(result.asset_execution_available,false);
 assert.ok(result.client_capabilities.includes('readProviderRoutes'));assert.equal(result.data.nusd.provider_acceptance_verified,false);
});

test('incomplete observations and provider NUSD labels stay unverified',async()=>{
 const cases=[{complete:false,nusd:{status:'OBSERVATION_INCOMPLETE',provider_acceptance_verified:false}},
  {routes:[{...route(),currency:'nusd',settlement_currency:'nusd',network:null,address:null,memo:null}],nusd:{status:'ASSET_IDENTITY_NOT_VERIFIED',provider_acceptance_verified:false}}];
 for(const changes of cases){const source={...observation(),...changes};const result=await client(async()=>Response.json(source)).readProviderRoutes({});assert.deepEqual(result.data,source);assert.equal(result.asset_execution_available,false);}
});

test('malformed or execution-promoting route responses fail closed',async()=>{
 const mutations=[x=>x.schema='other',x=>x.provider='owner_statement',x=>x.connection='write',x=>x.financial_account='https://other.example',
  x=>x.account_status='ready',x=>x.observed_at='not-a-time',x=>x.complete='true',x=>x.routes=null,x=>x.routes.push({...x.routes[0]}),
  x=>x.routes[0].currency='USDC',x=>x.routes[0].settlement_currency=null,x=>x.routes[0].network=42,x=>delete x.routes[0].memo,
  x=>x.routes[0].address='line\nwith control',x=>x.routes=Array.from({length:51},(_,i)=>({...route(),id:'faddr_'+i})),x=>x.routes[0].provider_reported_active='true',x=>x.nusd.status='VERIFIED',
  x=>x.nusd.provider_acceptance_verified=true,x=>x.submission_performed=true,x=>x.transfer_execution=true,x=>x.receipt={id:'owner-claim'}];
 for(const mutate of mutations){const source=observation();mutate(source);await rejects(client(async()=>Response.json(source)).readProviderRoutes({}),'INVALID_SERVER_RESPONSE');}
});

test('provider failures, redirects and token-shaped response contents retain existing protections',async()=>{
 for(const status of [401,403])await rejects(client(async()=>Response.json({error:'owner required'},{status})).readProviderRoutes({}),'SERVER_AUTH_REJECTED');
 await rejects(client(async()=>new Response(null,{status:302,headers:{Location:'https://other.example'}})).readProviderRoutes({}),'REDIRECT_REFUSED');
 const source={...observation(),extra:{authorization:token,notes:'do not expose '+token}};
 const result=await client(async()=>Response.json(source)).readProviderRoutes({});assert.equal(JSON.stringify(result).includes(token),false);assert.equal(Object.hasOwn(result.data.extra,'authorization'),false);
});

test('all provider descriptor formats expose the same read-only discovery tool',async()=>{
 const descriptor=toolsForProfile().find(tool=>tool.name==='numina_provider_routes');assert.ok(descriptor);assert.equal(descriptor.annotations.readOnlyHint,true);assert.deepEqual(descriptor.inputSchema,{type:'object',properties:{},required:[],additionalProperties:false});
 for(const format of ['openai-responses','openai-chat-completions','anthropic-messages','gemini-interactions','gemini-generate-content'])assert.ok(JSON.stringify(providerTools(format)).includes('numina_provider_routes'));
 const result=await executeProviderCall('openai-responses',{type:'function_call',call_id:'isolated-call',name:'numina_provider_routes',arguments:'{}'},client(async()=>Response.json(observation())));
 assert.equal(JSON.parse(result.output).data.submission_performed,false);
});

test('local MCP dispatch preserves route observation scope',async()=>{
 const handle=createMcpHandler(client(async()=>Response.json(observation())));
 const init=await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'isolated-fixture',version:'1'}}});assert.equal(init.result.protocolVersion,'2025-11-25');
 await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const tools=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});assert.ok(tools.result.tools.some(tool=>tool.name==='numina_provider_routes'));
 const result=await handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'numina_provider_routes',arguments:{}}});
 assert.equal(result.result.isError,false);assert.equal(result.result.structuredContent.verification,'server_reported_not_independently_verified');assert.equal(result.result.structuredContent.data.nusd.provider_acceptance_verified,false);
});

test('network and runtime-build discovery preserve optional public provider-routing metadata',async()=>{
 const routing={schema:'numina.nusd.provider-routing.v1',route:'/api/control/v2/treasury/provider-routes',providerAcceptanceVerified:false};
 const release={schema:'numina.application-release.v2',schema_version:2,product:'Numina',version:'4.0.0',release:'numina-v4.0.0',artifact_digest_algorithm:'sha256',build_id:'a'.repeat(64),artifacts:[{path:'fixture',sha256:'b'.repeat(64)}],runtime_dependency:{version:EXPECTED_RELEASE.production_version,release:EXPECTED_RELEASE.release},execution_runtime_build:{product:'Numina',status:'fixture',run_id:1,run_url:'https://example.test/run',source_commit:'a'.repeat(40),builder_commit:'b'.repeat(40),inventory_sha256:'a'.repeat(64),image_archive_sha256:'b'.repeat(64),source_archive_sha256:'c'.repeat(64),inventory:'/fixture-inventory',provenance:'/fixture-provenance',builder_signed_artifacts_verified:false,application_started_by_build:false,production_host_deployment_verified:false,financial_execution_established:false},financial_status_sources:{},scope:{}};
 for(const value of [routing,undefined,null,[],true]){
  const calls=[];const extra=value===undefined?{}:{provider_routing:value};
  const subject=client(async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/status')?{schema:'numina.nusd.status.v1',...extra}:{...release,...extra});});
  if(value===routing||value===undefined){
   for(const result of [await subject.network({}),await subject.runtimeBuild({})]){assert.equal(Object.hasOwn(result.data,'provider_routing'),value!==undefined);if(value!==undefined)assert.deepEqual(result.data.provider_routing,routing);assert.equal(result.asset_execution_available,false);}
  }else{await rejects(subject.network({}),'INVALID_SERVER_RESPONSE');await rejects(subject.runtimeBuild({}),'INVALID_SERVER_RESPONSE');}
  assert.equal(calls.length,2);for(const {url,options}of calls){assert.ok(url.endsWith('/status')||url.endsWith('/v4/release/manifest'));assert.equal(options.headers.Authorization,undefined);}
 }
});
