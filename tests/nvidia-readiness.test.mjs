import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyNvidiaNim} from '../integrations/numina/examples/verify-nvidia-nim.mjs';
import {EXPECTED_RELEASE} from '../integrations/numina/src/runtime-contract.js';

function harness(mode='ok'){
 const calls=[],numinaCalls=[];let models=0;
 const options={endpoint:'https://nim.example.test/v1',model:'test-model',apiKey:'fixture-secret',
  numinaFetch:async(url,init)=>{numinaCalls.push({url,init});return Response.json({schema:'numina.application-release.v2',schema_version:2,product:'Numina',version:'3.0.0',release:'numina-v3.0.0',artifact_digest_algorithm:'sha256',build_id:'0'.repeat(64),artifacts:[{path:'fixture',sha256:'1'.repeat(64)}],runtime_dependency:{version:EXPECTED_RELEASE.production_version,release:EXPECTED_RELEASE.release}});},
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   if(mode==='offline')throw Error('fixture-secret provider failure');
   if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://elsewhere.example/'}});
   if(url.endsWith('/health/ready')&&mode==='loading')return new Response(null,{status:503});
   if(url.includes('/health/'))return new Response('OK');
   if(url.endsWith('/models'))return Response.json({data:[{id:mode==='wrong-model'?'different':'test-model'}]});
   models++;
   const model=(mode==='misrouted-first'&&models===1)||(mode==='misrouted-second'&&models===2)?'different':'test-model';
   if(models===1)return Response.json({model,choices:[{message:mode==='no-tool'?{role:'assistant',content:'I am ready'}:{role:'assistant',tool_calls:[{id:'call1',type:'function',function:{name:'numina_application_release',arguments:'{}'}}]}}]});
   return Response.json({model,choices:[{message:mode==='unfinished'?{role:'assistant',content:null,tool_calls:[{id:'more'}]}:{role:'assistant',content:'Numina 3.0.0'}}]});
  }};
 return {options,calls,numinaCalls};
}
test('readiness requires live, ready, exact model and a completed discovery round trip',async()=>{
 const h=harness();const result=await verifyNvidiaNim(h.options);
 assert.equal(result.providerConnectivityVerified,true);assert.equal(result.modelToolRoundTripVerified,true);
 assert.equal(result.publicMultiUserEntitlementVerified,false);assert.equal(result.publicServiceReady,false);
 assert.equal(result.checks.length,4);assert.ok(result.checks.every(c=>c.status==='passed'));
 assert.equal(h.calls.length,5);assert.equal(h.numinaCalls.length,2);
 assert.ok(h.calls.every(c=>c.init.redirect==='error'&&c.init.headers.Authorization==='Bearer fixture-secret'));
 assert.ok(h.numinaCalls.every(c=>!c.init.headers.Authorization&&c.init.method==='GET'));
 assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});
test('unready, redirected or wrong-model endpoints never dispatch inference',async()=>{
 for(const mode of ['offline','loading','wrong-model','redirect']){
  const h=harness(mode),result=await verifyNvidiaNim(h.options);
  assert.equal(result.providerConnectivityVerified,false);assert.equal(result.modelToolRoundTripVerified,false);
  assert.equal(h.calls.length,3);assert.equal(h.numinaCalls.length,0);assert.ok(!JSON.stringify(result).includes('fixture-secret'));
 }
});
test('model prose and unfinished tool calls cannot count as a verified round trip',async()=>{
 for(const mode of ['no-tool','unfinished']){const h=harness(mode),result=await verifyNvidiaNim(h.options);assert.equal(result.providerConnectivityVerified,true);assert.equal(result.modelToolRoundTripVerified,false);assert.equal(result.publicServiceReady,false);}
});
test('readiness rejects insecure remote endpoints before transmitting credentials',async()=>{
 const h=harness();await assert.rejects(verifyNvidiaNim({...h.options,endpoint:'http://remote.example/v1'}),/NVIDIA_NIM_ENDPOINT_INVALID/);assert.equal(h.calls.length,0);
});
test('a gateway listing the intended model cannot substitute another model on either request',async()=>{
 for(const mode of ['misrouted-first','misrouted-second']){const h=harness(mode),result=await verifyNvidiaNim(h.options);assert.equal(result.providerConnectivityVerified,true);assert.equal(result.modelToolRoundTripVerified,false);assert.equal(result.checks.at(-1).error,'NIM_RESPONSE_MODEL_MISMATCH');}
});
