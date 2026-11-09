import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {setup} from './helpers.mjs';
import {login,pkcePair,OAuthError} from '../../local/treasury/oauth.mjs';
import {createTokenStore} from '../../local/treasury/token-store.mjs';
import {createTreasuryService} from '../../local/treasury/service.mjs';
import {guardedFetch} from '../../local/treasury/net-guard.mjs';
import {listSessions,revokeLocal,STRIPE_REVOKE_RUNBOOK} from '../../local/treasury/sessions.mjs';
import {startMockServer} from './mock-mcp-server.mjs';
import {defaultConfig} from '../../local/treasury/config.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';

const browser=async u=>{const r=await fetch(u,{redirect:'manual'});assert.equal(r.status,302);const cb=new URL(r.headers.get('location'));assert.equal(cb.hostname,'127.0.0.1');await (await fetch(cb)).text();};

test('PKCE pair uses S256',()=>{const p=pkcePair();assert.equal(p.method,'S256');assert.equal(p.challenge,createHash('sha256').update(p.verifier).digest('base64url'));assert.ok(p.verifier.length>=43);});

test('OAuth 2.1 + PKCE login against the mock AS: loopback redirect, resource indicator, refresh_token registration, encrypted token file, separate per profile',async()=>{
  const t=await setup({loginProfiles:[]});
  try{
    const p=t.config.profiles.sandbox;
    const store=createTokenStore({file:p.auth.tokenFile,keyEnv:p.auth.tokenKeyEnv,env:t.env,profile:'sandbox'});
    const r=await login({serverUrl:p.serverUrl,store,fetchImpl:guardedFetch(t.env,fetch),openUrl:browser,clientName:p.auth.oauthClientName,oauth21:true});
    assert.equal(r.profile,'sandbox');assert.ok(!('accessToken' in r));
    const q=t.sbx.state.authorizeQuery;
    assert.equal(q.code_challenge_method,'S256');assert.equal(q.resource,t.sbx.origin);assert.match(q.redirect_uri,/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.equal(q.scope,'mcp');
    assert.deepEqual(t.sbx.state.registered.redirect_uris,[q.redirect_uri]);assert.equal(t.sbx.state.registered.token_endpoint_auth_method,'none');
    assert.deepEqual(t.sbx.state.registered.grant_types,['authorization_code','refresh_token']);
    assert.deepEqual(t.sbx.state.registered.response_types,['code']);
    assert.deepEqual(t.sbx.state.tokenRequests[0],{grant_type:'authorization_code',resource:t.sbx.origin,hasVerifier:true});
    const raw=readFileSync(p.auth.tokenFile,'utf8');
    assert.doesNotMatch(raw,/mock_at_|mock_rt_/);assert.equal(JSON.parse(raw).alg,'AES-256-GCM');
    assert.ok(!existsSync(t.config.profiles.live.auth.tokenFile),'live has its own, separate session');
    assert.throws(()=>createTokenStore({file:p.auth.tokenFile,keyEnv:'K',env:{K:Buffer.alloc(32,7).toString('base64')},profile:'sandbox'}).load(),/decrypt/);
    assert.throws(()=>createTokenStore({file:p.auth.tokenFile,keyEnv:p.auth.tokenKeyEnv,env:t.env,profile:'live'}).load(),/decrypt/);

    const s=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
    assert.equal((await s.call('get_balance_summary',{},{profile:'sandbox'})).status,'ok');
    t.sbx.expireAll();
    const s2=createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch});
    assert.equal((await s2.call('get_balance_summary',{},{profile:'sandbox'})).status,'ok');
    assert.equal(t.sbx.state.tokenRequests.at(-1).grant_type,'refresh_token');
    const lr=await s2.call('get_balance_summary',{},{profile:'live'});assert.equal(lr.status,'blocked');assert.equal(lr.reason,'MCP_NO_CREDENTIAL');
    assert.equal(t.lv.requests.length,0);

    const list=listSessions(t.config,t.env);
    const sb=list.find(x=>x.profile==='sandbox');assert.equal(sb.stored,true);assert.equal(sb.hasRefreshToken,true);assert.equal(sb.authLabel,'OAuth 2.1');
    assert.doesNotMatch(JSON.stringify(list),/mock_at_|mock_rt_|mock-client-/);
    assert.equal(list.find(x=>x.profile==='live').stored,false);
    const rv=revokeLocal(t.config,'sandbox',t.env);assert.equal(rv.deleted,true);assert.ok(!existsSync(p.auth.tokenFile));
    assert.deepEqual(rv.stripeSide,STRIPE_REVOKE_RUNBOOK);assert.ok(STRIPE_REVOKE_RUNBOOK.yourSessions.some(x=>/Revoke access/.test(x)));
    assert.match(STRIPE_REVOKE_RUNBOOK.auth,/OAuth 2\.1 only/);
    assert.equal('agentApiKeys' in STRIPE_REVOKE_RUNBOOK,false);
    const after=await createTreasuryService({config:t.config,env:t.env,fetchImpl:fetch}).call('get_balance_summary',{},{profile:'sandbox'});
    assert.equal(after.status,'blocked');assert.equal(after.reason,'MCP_NO_CREDENTIAL');
  }finally{await t.teardown();}
});

test('RFC 9207 iss mismatch is rejected when authorization_response_iss_parameter_supported',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'numina-iss-'));
  const mock=await startMockServer({oauth:true});
  // Monkey-patch authorize to return wrong iss
  const origFetch=globalThis.fetch;
  try{
    const env={NUMINA_TREASURY_NETWORK_GUARD:'loopback-only',NUMINA_TREASURY_SANDBOX_TOKEN_KEY:randomBytes(32).toString('base64')};
    const config=defaultConfig(path.join(dir,'state'));config.profiles.sandbox.serverUrl=mock.url;
    const store=createTokenStore({file:config.profiles.sandbox.auth.tokenFile,keyEnv:config.profiles.sandbox.auth.tokenKeyEnv,env,profile:'sandbox'});
    const badBrowser=async u=>{
      const r=await fetch(u,{redirect:'manual'});
      const loc=new URL(r.headers.get('location'));
      loc.searchParams.set('iss','http://evil.example/as');
      await (await fetch(loc)).text();
    };
    await assert.rejects(login({serverUrl:mock.url,store,fetchImpl:guardedFetch(env,fetch),openUrl:badBrowser,oauth21:true}),/iss/);
  }finally{await mock.close();rmSync(dir,{recursive:true,force:true});}
});

test('RFC 9207 iss absent is rejected when authorization_response_iss_parameter_supported=true',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'numina-iss-omit-'));
  const mock=await startMockServer({oauth:true,omitIss:true});
  try{
    const env={NUMINA_TREASURY_NETWORK_GUARD:'loopback-only',NUMINA_TREASURY_SANDBOX_TOKEN_KEY:randomBytes(32).toString('base64')};
    const config=defaultConfig(path.join(dir,'state'));config.profiles.sandbox.serverUrl=mock.url;
    const store=createTokenStore({file:config.profiles.sandbox.auth.tokenFile,keyEnv:config.profiles.sandbox.auth.tokenKeyEnv,env,profile:'sandbox'});
    await assert.rejects(login({serverUrl:mock.url,store,fetchImpl:guardedFetch(env,fetch),openUrl:browser,oauth21:true}),/missing required iss|OAUTH_ISS/);
  }finally{await mock.close();rmSync(dir,{recursive:true,force:true});}
});

test('token store refuses to write without its encryption key',()=>{
  const s=createTokenStore({file:'/tmp/numina-never-written.enc',keyEnv:'MISSING_KEY_ENV',env:{},profile:'sandbox'});
  assert.throws(()=>s.save({accessToken:'x'}),/MISSING_KEY_ENV/);assert.ok(!existsSync('/tmp/numina-never-written.enc'));
});
