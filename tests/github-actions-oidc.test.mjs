import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyGithubActionsOidc,GITHUB_OIDC_AUDIENCE,GITHUB_OIDC_ISSUER} from '../src/control-http.js';

const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function tokenFor(claims,privateKey,kid='numina-test'){
  const header=enc({alg:'RS256',kid,typ:'JWT'}),payload=enc(claims),input=header+'.'+payload;
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
}
test('GitHub OIDC binds the singular production treasury workflow to Numina repository identity',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk=publicKey.export({format:'jwk'});Object.assign(jwk,{kid:'numina-test',use:'sig',alg:'RS256'});
  const now=Math.floor(Date.now()/1000);
  const claims={
    iss:GITHUB_OIDC_ISSUER,aud:GITHUB_OIDC_AUDIENCE,
    sub:'repo:skott34-dot@269050000/numina-production@1367647143:environment:production',
    repository:'skott34-dot/numina-production',repository_id:'1367647143',
    repository_owner:'skott34-dot',repository_owner_id:'269050000',
    ref:'refs/heads/main',environment:'production',event_name:'workflow_dispatch',
    workflow_ref:'skott34-dot/numina-production/.github/workflows/settle-numina-aggregate-model.yml@refs/heads/main',
    runner_environment:'github-hosted',iat:now-5,nbf:now-5,exp:now+300
  };
  assert.equal(await verifyGithubActionsOidc(tokenFor(claims,privateKey),{now,keys:[jwk]}),true);
  assert.equal(await verifyGithubActionsOidc(tokenFor({...claims,repository_id:'1'},privateKey),{now,keys:[jwk]}),false);
  assert.equal(await verifyGithubActionsOidc(tokenFor({...claims,environment:'preview'},privateKey),{now,keys:[jwk]}),false);
});
