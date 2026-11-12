import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{canonicalSitePath,FORM_POST_PATHS,PRIVATE_NOTICE_JSON} from '../src/worker.js';
import {CHECKOUT_PATH} from '../src/checkout-redirect.js';

const env={NUMINA_TELEMETRY_LOGS:'false'};
function assetsSpy(){const calls=[];return {calls,fetch(req){calls.push(new URL(req.url).pathname);return new Response('asset:'+new URL(req.url).pathname,{status:200,headers:{'Content-Type':'text/plain'}});}};}
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('canonical paths collapse empty segments and reject encoded traversal',()=>{
  assert.equal(canonicalSitePath('/robots.txt'),'/robots.txt');
  assert.equal(canonicalSitePath('//robots.txt'),'/robots.txt');
  assert.equal(canonicalSitePath('/.well-known/assetlinks.json'),'/.well-known/assetlinks.json');
  assert.equal(canonicalSitePath('/%2e%2e%2fetc/passwd'),null);
  assert.equal(canonicalSitePath('/api/control/v1/..%2fsecret'),null);
  assert.equal(canonicalSitePath('/services%00.html'),null);
  assert.equal(canonicalSitePath('/services%0aX-Injected:1'),null);
  assert.equal(canonicalSitePath('/foo/../bar'),null);
  assert.equal(canonicalSitePath('/foo/./bar'),null);
  assert.equal(canonicalSitePath('robots.txt'),null);
});

test('worker responses carry the site security headers and allow same-origin form posts',async()=>{
  const assets=assetsSpy();
  const response=await worker.fetch(new Request('https://numinalabs.xyz/robots.txt'),{...env,ASSETS:assets});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('X-Frame-Options'),'DENY');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'),'same-origin-allow-popups');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
  assert.equal(response.headers.get('X-Permitted-Cross-Domain-Policies'),'none');
  assert.match(response.headers.get('Strict-Transport-Security'),/max-age=31536000/);
  assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.match(response.headers.get('Content-Security-Policy'),/form-action 'self' https:\/\/checkout\.stripe\.com;/);
  assert.match(response.headers.get('Permissions-Policy'),/payment=\(\)/);
  assert.deepEqual(assets.calls,['/robots.txt']);
  const headers=read('public/_headers');
  for(const name of ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Cross-Origin-Opener-Policy','Cross-Origin-Resource-Policy','Permissions-Policy','Strict-Transport-Security'])assert.match(headers,new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(headers,/form-action 'self' https:\/\/checkout\.stripe\.com;/);
  assert.match(headers,/\/final-build\.json[\s\S]*Cache-Control: no-store/);
});

test('encoded traversal, empty segments and unexpected methods never reach assets or private handlers',async()=>{
  const encoded=await worker.fetch(new Request('https://numinalabs.xyz/%2e%2e%2fetc/passwd'),{...env,ASSETS:assetsSpy()});
  assert.equal(encoded.status,404);
  const encodedBody=await encoded.text();
  assert.equal(encodedBody.includes('%2e'),false);
  assert.equal(encodedBody.includes('passwd'),false);
  assert.deepEqual(JSON.parse(encodedBody),{error:'NOT_FOUND'});

  const smuggled=await worker.fetch(new Request('https://numinalabs.xyz//api/control/v1/state'),{...env,ASSETS:assetsSpy()});
  assert.equal(smuggled.status,403);
  assert.deepEqual(await smuggled.json(),PRIVATE_NOTICE_JSON);

  const collapsed=assetsSpy();
  const robots=await worker.fetch(new Request('https://numinalabs.xyz//robots.txt'),{...env,ASSETS:collapsed});
  assert.equal(robots.status,200);
  assert.deepEqual(collapsed.calls,['/robots.txt']);

  assert.deepEqual([...FORM_POST_PATHS],[CHECKOUT_PATH]);
  for(const path of FORM_POST_PATHS){
    if(path===CHECKOUT_PATH)continue;
    const allowed=assetsSpy();
    const same=await worker.fetch(new Request('https://numinalabs.xyz'+path,{method:'POST',headers:{Origin:'https://numinalabs.xyz'},body:'a=1'}),{...env,ASSETS:allowed});
    assert.equal(same.status,200,path);
    assert.deepEqual(allowed.calls,[path]);
  }
  const posted=assetsSpy();
  const post=await worker.fetch(new Request('https://numinalabs.xyz/services',{method:'POST',headers:{Origin:'https://numinalabs.xyz'},body:'offering=diagnostic'}),{...env,ASSETS:posted});
  assert.equal(post.status,405);
  assert.equal(post.headers.get('Allow'),'GET, HEAD');
  assert.equal(posted.calls.length,0);
  const foreign=await worker.fetch(new Request('https://numinalabs.xyz/services',{method:'POST',headers:{Origin:'https://evil.example'},body:'a=1'}),{...env,ASSETS:assetsSpy()});
  assert.equal(foreign.status,405);
  assert.equal(foreign.headers.get('Allow'),'GET, HEAD');
  const missing=await worker.fetch(new Request('https://numinalabs.xyz/contact',{method:'POST',body:'a=1'}),{...env,ASSETS:assetsSpy()});
  assert.equal(missing.status,405);
  const traversal=assetsSpy();
  const encodedPost=await worker.fetch(new Request('https://numinalabs.xyz/%2e%2e%2fetc/passwd',{method:'POST',headers:{Origin:'https://numinalabs.xyz'},body:'a=1'}),{...env,ASSETS:traversal});
  assert.equal(encodedPost.status,404);
  assert.equal(traversal.calls.length,0);
  assert.equal((await encodedPost.json()).error,'NOT_FOUND');

  const trace=await worker.fetch({url:'https://numinalabs.xyz/robots.txt',method:'TRACE',headers:new Headers()},{...env,ASSETS:assetsSpy()});
  assert.equal(trace.status,405);
  assert.equal(trace.headers.get('Allow'),'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  assert.equal((await trace.json()).error,'METHOD_NOT_ALLOWED');
});

test('sensitive files are not stored by shared caches and failures omit internal errors',async()=>{
  const assets=assetsSpy();
  const manifest=await worker.fetch(new Request('https://numina.test/final-build.json'),{...env,ASSETS:assets});
  assert.equal(manifest.status,200);
  assert.equal(manifest.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(assets.calls,['/final-build.json']);

  const missing=await worker.fetch(new Request('https://numina.test/v5/not-a-route'),env);
  const body=await missing.json();
  assert.equal(missing.status,404);
  assert.deepEqual(body,{error:'NOT_FOUND'});
  assert.equal(missing.headers.get('Cache-Control'),'no-store');

  const failed=await worker.fetch(new Request('https://numina.test/privacy'),{...env,ASSETS:{fetch(){throw new Error('disk secret /etc/passwd');}}});
  const failure=await failed.text();
  assert.equal(failed.status,503);
  assert.equal(failure.includes('disk secret'),false);
  assert.equal(failure.includes('/etc/passwd'),false);
  assert.equal(JSON.parse(failure).error,'SERVICE_UNAVAILABLE');
});
