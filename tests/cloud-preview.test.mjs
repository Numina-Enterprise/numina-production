import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const pin=JSON.parse(readFileSync(new URL('../config/numina-node26.v1.json',import.meta.url),'utf8'));

async function availablePort(){
  const reservation=createServer();
  await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const {port}=reservation.address();
  await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  return port;
}

async function stop(child,group=false){
  if(child.exitCode!==null||child.signalCode!==null)return child.exitCode;
  return new Promise(resolve=>{
    const signal=value=>group?process.kill(-child.pid,value):child.kill(value);
    const timer=setTimeout(()=>signal('SIGKILL'),7000);
    child.once('close',code=>{clearTimeout(timer);resolve(code);});
    signal('SIGTERM');
  });
}

async function preview(t,npm=false){
  const port=await availablePort();
  const environment={TZ:'UTC'};
  if(npm){environment.PATH=process.env.PATH;if(process.env.NUMINA_NODE_PREFIX)environment.NUMINA_NODE_PREFIX=process.env.NUMINA_NODE_PREFIX;}
  const child=spawn(npm?'npm':process.execPath,npm?['start','--','--port',String(port)]:['scripts/serve-numina-cloud.mjs','--port',String(port)],{
    cwd:root,env:environment,detached:npm,stdio:['ignore','pipe','pipe']
  });
  let started=false,output='',errors='',logs='';
  child.stdout.on('data',chunk=>{logs=(logs+chunk).slice(-8192);});
  t.after(async()=>{
    const code=await stop(child,npm);
    if(started){
      if(npm)assert.match(logs,/"event":"numina_cloud_preview_stopping"/, 'npm preview handles SIGTERM');
      else assert.equal(code,0,'preview exits cleanly after SIGTERM');
    }
  });
  child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-8192);});
  const event=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('Preview startup timed out')),10000);
    const failed=error=>finish(error);
    const exited=code=>finish(new Error(`Preview exited before startup (${code}): ${errors}`));
    const received=chunk=>{
      output+=chunk;
      const lines=output.split('\n');output=lines.pop();
      for(const line of lines){
        let value;try{value=JSON.parse(line);}catch{continue;}
        if(value.event==='numina_cloud_preview_started')finish(null,value);
      }
    };
    function finish(error,value){
      clearTimeout(timer);child.off('error',failed);child.off('exit',exited);child.stdout.off('data',received);
      if(error)reject(error);else resolve(value);
    }
    child.once('error',failed);child.once('exit',exited);child.stdout.on('data',received);
  });
  started=true;
  assert.equal(event.nodeVersion,pin.version,'startup uses the exact configured Node release');
  const origin=`http://127.0.0.1:${port}`;
  const request=(path,options={})=>fetch(origin+path,{...options,signal:AbortSignal.timeout(5000)});
  const rpc=(method,params={})=>request('/mcp',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})
  });
  return {request,rpc,port};
}

test('npm start selects the pinned preview runtime from the invoking shell', {timeout:30000}, async t=>{
  const {request}=await preview(t,true);
  const response=await request('/__numina/cloud-runtime');
  assert.equal(response.status,200);
  const runtime=await response.json();
  assert.equal(runtime.nodeVersion,pin.version);
  assert.equal(runtime.privateD1Configured,false);
  assert.equal(runtime.signingConfigured,false);
  assert.equal(runtime.financialExecutionEnabled,false);
});

test('pinned cloud preview serves the generated Worker without private services', {timeout:30000}, async t=>{
  const {request,rpc,port}=await preview(t);

  await t.test('runtime observation reports loopback scope and unavailable private capabilities',async()=>{
    const response=await request('/__numina/cloud-runtime');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('X-Numina-Cloud-Preview'),'read-only');
    assert.equal(response.headers.get('X-Numina-Node-Version'),pin.version);
    const runtime=await response.json();
    assert.equal(runtime.nodeVersion,pin.version);
    assert.equal(runtime.canonicalRepository,root.replace(/\/$/,''));
    assert.equal(runtime.bindAddress,'127.0.0.1');
    assert.equal(runtime.port,port);
    for(const field of ['productionWorkerActivated','privateD1Configured','privateR2Configured','signingConfigured','financialExecutionEnabled'])assert.equal(runtime[field],false,field);
  });

  await t.test('public MCP initializes, lists tools and returns the real public build head',async()=>{
    const initialization=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'preview-regression',version:'1'}});
    assert.equal(initialization.status,200);
    const initialized=await initialization.json();
    assert.equal(initialized.result.protocolVersion,'2025-11-25');
    assert.equal(initialized.result.serverInfo.name,'numina');
    const listed=await rpc('tools/list');assert.equal(listed.status,200);
    const names=new Set((await listed.json()).result.tools.map(tool=>tool.name));
    for(const name of ['numina_connections','numina_architecture','numina_capabilities','numina_head'])assert.ok(names.has(name),name);
    const called=await rpc('tools/call',{name:'numina_head',arguments:{}});
    assert.equal(called.status,200);
    const head=JSON.parse((await called.json()).result.content[0].text);
    assert.equal(head.schema,'numina.public-head.v2');
    assert.equal(head.finalized,true);
    assert.equal(head.journalContinuity,null);
    const publicHead=await request('/api/control/v2/head');assert.equal(publicHead.status,200);
    assert.deepEqual(head,await publicHead.json());
  });

  await t.test('streamed assets preserve exact bytes and HEAD metadata on local HTTP',async()=>{
    const expected=readFileSync(new URL('../dist/client/index.html',import.meta.url));
    const get=await request('/');assert.equal(get.status,200);
    assert.equal(get.headers.get('Content-Length'),String(expected.length));
    assert.equal(get.headers.has('Strict-Transport-Security'),false);
    assert.doesNotMatch(get.headers.get('Content-Security-Policy'),/upgrade-insecure-requests/);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()),expected);
    const head=await request('/',{method:'HEAD'});assert.equal(head.status,200);
    assert.equal(head.headers.get('Content-Length'),String(expected.length));
    assert.equal(head.headers.get('Content-Type'),get.headers.get('Content-Type'));
    assert.equal((await head.arrayBuffer()).byteLength,0);
  });

  await t.test('private runtime and control reads remain unavailable and writes are rejected',async()=>{
    for(const path of ['/readyz','/v1/status','/api/control/v1/state','/api/control/v2/treasury']){
      const response=await request(path);assert.equal(response.status,503,path);
      const body=await response.json();assert.equal(body.error,'CLOUD_PREVIEW_SERVICE_UNAVAILABLE');assert.equal(body.configured,false);
    }
    for(const method of ['POST','PUT','PATCH','DELETE']){
      const response=await request('/api/control/v2/treasury',{method,body:'{}'});
      assert.equal(response.status,405,method);assert.equal((await response.json()).error,'CLOUD_PREVIEW_READ_ONLY');
    }
    const owner=await request('/mcp',{
      method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'test-owner','oai-authenticated-user-email':'owner@example.test'},
      body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'numina_owner_state',arguments:{}}})
    });
    assert.equal(owner.status,403);assert.equal((await owner.json()).error,'CLOUD_PREVIEW_READ_ONLY');
  });

  await t.test('malformed and oversized MCP bodies fail while subsequent public reads stay available',async()=>{
    const malformed=await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
    assert.equal(malformed.status,400);assert.equal((await malformed.json()).error,'INVALID_JSON');
    const oversized=await request('/mcp',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:3,method:'ping',params:{padding:'x'.repeat(16384)}})
    });
    assert.equal(oversized.status,413);assert.equal((await oversized.json()).error,'BODY_TOO_LARGE');
    const healthy=await rpc('ping');assert.equal(healthy.status,200);assert.deepEqual((await healthy.json()).result,{});
  });
});
