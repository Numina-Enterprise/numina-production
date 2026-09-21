import test from 'node:test';
import assert from 'node:assert/strict';
import {routeRuntime} from '../src/runtime-http.js';
const url='https://compat.numina.test/v1/evidence/revoke';
const canonicalUrl='https://numinalabs.xyz/v1/evidence/revoke';
const body=JSON.stringify({record_id:'a'.repeat(64),reason:'isolated authorization check',evidence:{}});
const make=(headers={},payload=body)=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:payload});
test('canonical Numina revocation compatibility route is retired without forwarding',async()=>{
  let calls=0;
  const response=await routeRuntime(new Request(canonicalUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture',Origin:'https://numinalabs.xyz'},body}),async()=>{calls++;return Response.json({});});
  assert.equal(response.status,410);
  assert.equal((await response.json()).error,'RUNTIME_REVOCATION_ROUTE_RETIRED');
  assert.equal(calls,0);
});
test('revocation gateway rejects unauthorized and cross-origin requests without forwarding',async()=>{
  let calls=0;const upstream=()=>{calls++;throw Error('must not forward');};
  assert.equal((await routeRuntime(make(),upstream)).status,401);
  assert.equal((await routeRuntime(make({Authorization:'Bearer fixture',Origin:'https://untrusted.invalid'}),upstream)).status,403);
  assert.equal((await routeRuntime(new Request(url),upstream)).status,405);
  assert.equal(calls,0);
});
test('revocation forwards only the bearer and bounded JSON to the pinned runtime',async()=>{
  const result=await routeRuntime(make({Authorization:'Bearer fixture',Cookie:'private=cookie',Origin:'https://numinalabs.xyz'}),async(target,options)=>{
    assert.equal(target,'https://numinalabs.xyz/v1/evidence/revoke');
    assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer fixture');assert.equal(options.headers.Cookie,undefined);
    assert.equal(new TextDecoder().decode(options.body),body);
    return Response.json({detail:'EVIDENCE_RECORD_NOT_FOUND'},{status:404});
  });
  assert.equal(result.status,404);assert.equal(result.headers.get('Cache-Control'),'private, no-store');
});
test('adapter never forwards missing, blank, wildcard or bulk record/reason input',async()=>{
  let calls=0;const upstream=async()=>{calls++;return Response.json({});};
  for(const payload of [{},{record_id:'a'.repeat(64)},{reason:'specified'},{record_id:'*',reason:'all'},{record_id:'a'.repeat(64),reason:'   '},{record_id:'a'.repeat(64),reason:'specified',all:true},[{record_id:'a'.repeat(64),reason:'specified'}]]){
    const response=await routeRuntime(make({Authorization:'Bearer fixture'},JSON.stringify(payload)),upstream);
    assert.equal(response.status,422);
  }
  assert.equal(calls,0);
});
test('revocation rejects oversized requests before forwarding and never follows redirects',async()=>{
  let calls=0;
  const tooLarge=await routeRuntime(make({Authorization:'Bearer fixture'},'x'.repeat(16385)),async()=>{calls++;return Response.json({});});
  assert.equal(tooLarge.status,413);assert.equal(calls,0);
  const redirect=await routeRuntime(make({Authorization:'Bearer fixture'}),async()=>new Response(null,{status:307,headers:{Location:'https://untrusted.invalid'}}));
  assert.equal(redirect.status,502);
});
