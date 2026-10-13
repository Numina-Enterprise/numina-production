import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {routeRc20} from '../src/rc20.js';
import worker from '../src/worker.js';

const request=(path,options)=>new Request('https://www.numinalabs.xyz'+path,options);

test('historical rc20 runtime route is retired without external network access',async()=>{
  const originalFetch=globalThis.fetch;
  let called=false;
  globalThis.fetch=async()=>{called=true;throw new Error('network must not be used');};
  try{
    const r=await worker.fetch(request('/v1/archive/rc20/status'),{});
    assert.equal(r.status,410);
    assert.equal(r.headers.get('X-Numina-Release-Context'),'historical-rc20');
    assert.equal((await r.json()).error,'RC20_RUNTIME_RETIRED');
    assert.equal(called,false);
  }finally{globalThis.fetch=originalFetch;}
});

test('public HTTP requests still upgrade securely',async()=>{
  for(const host of ['numinalabs.xyz','www.numinalabs.xyz']){
    const redirect=await worker.fetch(new Request('http://'+host+'/v1/status?check=1'),{});
    assert.equal(redirect.status,301);
    assert.equal(redirect.headers.get('Location'),'https://'+host+'/v1/status?check=1');
    const post=await worker.fetch(new Request('http://'+host+'/v1/control/evaluate',{method:'POST'}),{});
    assert.equal(post.status,308);
    assert.equal(post.headers.get('Location'),'https://'+host+'/v1/control/evaluate');
  }
});

test('rc20 compatibility handler is local-only',async()=>{
  for(const path of ['/','/index.html','/status','/build','/v1/status','/v1/control/evaluate','/api/control/v1/state']){
    assert.equal(await routeRc20(request(path),{}),null);
  }
});

test('old control plane remains reachable as a local compatibility view',async()=>{
  const assets={fetch:async(req)=>{
    assert.equal(new URL(req.url).pathname,'/control');
    return new Response('<a href="/control" aria-current="page">Control plane</a><a href="/signin-with-chatgpt?return_to=%2Fcontrol">Sign in</a>',{headers:{'Content-Type':'text/html'}});
  }};
  const html=await (await routeRc20(request('/control'),{ASSETS:assets})).text();
  assert.match(html,/href="\/control"/);
  assert.match(html,/return_to=%2Fcontrol/);
});

test('packaged institutional homepage and Frontier runtime preserve their distinct roles',()=>{
  const home=readFileSync(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const frontier=readFileSync(new URL('../dist/client/frontier.html',import.meta.url),'utf8');
  const control=readFileSync(new URL('../dist/client/control.html',import.meta.url),'utf8');
  assert.match(home,/href="\/enterprise[.]css"/);
  assert.match(home,/class="service-pane"/);
  assert.match(frontier,/frontier-ui[.]js/);
  assert.match(frontier,/href="\/build"/);
  const build=readFileSync(new URL('../dist/client/build.html',import.meta.url),'utf8');
  assert.match(build,/runtime-release-ui[.]js/);
  assert.match(build,/data-conformance>Checking…/);
  assert.match(frontier,/href="\/control"/);
  const applicationMajor=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version.split('.')[0];
  assert.ok(control.includes('<title>Numina '+applicationMajor+' — Control plane</title>'));
  assert.match(control,/href="\/control" aria-current="page"/);
  assert.match(control,/src="\/control.js"/);
  for(const asset of ['theme.css','site-shell.css','runtime-release-ui.js','runtime-release-model.js','runtime-contract.js'])assert.ok(readFileSync(new URL('../dist/client/'+asset,import.meta.url)).length>0);
});

test('homepage and manifest stay in the shared local design when Worker handles the request',async()=>{
  for(const path of ['/','/build','/status','/labs']){
    let requested;
    const response=await worker.fetch(request(path),{ASSETS:{fetch:async req=>{requested=new URL(req.url).pathname;return new Response('<link href="/theme.css"><h1>Local design</h1>');}}});
    assert.equal(requested,path);
    assert.match(await response.text(),/Local design/);
  }
});
