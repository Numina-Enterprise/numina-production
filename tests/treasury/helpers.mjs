import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {defaultConfig} from '../../local/treasury/config.mjs';
import {startMockServer} from './mock-mcp-server.mjs';

export const repo=fileURLToPath(new URL('../../',import.meta.url));
// Hard network guard for the whole treasury suite: any non-loopback fetch throws and is counted.
export const blockedFetches=[];
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{const u=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)){blockedFetches.push(u.host);throw new Error(`TEST NETWORK GUARD: ${u.host} blocked`);}return realFetch(url,init);};
export const loopbackFetch=globalThis.fetch;

export const SANDBOX_KEY='ek_test_'+randomBytes(16).toString('hex');
export const LIVE_KEY='ek_live_'+randomBytes(16).toString('hex');

export async function setup({sandbox={},live={},authMethod='agent_api_key',signAudit=true,configure}={}){
  const dir=mkdtempSync(path.join(tmpdir(),'numina-treasury-test-'));
  const sbx=await startMockServer({apiKey:SANDBOX_KEY,oauth:authMethod==='oauth',...sandbox});
  const lv=await startMockServer({apiKey:LIVE_KEY,oauth:authMethod==='oauth',...live});
  const config=defaultConfig(path.join(dir,'state'));
  config.profiles.sandbox.serverUrl=sbx.url;config.profiles.live.serverUrl=lv.url;
  for(const p of ['sandbox','live'])config.profiles[p].auth.method=authMethod;
  configure?.(config);
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const env={NUMINA_TREASURY_NETWORK_GUARD:'loopback-only',
    NUMINA_STRIPE_MCP_SANDBOX_AGENT_KEY:SANDBOX_KEY,NUMINA_STRIPE_MCP_LIVE_AGENT_KEY:LIVE_KEY,
    NUMINA_TREASURY_SANDBOX_TOKEN_KEY:randomBytes(32).toString('base64'),NUMINA_TREASURY_LIVE_TOKEN_KEY:randomBytes(32).toString('base64')};
  // Ephemeral in-memory audit key for the test only; never written to disk.
  if(signAudit)env.NUMINA_TREASURY_AUDIT_SIGNING_KEY=privateKey.export({type:'pkcs8',format:'der'}).toString('base64');
  const auditPublicKey=publicKey.export({type:'spki',format:'der'}).toString('base64');
  return {dir,config,env,sbx,lv,auditPublicKey,async teardown(){await sbx.close();await lv.close();rmSync(dir,{recursive:true,force:true});}};
}
