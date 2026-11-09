import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {repo} from './helpers.mjs';
import {defaultConfig,validateConfig} from '../../local/treasury/config.mjs';
import {REGISTRY} from '../../local/treasury/registry.mjs';

const d='/tmp/numina-treasury-config-test';
test('defaults: sandbox is the default profile, every adapter enabled in both profiles, Stripe approval required, OAuth 2.1 only',()=>{
  const c=validateConfig(defaultConfig(d),{repo});
  assert.equal(c.defaultProfile,'sandbox');assert.equal(c.stripeLiveApproval,'required');
  for(const p of ['sandbox','live']){assert.equal(c.profiles[p].mode,p);assert.equal(c.profiles[p].serverUrl,'https://mcp.stripe.com');
    assert.equal(c.profiles[p].auth.method,'oauth');
    assert.equal('apiKeyEnv' in c.profiles[p].auth,false);
    for(const t of REGISTRY.tools)assert.equal(c.profiles[p].tools[t.name].enabled,true,`${p}.${t.name}`);}
  assert.notEqual(c.profiles.sandbox.auth.tokenKeyEnv,c.profiles.live.auth.tokenKeyEnv);
  assert.notEqual(c.profiles.sandbox.auth.tokenFile,c.profiles.live.auth.tokenFile);
  assert.equal(c.compliance.mode,'informational');
});
test('sandbox and live must stay separately configured',()=>{
  const cases=[
    c=>{c.profiles.live.auth.tokenKeyEnv=c.profiles.sandbox.auth.tokenKeyEnv;},
    c=>{c.profiles.live.auth.tokenFile=c.profiles.sandbox.auth.tokenFile;},
    c=>{c.profiles.live.mode='sandbox';},
    c=>{delete c.profiles.live;},
    c=>{c.profiles.staging=c.profiles.live;}
  ];
  for(const [i,m] of cases.entries()){const c=defaultConfig(d);m(c);assert.throws(()=>validateConfig(c,{repo}),undefined,`case ${i}`);}
});
test('config rejects agent_api_key and never holds secret values; token and audit files stay outside the repo',()=>{
  const cases=[
    c=>{c.profiles.sandbox.auth.method='agent_api_key';},
    c=>{c.profiles.sandbox.auth.method='oauth';c.profiles.sandbox.auth.apiKeyEnv='NUMINA_STRIPE_MCP_SANDBOX_AGENT_KEY';},
    c=>{c.profiles.sandbox.auth.apiKey='ek_test_abcdefghijklmnop';},
    c=>{c.profiles.live.note='Bearer abcdefghijklmnopqrstu';},
    c=>{c.profiles.live.auth.accessToken='x';},
    c=>{c.profiles.sandbox.auth.tokenFile=path.join(repo,'local-data/sandbox.enc');},
    c=>{c.audit.path=path.join(repo,'audit.jsonl');},
    c=>{c.profiles.sandbox.serverUrl='http://mcp.stripe.com';},
    c=>{c.profiles.live.tools.send_money={enabled:true,locked:false};},
    c=>{c.profiles.live.tools.not_a_tool={enabled:true};},
    c=>{c.compliance.mode='blocking';}
  ];
  for(const [i,m] of cases.entries()){const c=defaultConfig(d);m(c);assert.throws(()=>validateConfig(c,{repo}),/OAuth 2.1|not supported|secret|outside|https|enabled|informational|INVALID_CONFIG|ConfigError|must be/i,`case ${i}`);}
});
