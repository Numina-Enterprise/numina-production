import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{PUBLIC_ALLOWED_PATHS,PRIVATE_NOTICE_JSON,CONTROL_BACKEND_HOST,publicGateBlocks,controlBackendAllows,isEdgeAliasHost} from '../src/worker.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const PREVIEW_HOSTS=['a1b2c3d4-numina-production.skott34.workers.dev','staging-numina-production.skott34.workers.dev','other-worker.skott34.workers.dev'];
const PRIVATE_SAMPLES=['/mcp','/mcp/tools','/api/control/v1/state','/api/control/v1/commands','/api/control/v1/treasury-attestation','/.well-known/mcp.json','/.well-known/mcp/server.json','/api/treasury/v1/model','/api/financial/v1/manifest','/api/nusd/v1/status','/api/ops/v1/telemetry','/api/app/v1/requests','/api/reviewer/v1/session','/api/connections/v1/manifest','/api/v0.1/anything','/downloads','/downloads/nusd/mint-receipt.json','/v1/status','/v2/network/status','/v5/release/manifest'];
const DECLARED=['/api/control/v2/head','/api/control/v2/a2a','/api/control/v2/mcp','/.well-known/agent-card.json','/api/control/v1/treasury'];
function assetsSpy(){const calls=[];return {calls,fetch(req){calls.push(new URL(req.url).pathname);return new Response('asset',{status:200});}};}

test('workers.dev and preview hosts are edge aliases; public and local hosts are classified as before',()=>{
  for(const host of [CONTROL_BACKEND_HOST,...PREVIEW_HOSTS,'NUMINA-PRODUCTION.SKOTT34.WORKERS.DEV'])assert.equal(isEdgeAliasHost(host),true,host);
  for(const host of ['numinalabs.xyz','www.numinalabs.xyz','127.0.0.1','numina.test','workers.dev.example.com'])assert.equal(isEdgeAliasHost(host),false,host);
});

test('the control backend alias keeps only its declared paths; previews keep none',()=>{
  for(const path of PRIVATE_SAMPLES)assert.equal(publicGateBlocks(CONTROL_BACKEND_HOST,path),true,path);
  for(const path of DECLARED)assert.equal(publicGateBlocks(CONTROL_BACKEND_HOST,path),false,path);
  for(const host of PREVIEW_HOSTS){
    for(const path of [...PRIVATE_SAMPLES,...DECLARED])assert.equal(publicGateBlocks(host,path),true,host+path);
    for(const path of PUBLIC_ALLOWED_PATHS)assert.equal(publicGateBlocks(host,path),false,host+path);
  }
  for(const path of DECLARED)assert.equal(publicGateBlocks('numinalabs.xyz',path),true,'public host still blocks '+path);
  assert.equal(controlBackendAllows(CONTROL_BACKEND_HOST,'/api/control/v2'),false);
  assert.equal(controlBackendAllows(CONTROL_BACKEND_HOST,'/api/control/v1/treasury/extra'),false);
  assert.equal(publicGateBlocks('127.0.0.1','/mcp'),false);
});

test('edge alias private routes answer with the 403 private notice and never reach handlers or assets',async()=>{
  for(const host of [CONTROL_BACKEND_HOST,PREVIEW_HOSTS[0]])for(const path of PRIVATE_SAMPLES){
    const assets=assetsSpy();
    const res=await worker.fetch(new Request('https://'+host+path,{headers:{Accept:'application/json',Authorization:'Bearer test-not-a-secret'}}),{ASSETS:assets,NUMINA_TELEMETRY_LOGS:'false'});
    assert.equal(res.status,403,host+path);assert.equal(assets.calls.length,0,host+path);
    assert.deepEqual(await res.json(),PRIVATE_NOTICE_JSON,host+path);
  }
  const preview=await worker.fetch(new Request('https://'+PREVIEW_HOSTS[0]+'/.well-known/agent-card.json'),{ASSETS:assetsSpy(),NUMINA_TELEMETRY_LOGS:'false'});
  assert.equal(preview.status,403);
});

test('declared callers on the control backend still reach their handlers',async()=>{
  for(const path of DECLARED){
    const res=await worker.fetch(new Request('https://'+CONTROL_BACKEND_HOST+path,{headers:{Accept:'application/json'}}),{ASSETS:assetsSpy(),NUMINA_TELEMETRY_LOGS:'false'});
    const body=await res.text();
    assert.ok(!(res.status===403&&body===JSON.stringify(PRIVATE_NOTICE_JSON)),path+' must not get the private notice');
  }
});

test('every workers.dev caller declared in the repository targets an allowed backend path',()=>{
  const routing=JSON.parse(read('config/numina-routing.json'));
  const declared=routing.rewrites.filter(r=>/\.workers\.dev\//.test(r.destination));
  assert.ok(declared.length>=2);
  for(const rule of declared){
    const target=new URL(rule.destination.replace(':path*','probe'));
    assert.equal(target.hostname,CONTROL_BACKEND_HOST,rule.destination);
    assert.equal(publicGateBlocks(target.hostname,target.pathname),false,rule.destination);
  }
  const workflow=read('.github/workflows/check-sites-control-origin.yml');
  const origin=workflow.match(/NUMINA_WORKER_ORIGIN:\s*(\S+)/)[1];
  assert.equal(new URL(origin).hostname,CONTROL_BACKEND_HOST);
  const paths=[...workflow.matchAll(/fetch\(origin\+'([^']+)'/g)].map(m=>m[1]);
  assert.ok(paths.includes('/api/control/v1/treasury'),'workflow treasury read found');
  for(const path of paths)assert.equal(publicGateBlocks(CONTROL_BACKEND_HOST,path),false,path);
});
