import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {defaultConfig} from '../../local/treasury/config.mjs';
import {startMockServer} from './mock-mcp-server.mjs';
import {login} from '../../local/treasury/oauth.mjs';
import {createTokenStore} from '../../local/treasury/token-store.mjs';
import {guardedFetch} from '../../local/treasury/net-guard.mjs';

export const repo=fileURLToPath(new URL('../../',import.meta.url));
// Hard network guard for the whole treasury suite: any non-loopback fetch throws and is counted.
export const blockedFetches=[];
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{const u=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)){blockedFetches.push(u.host);throw new Error(`TEST NETWORK GUARD: ${u.host} blocked`);}return realFetch(url,init);};
export const loopbackFetch=globalThis.fetch;

const browser=async u=>{const r=await fetch(u,{redirect:'manual'});if(r.status!==302)throw new Error('expected redirect');const cb=new URL(r.headers.get('location'));await (await fetch(cb)).text();};

/** Default auth is OAuth 2.1. setup() logs in sandbox+live against the mock AS unless loginProfiles is []. */
export async function setup({sandbox={},live={},signAudit=true,configure,loginProfiles=['sandbox','live']}={}){
  const dir=mkdtempSync(path.join(tmpdir(),'numina-treasury-test-'));
  const sbx=await startMockServer({oauth:true,...sandbox});
  const lv=await startMockServer({oauth:true,...live});
  const config=defaultConfig(path.join(dir,'state'));
  config.profiles.sandbox.serverUrl=sbx.url;config.profiles.live.serverUrl=lv.url;
  for(const p of ['sandbox','live'])config.profiles[p].auth.method='oauth';
  configure?.(config);
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const env={NUMINA_TREASURY_NETWORK_GUARD:'loopback-only',
    NUMINA_TREASURY_SANDBOX_TOKEN_KEY:randomBytes(32).toString('base64'),NUMINA_TREASURY_LIVE_TOKEN_KEY:randomBytes(32).toString('base64')};
  if(signAudit)env.NUMINA_TREASURY_AUDIT_SIGNING_KEY=privateKey.export({type:'pkcs8',format:'der'}).toString('base64');
  const auditPublicKey=publicKey.export({type:'spki',format:'der'}).toString('base64');
  const servers={sandbox:sbx,live:lv};
  for(const profile of loginProfiles){
    const p=config.profiles[profile];
    const store=createTokenStore({file:p.auth.tokenFile,keyEnv:p.auth.tokenKeyEnv,env,profile});
    await login({serverUrl:p.serverUrl,store,fetchImpl:guardedFetch(env,fetch),openUrl:browser,clientName:p.auth.oauthClientName,oauth21:true});
  }
  return {dir,config,env,sbx,lv,auditPublicKey,servers,async teardown(){await sbx.close();await lv.close();rmSync(dir,{recursive:true,force:true});}};
}
