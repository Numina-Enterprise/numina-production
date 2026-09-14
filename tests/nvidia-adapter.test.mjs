import test from 'node:test';
import assert from 'node:assert/strict';
import {nvidiaNimRoundTrip,nimEndpoint} from '../integrations/numina/examples/nvidia-nim.mjs';
import {EXPECTED_RELEASE} from '../integrations/numina/src/runtime-contract.js';
const manifest=()=>({schema:'numina.application-release.v2',schema_version:2,product:'Numina',version:'4.0.0',release:'numina-v4.0.0',artifact_digest_algorithm:'sha256',build_id:'0'.repeat(64),artifacts:[{path:'test-fixture',sha256:'1'.repeat(64)}],runtime_dependency:{version:EXPECTED_RELEASE.production_version,release:EXPECTED_RELEASE.release}});
const call=(id='call1',name='numina_application_release')=>({id,type:'function',function:{name,arguments:'{}'}});
function harness(calls=[call()],release=manifest()){
 const requests=[],reads=[],configs=[];
 const options={endpoint:'https://nim.example.test/v1',model:'test-model',messages:[{role:'user',content:'Read Numina release'}],
  numinaFetch:async(url,options)=>{reads.push({url,options});return Response.json(release);},
  createProvider:config=>{
   configs.push(config);
   const create=async request=>{
    requests.push(request);
    return requests.length===1?{choices:[{message:{role:'assistant',content:null,tool_calls:calls}}]}:{choices:[{message:{role:'assistant',content:'Finished'}}]};
   };
   return {chat:{completions:{create}}};
  }};
 return {options,requests,reads,configs};
}
test('NIM discovery binds rc26, retains tool call IDs and limits the model round trip',async()=>{
 const h=harness();await nvidiaNimRoundTrip(h.options);
 assert.equal(h.requests.length,2);assert.equal(h.reads.length,2);
 assert.equal(h.requests[1].messages[2].tool_call_id,'call1');
 assert.ok(h.requests.every(r=>r.max_tokens===512&&r.stream===false&&r.model==='test-model'));
 assert.ok(h.requests[0].tools.every(t=>!['numina_nusd_request','numina_nusd_quote'].includes(t.function.name)));
 assert.ok(h.reads.every(r=>r.url==='https://numinalabs.xyz/v4/release/manifest'&&!r.options.headers.Authorization&&r.options.method==='GET'));
 assert.deepEqual(h.configs,[{baseURL:'https://nim.example.test/v1',maxRetries:0,timeout:15000}]);
});
test('NIM cannot reach the model when the application reports a different runtime',async()=>{
 const data=manifest();data.runtime_dependency.version='1.9.0-rc22';const h=harness([],data);
 await assert.rejects(nvidiaNimRoundTrip(h.options),/RUNTIME_RELEASE_MISMATCH/);assert.equal(h.configs.length,0);
});
test('NIM rejects workflow tools, duplicate calls and oversized batches before dispatch',async()=>{
 for(const calls of [[call('a','numina_nusd_request')],[call('a'),call('a')],Array.from({length:9},(_,i)=>call('c'+i))]){
  const h=harness(calls);await assert.rejects(nvidiaNimRoundTrip(h.options));assert.equal(h.requests.length,1);assert.equal(h.reads.length,1);
 }
});
test('NIM validates endpoints, message limits and model settings before any connection',async()=>{
 assert.equal(nimEndpoint('http://127.0.0.1:8000/v1'),'http://127.0.0.1:8000/v1');
 for(const endpoint of ['http://public.example/v1','https://user:secret@nim.example/v1','https://nim.example/v1?key=secret','https://nim.example/completions'])assert.throws(()=>nimEndpoint(endpoint));
 for(const change of [{model:''},{maxTokens:0},{messages:[]},{messages:[{content:'x'.repeat(65537)}]}]){
  const h=harness();await assert.rejects(nvidiaNimRoundTrip({...h.options,...change}));assert.equal(h.reads.length,0);assert.equal(h.configs.length,0);
 }
});
