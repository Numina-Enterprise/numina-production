import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl} from '../src/control-store.js';
import worker,{CONTROL_BACKEND_HOST,publicGateBlocks} from '../src/worker.js';
import {GITHUB_OIDC_AUDIENCE,GITHUB_OIDC_ISSUER,GITHUB_OIDC_JWKS} from '../src/control-http.js';
import {
  MCP_ISSUER_ROLE,
  MCP_REGISTERED_REDIRECT_URI,
  MCP_RESOURCE,
  MCP_RESOURCE_METADATA_URL,
  MCP_SCOPE,
  decideAuthorizationCode,
  mcpProtectedResourceMetadata
} from '../src/mcp-resource-auth.js';

const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function tokenFor(claims,privateKey,kid='numina-test'){
  const header=enc({alg:'RS256',kid,typ:'JWT'}),payload=enc(claims),input=header+'.'+payload;
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
}
function claimsFor(now,extra={}){
  return {
    iss:GITHUB_OIDC_ISSUER,aud:MCP_RESOURCE,scope:MCP_SCOPE,
    sub:'repo:Numina-Enterprise/numina-production:environment:production',
    repository:'Numina-Enterprise/numina-production',repository_id:'1367647143',
    repository_owner:'Numina-Enterprise',repository_owner_id:'269050000',
    ref:'refs/heads/main',environment:'production',event_name:'workflow_dispatch',
    workflow_ref:'Numina-Enterprise/numina-production/.github/workflows/settle-numina-aggregate-model.yml@refs/heads/main',
    runner_environment:'github-hosted',iat:now-5,nbf:now-5,exp:now+300,
    ...extra
  };
}

test('protected-resource metadata names the canonical resource and the configured external issuer only',()=>{
  const metadata=mcpProtectedResourceMetadata();
  assert.equal(metadata.resource,MCP_RESOURCE);
  assert.deepEqual(metadata.authorization_servers,[GITHUB_OIDC_ISSUER]);
  assert.deepEqual(metadata.scopes_supported,[MCP_SCOPE]);
  assert.equal(JSON.stringify(metadata).includes('authorization_endpoint'),false);
  assert.equal(JSON.stringify(metadata).includes('token_endpoint'),false);
  assert.equal(MCP_ISSUER_ROLE,'external');
  assert.equal(MCP_REGISTERED_REDIRECT_URI,null);
});

test('authorization code and PKCE stay fail-closed unless this system is the issuer and the redirect is registered',()=>{
  assert.deepEqual(decideAuthorizationCode({redirectUri:'https://unregistered.example/callback',codeChallenge:'a'.repeat(43),codeChallengeMethod:'S256'}),{accepted:false,code:'ISSUER_ROLE_EXTERNAL'});
  assert.equal(decideAuthorizationCode({issuerRole:'local',redirectUri:'https://example.test/callback',codeChallenge:'a'.repeat(43),codeChallengeMethod:'S256'}).code,'REGISTERED_REDIRECT_UNCONFIGURED');
  const registered='https://example.test/callback';
  assert.equal(decideAuthorizationCode({issuerRole:'local',registeredRedirectUri:registered,redirectUri:'https://example.test/other',codeChallenge:'a'.repeat(43),codeChallengeMethod:'S256'}).code,'REDIRECT_NOT_REGISTERED');
  assert.equal(decideAuthorizationCode({issuerRole:'local',registeredRedirectUri:registered,redirectUri:registered,codeChallenge:'a'.repeat(43),codeChallengeMethod:'plain'}).code,'PKCE_METHOD_REJECTED');
  assert.equal(decideAuthorizationCode({issuerRole:'local',registeredRedirectUri:registered,redirectUri:registered,codeChallenge:'short',codeChallengeMethod:'S256'}).code,'PKCE_CHALLENGE_REJECTED');
  assert.equal(decideAuthorizationCode({issuerRole:'local',registeredRedirectUri:registered,redirectUri:registered,codeChallenge:'a'.repeat(43),codeChallengeMethod:'S256'}).accepted,true);
});

test('canonical host serves metadata and a 401 resource_metadata challenge, and does not host an authorization server',async()=>{
  const env={NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch(){throw new Error('assets should not serve oauth discovery');}}};
  for(const host of ['numinalabs.xyz','www.numinalabs.xyz',CONTROL_BACKEND_HOST]){
    const metadata=await worker.fetch(new Request('https://'+host+'/.well-known/oauth-protected-resource'),env);
    assert.equal(metadata.status,200,host);
    assert.equal((await metadata.json()).resource,MCP_RESOURCE);
    const pathMetadata=await worker.fetch(new Request('https://'+host+'/.well-known/oauth-protected-resource/api/control/v2/mcp'),env);
    assert.equal(pathMetadata.status,200,host);
    const challenge=await worker.fetch(new Request('https://'+host+'/api/control/v2/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"jsonrpc":"2.0","id":1,"method":"initialize"}'}),env);
    assert.equal(challenge.status,401,host);
    assert.equal(challenge.headers.get('WWW-Authenticate'),'Bearer resource_metadata="'+MCP_RESOURCE_METADATA_URL+'"');
    assert.equal(publicGateBlocks(host,'/api/control/v2/mcp'),false,host);
  }
  for(const host of ['numinalabs.xyz','preview-numina-production.skott34.workers.dev','numina-production-wfz53i3z3a-uc.a.run.app']){
    for(const path of ['/.well-known/oauth-authorization-server','/.well-known/openid-configuration']){
      const response=await worker.fetch(new Request('https://'+host+path),env);
      assert.equal(response.status,403,host+path);
      assert.equal(response.headers.get('WWW-Authenticate'),null);
    }
  }
  const local=await worker.fetch(new Request('http://127.0.0.1/.well-known/oauth-authorization-server'),env);
  assert.equal(local.status,404);
  assert.equal((await local.json()).error,'AUTHORIZATION_SERVER_NOT_HOSTED');
  assert.equal(publicGateBlocks('preview-numina-production.skott34.workers.dev','/.well-known/oauth-protected-resource'),true);
});

test('invalid issuer, audience, expiry and scope are denied; a matching fixture token can initialize and list tools',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk=publicKey.export({format:'jwk'});Object.assign(jwk,{kid:'numina-test',use:'sig',alg:'RS256'});
  const now=Math.floor(Date.now()/1000);
  const DB=database();
  await bootstrapControl(DB,'email:owner@example.test',now);
  const env={DB,NUMINA_CONTROL_OWNER:'email:owner@example.test',NUMINA_TELEMETRY_LOGS:'false'};
  const original=globalThis.fetch;
  let fetches=0;
  globalThis.fetch=async url=>{fetches+=1;assert.equal(String(url),GITHUB_OIDC_JWKS);return Response.json({keys:[jwk]});};
  const post=token=>worker.fetch(new Request('https://numina.test/api/control/v2/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})}),env);
  try{
    for(const extra of [
      {iss:'https://attacker.example'},
      {aud:GITHUB_OIDC_AUDIENCE},
      {exp:now-120},
      {scope:'numina.mcp admin'},
      {scope:undefined}
    ]){
      const before=fetches;
      const response=await post(tokenFor(claimsFor(now,extra),privateKey));
      assert.equal(response.status,401,JSON.stringify(extra));
      assert.match(response.headers.get('WWW-Authenticate'),/error="invalid_token"/);
      assert.equal(fetches,before);
    }
    const sites=await worker.fetch(new Request('https://numina.test/api/control/v2/mcp',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'fixture','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})}),env);
    assert.equal(sites.status,401);
    const missingOwner=await worker.fetch(new Request('https://numina.test/api/control/v2/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokenFor(claimsFor(now),privateKey),'Content-Type':'application/json'},body:'{"jsonrpc":"2.0","id":1,"method":"initialize"}'}),{NUMINA_TELEMETRY_LOGS:'false'});
    assert.equal(missingOwner.status,503);
    const initialized=await post(tokenFor(claimsFor(now),privateKey));
    assert.equal(initialized.status,200);
    assert.equal((await initialized.json()).result.protocolVersion,'2025-11-25');
    const listed=await worker.fetch(new Request('https://numina.test/api/control/v2/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokenFor(claimsFor(now),privateKey),'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})}),env);
    assert.equal(listed.status,200);
    const tools=await listed.json();
    assert.ok(tools.result.tools.some(tool=>tool.name==='numina_policy_decision'));
    assert.ok(fetches>=1&&fetches<=2);
  }finally{
    globalThis.fetch=original;
    DB.close();
  }
});
