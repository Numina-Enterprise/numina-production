import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {routeRc20} from '../src/rc20.js';
const env={NUMINA_RC20_ORIGIN:'https://rc20-test.vercel.app'};
const request=(path,options)=>new Request('https://www.numinalabs.xyz'+path,options);

test('rc20 routing preserves existing APIs and unrelated pages, and stays inactive without an origin',async()=>{
  for(const path of ['/api/control/v1/state','/labs.html','/core.html','/downloads/Control-Plane-v1.md'])assert.equal(await routeRc20(request(path),env),null);
  assert.equal(await routeRc20(request('/'),{}),null);
});
test('rc20 public requests never forward user identity or upstream cookies',async()=>{
  const r=await routeRc20(request('/v1/status',{headers:{Authorization:'Bearer private',Cookie:'session=private','x-openai-user-email':'private@example.test'}}),env,async(url,options)=>{
    assert.equal(url,'https://rc20-test.vercel.app/v1/status');
    assert.equal(options.headers.get('Authorization'),null);assert.equal(options.headers.get('Cookie'),null);assert.equal(options.headers.get('x-openai-user-email'),null);
    return new Response('{"production_version":"1.9.0-rc20"}',{headers:{'Content-Type':'application/json','Set-Cookie':'bad=1'}});
  });
  assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);assert.equal((await r.json()).production_version,'1.9.0-rc20');
});
test('rc20 rejects unapproved origins and upstream redirects',async()=>{
  for(const origin of ['http://rc20-test.vercel.app','https://example.test','https://rc20-test.vercel.app/a','https://user:pass@rc20-test.vercel.app'])assert.equal((await routeRc20(request('/'),{NUMINA_RC20_ORIGIN:origin})).status,503);
  assert.equal((await routeRc20(request('/'),env,async()=>new Response(null,{status:302,headers:{Location:'https://example.test'}}))).status,502);
});
test('rc20 gateway keeps method and body limits',async()=>{
  assert.equal((await routeRc20(request('/v1/status',{method:'POST'}),env)).status,405);
  assert.equal((await routeRc20(request('/v1/control/evaluate'),env)).status,405);
  assert.equal((await routeRc20(request('/v1/control/evaluate',{method:'POST',body:'x',headers:{'Content-Type':'text/plain'}}),env)).status,415);
  assert.equal((await routeRc20(request('/v1/control/evaluate',{method:'POST',body:'x'.repeat(65537),headers:{'Content-Type':'application/json'}}),env)).status,413);
  const body='{"action":"inspect"}';
  const r=await routeRc20(request('/v1/control/evaluate',{method:'POST',body,headers:{'Content-Type':'application/json'}}),env,async(_,options)=>{assert.equal(new TextDecoder().decode(options.body),body);return new Response('{"external_execution_performed":false}');});
  assert.equal((await r.json()).external_execution_performed,false);
});
test('old control plane remains reachable and sign-in returns to it',async()=>{
  const assets={fetch:async(req)=>{assert.equal(new URL(req.url).pathname,'/control');return new Response('<a href="/control" aria-current="page">Control plane</a><a href="/signin-with-chatgpt?return_to=%2Fcontrol">Sign in</a>',{headers:{'Content-Type':'text/html'}});}};
  const html=await (await routeRc20(request('/control'),{ASSETS:assets})).text();
  assert.match(html,/href="\/control"/);assert.match(html,/return_to=%2Fcontrol/);
});

test('packaged static homepage is rc20 when assets run before the Worker, and preserves the control page',()=>{
  const home=readFileSync(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const control=readFileSync(new URL('../dist/client/control.html',import.meta.url),'utf8');
  assert.match(home,/id="production-version">v1\.9\.0-rc20/);
  assert.match(home,/id="core-conformance">VERIFYING/);
  assert.match(home,/href="\/control"/);
  assert.match(control,/<title>Numina — Control plane<\/title>/);
  assert.match(control,/href="\/control" aria-current="page"/);
  assert.match(control,/src="\/control.js"/);
  for(const asset of ['site.css','site.js'])assert.ok(readFileSync(new URL('../dist/client/'+asset,import.meta.url)).length>0);
});
test('rc20 homepage keeps navigation to the old control plane and Labs; HEAD has no body',async()=>{
  const upstream=async()=>new Response('<nav></nav>',{headers:{'Content-Type':'text/html'}});
  const html=await (await routeRc20(request('/'),env,upstream)).text();
  assert.match(html,/href="\/control"/);assert.match(html,/href="\/labs.html"/);
  assert.equal(await (await routeRc20(request('/',{method:'HEAD'}),env,upstream)).text(),'');
});
