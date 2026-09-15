import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app-sw.js',import.meta.url),'utf8');
const origin='https://numinalabs.xyz';

function serviceWorker({stored=[],fetchImpl=async()=>new Response('current')}={}){
  const handlers=new Map(),cacheNames=new Set(stored),calls=[],lifecycle=[];
  const forbidden=()=>{throw Error('App responses must not use Cache Storage');};
  const context={URL,
    self:{location:{origin},addEventListener:(name,handler)=>handlers.set(name,handler),
      skipWaiting:async()=>{lifecycle.push('skipWaiting');},
      clients:{claim:async()=>{lifecycle.push('claim');}}},
    caches:{keys:async()=>[...cacheNames],delete:async key=>{
      lifecycle.push('delete:'+key);return cacheNames.delete(key);
    },open:forbidden,match:forbidden},
    fetch:(request,options)=>{calls.push({request,options});return fetchImpl(request,options);}
  };
  vm.runInNewContext(source,context);
  async function dispatchLifecycle(name){
    let pending;
    handlers.get(name)({waitUntil:promise=>{pending=promise;}});
    assert.ok(pending instanceof Promise,'lifecycle work must be awaited');
    await pending;
  }
  function dispatchFetch(request){
    let response,intercepted=false;
    handlers.get('fetch')({request,respondWith:promise=>{intercepted=true;response=promise;}});
    return {intercepted,response};
  }
  return {cacheNames,calls,lifecycle,dispatchLifecycle,dispatchFetch};
}

test('new worker activates promptly and removes only Numina app caches before claiming clients',async()=>{
  const worker=serviceWorker({stored:['numina-app-v3','numina-app-v4-connections-20260915','other-app-v1','numina-provider-reference']});
  await worker.dispatchLifecycle('install');
  assert.deepEqual(worker.lifecycle,['skipWaiting']);
  assert.equal(worker.calls.length,0,'installation does not precache app assets');
  await worker.dispatchLifecycle('activate');
  assert.deepEqual([...worker.cacheNames],['other-app-v1','numina-provider-reference']);
  assert.deepEqual(worker.lifecycle,['skipWaiting','delete:numina-app-v3','delete:numina-app-v4-connections-20260915','claim']);
});

test('same-origin reads bypass HTTP cache while retaining the exact request and response',async()=>{
  const response=new Response('current bytes',{status:206,headers:{'X-Current-Build':'fixture'}});
  const worker=serviceWorker({fetchImpl:async()=>response});
  for(const pathname of ['/app?service=a','/app-ui.js','/api/control/v1/treasury']){
    const request=new Request(origin+pathname,{headers:{Accept:'application/json','X-Request-Context':'preserved'},credentials:'include',redirect:'error'});
    const result=worker.dispatchFetch(request);
    assert.equal(result.intercepted,true);
    assert.equal(await result.response,response);
    const call=worker.calls.at(-1);
    assert.equal(call.request,request,'pass through the original request, including credentials and headers');
    assert.equal(call.options.cache,'no-store');
    assert.deepEqual(Object.keys(call.options),['cache']);
  }
  assert.equal(worker.calls.length,3);
});

test('failed reads propagate the failure without cached fallback or retry',async()=>{
  const failure=new Error('Offline fixture');
  const worker=serviceWorker({stored:['numina-app-v3'],fetchImpl:async()=>{throw failure;}});
  const result=worker.dispatchFetch(new Request(origin+'/app-ui.js'));
  await assert.rejects(result.response,error=>error===failure);
  assert.equal(worker.calls.length,1);
  assert.deepEqual([...worker.cacheNames],['numina-app-v3']);
});

test('cross-origin requests and all non-GET methods remain untouched',async()=>{
  const worker=serviceWorker();
  const requests=[new Request('https://external.example/asset.js')];
  for(const method of ['HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){
    requests.push(new Request(origin+'/api/control/v1/treasury',{
      method,headers:{'Content-Type':'application/json'},credentials:'include',
      ...(method==='HEAD'?{}:{body:'{"id":"unchanged-event"}'})
    }));
  }
  for(const request of requests){
    const result=worker.dispatchFetch(request);
    assert.equal(result.intercepted,false,request.method+' '+request.url);
    assert.equal(result.response,undefined);
    assert.equal(request.bodyUsed,false);
    if(request.body)assert.equal(await request.text(),'{"id":"unchanged-event"}');
  }
  assert.equal(worker.calls.length,0,'the worker cannot retry or consume writes');
});
