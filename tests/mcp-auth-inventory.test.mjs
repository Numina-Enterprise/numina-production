import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as mcpClient from '../local/treasury/mcp-client.mjs';
import {defaultConfig,validateConfig} from '../local/treasury/config.mjs';

const repo=fileURLToPath(new URL('..',import.meta.url));

test('Stripe treasury: no apiKeyAuth export; config oauth-only; agent_api_key rejected',()=>{
  assert.equal('apiKeyAuth' in mcpClient,false);
  const c=defaultConfig('/tmp/numina-inv');
  assert.equal(c.profiles.sandbox.auth.method,'oauth');
  assert.equal('apiKeyEnv' in c.profiles.sandbox.auth,false);
  validateConfig(c,{repo});
  const bad=defaultConfig('/tmp/numina-inv');bad.profiles.sandbox.auth.method='agent_api_key';
  assert.throws(()=>validateConfig(bad,{repo}),/OAuth 2\.1/);
});

test('inventory doc lists every MCP connection and Stripe as OAuth 2.1 only',()=>{
  const doc=readFileSync(path.join(repo,'docs/MCP-AUTH-INVENTORY.md'),'utf8');
  for(const needle of ['local/treasury','frontier-http','discovery-mcp','sites-mcp-http','mcp-stdio.js','control-mcp-stdio.js','.mcp.json','.github/mcp.json','stdio, spec-exempt','OAuth 2.1 only'])
    assert.ok(doc.includes(needle),needle);
});

test('repo config surface has no Stripe agent API key option under local/treasury',()=>{
  const files=['local/treasury/config.mjs','local/treasury/mcp-client.mjs','local/treasury/service.mjs','local/treasury/routes.mjs','local/treasury/sessions.mjs','docs/LOCAL-TREASURY-MCP.md'];
  for(const f of files){
    const t=readFileSync(path.join(repo,f),'utf8');
    assert.doesNotMatch(t,/\bagent_api_key\b/,f);
    assert.doesNotMatch(t,/apiKeyAuth/,f);
    assert.doesNotMatch(t,/NUMINA_STRIPE_MCP_\w+_AGENT_KEY/,f);
    assert.doesNotMatch(t,/Agent API keys must be agent-tagged/,f);
  }
});
