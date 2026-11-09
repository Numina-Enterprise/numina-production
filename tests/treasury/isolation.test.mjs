import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setup,repo,blockedFetches} from './helpers.mjs';
import {SAMPLE_ARGS} from './mock-mcp-server.mjs';
import {createTreasuryRoutes} from '../../local/treasury/routes.mjs';
import {createTreasuryService} from '../../local/treasury/service.mjs';
import {defaultConfig} from '../../local/treasury/config.mjs';
import {guardedFetch} from '../../local/treasury/net-guard.mjs';

const walk=d=>readdirSync(d).flatMap(n=>{const p=path.join(d,n);return statSync(p).isDirectory()?walk(p):[p];});
test('nothing under local/ is imported by the public Worker, the src tree or the build',()=>{
  const worker=readFileSync(path.join(repo,'src/worker.js'),'utf8');
  assert.doesNotMatch(worker,/['"][./]*local\/|local\/treasury|treasury-mcp/);
  for(const f of walk(path.join(repo,'src')).filter(f=>/\.m?js$/.test(f)&&!f.includes(`${path.sep}local${path.sep}`)))
    assert.doesNotMatch(readFileSync(f,'utf8'),/from\s+['"][^'"]*\/local\/(treasury|compliance)|import\(['"][^'"]*local\/treasury/,f);
  for(const f of walk(path.join(repo,'scripts')).filter(f=>/\.m?js$/.test(f)))assert.doesNotMatch(readFileSync(f,'utf8'),/local\/treasury|['"]\.\.\/local\//,f);
  const bundle=path.join(repo,'dist/server/index.js');
  if(existsSync(bundle)){const b=readFileSync(bundle,'utf8');for(const m of ['numina-local-treasury-mcp','treasury-mcp-config','NUMINA_TREASURY_AUDIT_SIGNING_KEY','stripeLiveApproval'])assert.ok(!b.includes(m),m);}
});

test('the default config targets mcp.stripe.com, but the guard refuses it and the suite never reached it',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'numina-treasury-guard-'));
  try{
    const env={NUMINA_TREASURY_NETWORK_GUARD:'loopback-only',NUMINA_STRIPE_MCP_SANDBOX_AGENT_KEY:'ek_test_guardguardguard'};
    const config=defaultConfig(path.join(dir,'state'));config.profiles.sandbox.auth.method='agent_api_key';
    let realCalls=0;const counting=async()=>{realCalls++;throw new Error('should not be called');};
    const s=createTreasuryService({config,env,fetchImpl:counting});
    const r=await s.call('get_balance_summary',{},{profile:'sandbox'});
    assert.equal(r.status,'blocked');assert.equal(r.reason,'NETWORK_GUARD');assert.equal(realCalls,0);
    await assert.rejects(guardedFetch(env,counting)('https://mcp.stripe.com'),/loopback-only/);
    await assert.rejects(guardedFetch({},counting)('http://example.com'),/non-https/);
    assert.equal(realCalls,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
  assert.deepEqual(blockedFetches,[],'no test attempted a non-loopback fetch');
});

test('admin routes: loopback Host only, reads open, writes need the admin token',async()=>{
  const t=await setup();
  const dataDir=mkdtempSync(path.join(tmpdir(),'numina-treasury-data-'));
  try{
    // Point the stored config at the mocks (written through the route, with the token).
    const handle=createTreasuryRoutes({env:t.env,fetchImpl:fetch,stateDir:path.join(t.dir,'state')});
    const ctx=ok=>({repo,dataDir,authorized:()=>ok});
    const req=(p,init={},host='127.0.0.1:8790')=>new Request(`http://${host}${p}`,{...init,headers:{Host:host,...init.headers}});
    assert.equal((await handle(req('/admin/treasury/status',{},'192.168.1.20:8790'),ctx(true))).status,403);
    const st=await (await handle(req('/admin/treasury/status'),ctx(false))).json();
    assert.equal(st.defaultProfile,'sandbox');assert.equal(st.stripeLiveApproval,'required');assert.ok(st.notices.some(n=>/2026-11-30/.test(n)));
    assert.equal(st.adapters.length,16);assert.ok(st.adapters.every(a=>a.sandbox==='enabled'&&a.live==='enabled'&&a.implemented));
    const body=JSON.stringify(t.config);
    assert.equal((await handle(req('/admin/treasury/config',{method:'PUT',body}),ctx(false))).status,401);
    assert.equal((await handle(req('/admin/treasury/config',{method:'PUT',body:JSON.stringify({...t.config,stripeLiveApproval:'off'})}),ctx(true))).status,400);
    assert.equal((await handle(req('/admin/treasury/config',{method:'PUT',body}),ctx(true))).status,200);
    const callBody=JSON.stringify({profile:'sandbox',args:{}});
    assert.equal((await handle(req('/admin/treasury/call/get_balance_summary',{method:'POST',body:callBody}),ctx(false))).status,401);
    assert.equal(t.sbx.calls().length,0);
    const ok=await handle(req('/admin/treasury/call/get_balance_summary',{method:'POST',body:callBody}),ctx(true));
    assert.equal(ok.status,200);assert.equal((await ok.json()).status,'ok');
    const money=await (await handle(req('/admin/treasury/call/send_money',{method:'POST',body:JSON.stringify({profile:'live',args:SAMPLE_ARGS.send_money})}),ctx(true))).json();
    assert.equal(money.status,'pending_stripe_approval');
    const sessions=await (await handle(req('/admin/treasury/sessions'),ctx(false))).json();
    assert.equal(sessions.sessions.length,2);assert.match(JSON.stringify(sessions.runbook),/Revoke access/);
    assert.equal((await handle(req('/admin/treasury/sessions/live',{method:'DELETE'}),ctx(false))).status,401);
    assert.equal((await handle(req('/admin/treasury/sessions/live',{method:'DELETE'}),ctx(true))).status,200);
    const v=await (await handle(req('/admin/treasury/audit/verify'),ctx(false))).json();assert.equal(v.ok,true);assert.equal(v.signed,true);
    const html=await (await handle(req('/admin/treasury'),ctx(false))).text();assert.match(html,/Stripe Treasury MCP \(local only\)/);
    assert.equal(await handle(req('/elsewhere'),ctx(true)),null);
  }finally{rmSync(dataDir,{recursive:true,force:true});await t.teardown();}
});
