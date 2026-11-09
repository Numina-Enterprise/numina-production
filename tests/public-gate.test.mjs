import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{PUBLIC_BLOCKED_PREFIXES,PUBLIC_ALLOWED_PATHS,PRIVATE_NOTICE_JSON,publicGateBlocks} from '../src/worker.js';

const BLOCKED_SAMPLES=['/mcp','/mcp/tools','/api/control/v1/state','/api/control/v1/treasury','/api/control/v2/mcp','/api/control/v2/discovery-mcp','/api/control/v2/head','/api/control/v2/keys','/.well-known/agent-card.json','/.well-known/mcp.json','/.well-known/mcp/server.json','/api/treasury/v1/model','/api/financial/v1/manifest','/api/financial/v1/receipts','/api/nusd/v1/status','/api/ops/v1/telemetry','/api/ops/v1/quantum/measure','/api/app/v1/requests','/api/reviewer/v1/session','/api/connections/v1/manifest','/api/core/v1.8/manifest','/api/v0.1/anything','/downloads','/downloads/Numina-1500T-Approval-Handoff.zip','/downloads/nusd/mint-receipt.json','/v1/status','/v1/evidence/revoke','/v1/release/manifest','/v2/network/status','/v3/release/manifest','/v4/release/manifest','/v5/release/manifest'];
const HOSTS=['numinalabs.xyz','www.numinalabs.xyz'];
function assetsSpy(){const calls=[];return {calls,fetch(req){calls.push(new URL(req.url).pathname);return new Response('asset:'+new URL(req.url).pathname,{status:new URL(req.url).pathname.startsWith('/admin')?404:200});}};}

test('every blocked prefix is covered by a sample path',()=>{
  for(const prefix of PUBLIC_BLOCKED_PREFIXES)assert.ok(BLOCKED_SAMPLES.some(p=>p===prefix||p.startsWith(prefix)),prefix);
  for(const p of BLOCKED_SAMPLES)assert.equal(publicGateBlocks('numinalabs.xyz',p),true,p);
  for(const p of PUBLIC_ALLOWED_PATHS)assert.equal(publicGateBlocks('numinalabs.xyz',p),false,p);
  for(const p of ['/','/services','/contact','/privacy','/mcpx','/downloadsx','/frontier'])assert.equal(publicGateBlocks('numinalabs.xyz',p),false,p);
  assert.equal(publicGateBlocks('127.0.0.1','/mcp'),false);
});

test('public hosts answer every private route with the 403 private notice and leak nothing',async()=>{
  for(const host of HOSTS)for(const path of BLOCKED_SAMPLES)for(const method of ['GET','POST']){
    for(const accept of ['application/json','text/html,application/xhtml+xml;q=0.9','*/*']){
      const assets=assetsSpy();
      const init={method,headers:{Accept:accept,Authorization:'Bearer test-not-a-secret','Content-Type':'application/json'}};if(method==='POST')init.body='{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
      const res=await worker.fetch(new Request('https://'+host+path,init),{ASSETS:assets,NUMINA_TELEMETRY_LOGS:'false'});
      const body=await res.text(),label=method+' '+host+path+' '+accept;
      assert.equal(res.status,403,label);assert.equal(res.headers.get('Cache-Control'),'no-store',label);assert.equal(res.headers.get('X-Robots-Tag'),'noindex',label);
      assert.equal(assets.calls.length,0,label);
      assert.ok(!body.includes(path),label+' echoes the path');
      assert.doesNotMatch(body,/treasury|nusd|1500|chatgpt|token|key|mcp|<script/i,label);
      if(accept.startsWith('text/html')){
        assert.match(res.headers.get('Content-Type'),/^text\/html/,label);
        assert.match(body,/<meta name="robots" content="noindex/);assert.match(body,/This section is private\./);assert.match(body,/available on request or on the Numina Labs local network only/);assert.match(body,/href="\/contact"/);
      }else{
        assert.equal(res.headers.get('Content-Type'),'application/json',label);assert.deepEqual(JSON.parse(body),PRIVATE_NOTICE_JSON,label);
      }
    }
  }
  const head=await worker.fetch(new Request('https://numinalabs.xyz/mcp',{method:'HEAD'}),{ASSETS:assetsSpy()});assert.equal(head.status,403);assert.equal(await head.text(),'');
});

test('public hosts keep readyz, robots, favicon and Android asset links, and have no /admin',async()=>{
  const assets=assetsSpy();
  const robots=await worker.fetch(new Request('https://numinalabs.xyz/robots.txt'),{ASSETS:assets});assert.equal(robots.status,200);
  const links=await worker.fetch(new Request('https://numinalabs.xyz/.well-known/assetlinks.json'),{ASSETS:assets});assert.equal(links.status,200);
  assert.deepEqual(assets.calls,['/robots.txt','/.well-known/assetlinks.json']);
  const favicon=await worker.fetch(new Request('https://numinalabs.xyz/favicon.ico'),{ASSETS:assets});assert.equal(favicon.status,308);
  const ready=await worker.fetch(new Request('https://numinalabs.xyz/readyz'),{ASSETS:assets});assert.notEqual(ready.status,403);
  const admin=await worker.fetch(new Request('https://numinalabs.xyz/admin',{headers:{Accept:'text/html'}}),{ASSETS:assetsSpy()});
  assert.equal(admin.status,404);assert.doesNotMatch(await admin.text(),/numina-local-admin/);
  const adminApi=await worker.fetch(new Request('https://numinalabs.xyz/admin/api/treasury-route'),{ASSETS:assetsSpy()});assert.equal(adminApi.status,404);
});

test('the private handlers still answer on a non-public host',async()=>{
  const res=await worker.fetch(new Request('http://127.0.0.1/api/control/v2/head'),{ASSETS:assetsSpy()});
  assert.notEqual(res.status,403);
});
