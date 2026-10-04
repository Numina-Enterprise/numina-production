import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {createRuntimeReleaseUI,createManifestReleaseUI,RUNTIME_ENDPOINTS} from '../public/runtime-release-ui.js';
import {MANIFEST_ROUTES,alignedApplication} from '../public/manifest-surface.js';
import {EXPECTED_RELEASE} from '../public/runtime-contract.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const application={identity:'NUMINA',manifest:'NUMINA',singular:true,release_channel:'production',frontier:{version:'4.0.0'},distribution:{codex_plugin:{version:'4.0.0'}},runtime_dependency:{identity:'NUMINA',singular:true,version:'1.9.0-rc26',release:'core-v1.8+prod-v1.9.0-rc26'},schema:'numina.application-release.v2',schema_version:2,product:'Numina',version:'4.0.0',release:'numina-v4.0.0',build_id:'a'.repeat(64)};
const canonical={schema:'numina.manifest.v2',singular:true,root:'NUMINA',identity:'NUMINA',manifest:'NUMINA',authority:'NUMINA',repository:'NUMINA',version:'1.0.0',applicationVersion:'4.0.0',applicationRelease:'numina-v4.0.0',mechanics:{repository:{identity:'NUMINA',source:'/NUMINA'},artifact:{build_id:application.build_id},runtime:application.runtime_dependency}};
const applicationBytes=JSON.stringify(application,null,3)+'\n';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function target(){
  const listeners=new Map(),attributes=new Map();
  return {textContent:'',dataset:{},disabled:false,children:[],
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
    emit(type,event={}){for(const fn of listeners.get(type)||[])fn({currentTarget:this,...event});},
    setAttribute(name,value){attributes.set(name,value);},removeAttribute(name){attributes.delete(name);if(name==='href')delete this.href;},
    getAttribute(name){return attributes.get(name);},replaceChildren(...children){this.children=children;},append(){},click(){},remove(){}
  };
}
function dom(){
  const nodes=new Map(),window=target();
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,target());return nodes.get(selector);};
  const downloads=['manifest','attestation','key'].map(kind=>Object.assign(target(),{dataset:{download:kind}}));
  const document={querySelectorAll(selector){return selector==='[data-download]'?downloads:[node(selector)];},createElement:target,body:target()};
  return {document,window,node,downloads,text:selector=>node(selector).textContent};
}
function applicationUI(view,fetcher,{crypto=webcrypto,timeoutMs=12000}={}){
  const blobs=[],revoked=[];
  const context=vm.createContext({document:view.document,window:view.window,fetch:(path,options)=>path===MANIFEST_ROUTES.manifest?Promise.resolve(Response.json(canonical)):fetcher(path,options),MANIFEST_ROUTES,alignedApplication,crypto,TextDecoder,Uint8Array,AbortController,Blob,navigator:{},
    URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test-'+blobs.length;},revokeObjectURL(url){revoked.push(url);}},
    setTimeout(fn){return setTimeout(fn,timeoutMs);},clearTimeout});
  const script=read('public/application-release-ui.js').toString().replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  vm.runInContext(script.replace(/void refreshApplicationRelease\(\);\s*$/,'globalThis.applicationUI={refresh:refreshApplicationRelease,ready:refreshApplicationRelease()};'),context);
  return {...context.applicationUI,blobs,revoked};
}
function runtimeUI(view,fetcher,options={}){
  return createRuntimeReleaseUI({document:view.document,window:view.window,fetch:fetcher,...options});
}

// Reproduces the signed-out /app panel: the application and runtime modules share
// a document but consume different endpoints. Network presentation stays independent.
test('received application inventory and a failed runtime endpoint have distinct signed-out status',async()=>{
  const view=dom(),calls=[];
  view.node('[data-network-connection]').textContent='Application node connected when checked';
  const fetcher=async(path,options)=>{
    calls.push(path);assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
    return path===MANIFEST_ROUTES.inventory?new Response(applicationBytes):new Response('',{status:503});
  };
  const app=applicationUI(view,fetcher),runtime=runtimeUI(view,fetcher);
  try{
    await Promise.all([app.ready,runtime.refresh()]);
    assert.equal(view.text('[data-application-state]'),'Application release 4.0.0 matches the canonical manifest · fingerprint calculated');
    assert.equal(view.text('[data-application-manifest-sha]'),digest(applicationBytes));
    assert.equal(await app.blobs[0].text(),applicationBytes);
    assert.equal(view.text('[data-runtime-release-summary]'),'Runtime manifest unavailable');
    assert.match(view.text('[data-runtime-release-detail]'),/runtime manifest at \/v1\/release\/manifest could not be loaded\. Endpoint unavailable \(HTTP 503\)/);
    assert.match(view.text('[data-runtime-release-detail]'),/binding could not be checked/);
    assert.match(view.text('[data-runtime-release-detail]'),/Application release fingerprints and network connection checks are reported separately/);
    assert.doesNotMatch(view.text('[data-runtime-release-detail]'),/No current release manifest|binding is not verified/);
    assert.match(view.text('[data-application-provenance-status]'),/^Not verified/);
    assert.equal(view.text('[data-network-connection]'),'Application node connected when checked');
    assert.deepEqual(new Set(calls),new Set([MANIFEST_ROUTES.inventory,...Object.values(RUNTIME_ENDPOINTS)]));
  }finally{runtime.destroy();view.window.emit('pagehide');}
});

test('fingerprint failure retains the received manifest without inventing signature verification',async()=>{
  for(const crypto of [{}, {subtle:{digest:async()=>{throw Error('unavailable');}}}, {subtle:{digest:()=>new Promise(()=>{})}}]){
    const view=dom(),app=applicationUI(view,async()=>new Response(applicationBytes),{crypto,timeoutMs:30});
    await app.ready;
    assert.equal(view.text('[data-application-state]'),'Application release 4.0.0 matches the canonical manifest · fingerprint unavailable');
    assert.equal(view.text('[data-application-build]'),application.build_id);
    assert.equal(view.text('[data-application-manifest-sha]'),'Unavailable');
    assert.equal(view.node('[data-application-download]').disabled,false);
    assert.equal(await app.blobs[0].text(),applicationBytes);
    assert.equal(view.node('[data-application-attestation-lookup]').getAttribute('aria-disabled'),'true');
    assert.match(view.text('[data-application-provenance-status]'),/^Not verified/);
    view.window.emit('pagehide');
  }
});

test('application fetch, parsing, identity and timeout failures clear earlier manifest evidence',async()=>{
  for(const response of [()=>new Response('',{status:503}),()=>new Response('{'),()=>Response.json({...application,release:'wrong'}),()=>Promise.reject(new TypeError('offline')),()=>new Promise(()=>{})]){
    const view=dom();let fail=false;
    const app=applicationUI(view,async()=>fail?response():new Response(applicationBytes),{timeoutMs:30});
    await app.ready;fail=true;await app.refresh();
    assert.equal(view.text('[data-application-state]'),'Application release manifest could not be loaded');
    assert.equal(view.text('[data-application-manifest-sha]'),'Unavailable');
    assert.equal(view.node('[data-application-download]').disabled,true);
    assert.equal(view.node('[data-application-copy-command]').disabled,true);
    assert.equal(view.node('[data-application-attestation-lookup]').getAttribute('aria-disabled'),'true');
    assert.equal(app.revoked.length,1);
  }
});

test('runtime transport, timeout, malformed response and HTTP failures report the observed cause',async()=>{
  for(const [fetcher,reason]of [
    [async()=>{throw new TypeError('Failed to fetch');},/could not be reached/],
    [()=>new Promise(()=>{}),/Request timed out/],
    [async()=>new Response('not json'),/unreadable JSON response/],
    [async()=>Response.json([]),/unrecognized JSON response/],
    [async()=>new Response('',{status:401}),/HTTP 401/],
    [async()=>new Response('',{status:502}),/HTTP 502/]
  ]){
    const view=dom(),ui=runtimeUI(view,fetcher,{timeoutMs:30});
    try{await ui.refresh();assert.equal(view.text('[data-runtime-release-summary]'),'Runtime manifest unavailable');assert.match(view.text('[data-runtime-release-detail]'),reason);assert.equal(view.downloads[0].disabled,true);}
    finally{ui.destroy();}
  }
});

test('runtime manifest failure is displayed while other evidence is still pending',async()=>{
  const gate=deferred(),view=dom(),ui=runtimeUI(view,async path=>path===RUNTIME_ENDPOINTS.manifest?new Response('',{status:503}):gate.promise);
  try{
    const loading=ui.refresh();await tick();
    assert.equal(view.text('[data-runtime-release-summary]'),'Runtime manifest unavailable');
    assert.match(view.text('[data-runtime-release-detail]'),/binding check is running/);
    gate.resolve(new Response('',{status:503}));await loading;
    assert.match(view.text('[data-runtime-release-detail]'),/binding could not be checked/);
  }finally{ui.destroy();gate.resolve(new Response('',{status:503}));}
});

test('a received runtime manifest does not claim binding when a control receipt is missing or invalid',async()=>{
  for(const response of [()=>new Response('',{status:503}),()=>Response.json({manifest:{schema:'numina.control-manifest.v1'},receipt:{signature:'invalid'}})]){
    const view=dom(),ui=runtimeUI(view,async path=>path===RUNTIME_ENDPOINTS.manifest?Response.json(EXPECTED_RELEASE):path===RUNTIME_ENDPOINTS.control?response():new Response('',{status:503}));
    try{
      await ui.refresh();assert.match(view.text('[data-runtime-release-summary]'),/^Runtime 1\.9\.0-rc26 · observed release$/);
      assert.match(view.text('[data-runtime-release-detail]'),/binding (could not be checked|is not verified)/);
      assert.doesNotMatch(view.text('[data-runtime-release-detail]'),/receipt matches/);
      assert.equal(view.text('[data-signature-status]'),'Not verified');
    }finally{ui.destroy();}
  }
});

test('new application refresh wins over a late fingerprint and page restoration reloads current evidence',async()=>{
  const view=dom(),gate=deferred();let hashCalls=0,fetchCalls=0;
  const app=applicationUI(view,async()=>{fetchCalls++;return new Response(applicationBytes);},{crypto:{subtle:{digest(...args){return ++hashCalls===1?gate.promise:webcrypto.subtle.digest(...args);}}}});
  await tick();assert.match(view.text('[data-application-state]'),/calculating fingerprint/);
  await app.refresh();const current=view.text('[data-application-manifest-sha]');
  gate.resolve(new Uint8Array(32).fill(255));await app.ready;
  assert.equal(view.text('[data-application-manifest-sha]'),current);
  view.window.emit('pagehide');assert.equal(view.text('[data-application-manifest-sha]'),'Unavailable');
  view.window.emit('pageshow',{persisted:true});await tick();
  assert.equal(fetchCalls,3);assert.equal(view.text('[data-application-manifest-sha]'),digest(applicationBytes));
  view.window.emit('pagehide');
});

test('new runtime refresh and pagehide discard superseded successful responses',async()=>{
  const view=dom(),gate=deferred();let fresh=false;
  const ui=runtimeUI(view,async()=>fresh?new Response('',{status:503}):gate.promise);
  try{
    const stale=ui.refresh();fresh=true;await ui.refresh();
    gate.resolve(Response.json(EXPECTED_RELEASE));await stale;
    assert.equal(view.text('[data-runtime-release-summary]'),'Runtime manifest unavailable');
    view.window.emit('pagehide');assert.equal(view.text('[data-runtime-release-summary]'),'Unavailable');
    assert.ok(view.downloads.every(button=>button.disabled));
    view.window.emit('pageshow',{persisted:true});await tick();
    assert.equal(view.text('[data-runtime-release-summary]'),'Runtime manifest unavailable');
  }finally{ui.destroy();gate.resolve(new Response('',{status:503}));}
});

test('production build ships current release UI and verification sources with matching inventory hashes',()=>{
  const source=JSON.parse(read('dist/client/source-alignment.json'));
  const release=JSON.parse(read('dist/client/downloads/application-release-v4.json'));
  for(const file of ['application-release-ui.js','runtime-release-ui.js','runtime-release-model.js','runtime-contract.js']){
    const bytes=read('public/'+file);assert.deepEqual(read('dist/client/'+file),bytes,file);
    assert.equal(source.sourceInputs.find(item=>item.path==='public/'+file)?.sha256,digest(bytes),file);
    assert.equal(release.artifacts.find(item=>item.path==='client/'+file)?.sha256,digest(bytes),file);
  }
});

test('current manifest view binds app, control and RC26 identities without claiming a signature',async()=>{
 const view=dom(),calls=[];
 const bodies={
  [MANIFEST_ROUTES.manifest]:canonical,
  [MANIFEST_ROUTES.release]:application,
  [MANIFEST_ROUTES.capabilities]:{schema:'numina.frontier.v2',identity:'NUMINA',version:'4.0.0'},
  [MANIFEST_ROUTES.health]:{identity:'NUMINA',root:'NUMINA',version:'1.0.0',status:'degraded',revision:0,eventCount:0,checks:{storage:true,manifestIntegrity:false,evidenceHead:false,journalContinuity:false,authorityConfigured:true}}
 };
 const ui=createManifestReleaseUI({document:view.document,window:view.window,fetch:async(path,options)=>{calls.push(path);assert.equal(options.credentials,'omit');return Response.json(bodies[path],{status:path===MANIFEST_ROUTES.health?503:200});}});
 try{await ui.refresh();assert.match(view.text('[data-runtime-release-summary]'),/^Manifest aligned/);assert.equal(view.text('[data-readiness]'),'Control degraded');assert.equal(view.text('[data-signature-status]'),'No current signature check');assert.ok(calls.every(path=>!path.startsWith('/v1/')));assert.equal(view.downloads[0].disabled,false);assert.ok(view.downloads.slice(1).every(button=>button.disabled));}finally{ui.destroy();}
});

test('current manifest view rejects mismatched inventories and clears evidence on pagehide',async()=>{
 const view=dom();
 const ui=createManifestReleaseUI({document:view.document,window:view.window,fetch:async path=>Response.json(path===MANIFEST_ROUTES.manifest?canonical:path===MANIFEST_ROUTES.release?{...application,build_id:'f'.repeat(64)}:{})});
 try{await ui.refresh();assert.match(view.text('[data-runtime-release-summary]'),/^Needs attention/);assert.equal(view.text('[data-supply-status]'),'Application identity not aligned');view.window.emit('pagehide');assert.equal(view.text('[data-runtime-release-summary]'),'Unavailable');assert.ok(view.downloads.every(button=>button.disabled));}finally{ui.destroy();}
});
