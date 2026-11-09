// Local treasury MCP config: two separately configured profiles (sandbox, live). Holds env var
// NAMES and file paths only, never secret values. Stripe's live approval is always "required".
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {REGISTRY} from './registry.mjs';
import {assertApprovalConfig,STRIPE_APPROVAL_REQUIRED} from './approval-guard.mjs';
import {isSecretKeyName,redactString} from './redact.mjs';

export const CONFIG_SCHEMA='numina.local-treasury-mcp.config.v1';
export const PROFILES=['sandbox','live'];
export const DEFAULT_STATE_DIR=path.join(os.homedir(),'.numina','treasury-mcp');
export class ConfigError extends Error{constructor(m){super(m);this.name='ConfigError';this.code='INVALID_CONFIG';}}

const profileDefaults=(mode,stateDir)=>({
  mode,
  serverUrl:REGISTRY.server,
  auth:{
    method:'oauth',
    apiKeyEnv:`NUMINA_STRIPE_MCP_${mode.toUpperCase()}_AGENT_KEY`,
    tokenFile:path.join(stateDir,`${mode}.oauth-session.enc`),
    tokenKeyEnv:`NUMINA_TREASURY_${mode.toUpperCase()}_TOKEN_KEY`,
    oauthClientName:`Numina local admin (${mode})`
  },
  stripeAccountHeader:null,
  tools:Object.fromEntries(REGISTRY.tools.map(t=>[t.name,{enabled:true}]))
});
export function defaultConfig(stateDir=DEFAULT_STATE_DIR){
  return {
    schema:CONFIG_SCHEMA,
    defaultProfile:'sandbox',
    stripeLiveApproval:STRIPE_APPROVAL_REQUIRED,
    profiles:{sandbox:profileDefaults('sandbox',stateDir),live:profileDefaults('live',stateDir)},
    audit:{path:path.join(stateDir,'audit.jsonl'),signingKeyEnv:'NUMINA_TREASURY_AUDIT_SIGNING_KEY'},
    compliance:{mode:'informational'}
  };
}
const ENV_NAME=/^[A-Z][A-Z0-9_]{2,63}$/;
const isLoopbackUrl=u=>['127.0.0.1','localhost','[::1]'].includes(u.hostname);

export function validateConfig(cfg,{repo}={}){
  if(!cfg||typeof cfg!=='object')throw new ConfigError('config must be an object');
  assertApprovalConfig(cfg);
  if(cfg.stripeLiveApproval!==STRIPE_APPROVAL_REQUIRED)throw new ConfigError('stripeLiveApproval must be "required"');
  if(cfg.schema!==CONFIG_SCHEMA)throw new ConfigError(`schema must be ${CONFIG_SCHEMA}`);
  if(!PROFILES.includes(cfg.defaultProfile))throw new ConfigError('defaultProfile must be sandbox or live');
  noSecretValues(cfg,'config');
  const keys=Object.keys(cfg.profiles||{});
  if(keys.sort().join()!==[...PROFILES].sort().join())throw new ConfigError('profiles must be exactly sandbox and live');
  const seen={env:new Set(),file:new Set()};
  for(const name of PROFILES){
    const p=cfg.profiles[name];
    if(p.mode!==name)throw new ConfigError(`profiles.${name}.mode must be "${name}"`);
    let u;try{u=new URL(p.serverUrl);}catch{throw new ConfigError(`profiles.${name}.serverUrl is not a URL`);}
    if(u.protocol!=='https:'&&!(u.protocol==='http:'&&isLoopbackUrl(u)))throw new ConfigError(`profiles.${name}.serverUrl must be https (plain http only for a loopback mock)`);
    const a=p.auth||{};
    if(!['oauth','agent_api_key'].includes(a.method))throw new ConfigError(`profiles.${name}.auth.method must be oauth or agent_api_key`);
    for(const k of ['apiKeyEnv','tokenKeyEnv']){
      if(!ENV_NAME.test(a[k]||''))throw new ConfigError(`profiles.${name}.auth.${k} must be an environment variable NAME`);
      if(seen.env.has(a[k]))throw new ConfigError(`profiles.${name}.auth.${k}: sandbox and live must use different environment variables`);
      seen.env.add(a[k]);
    }
    if(!a.tokenFile||!path.isAbsolute(a.tokenFile))throw new ConfigError(`profiles.${name}.auth.tokenFile must be an absolute path`);
    if(repo&&!path.relative(path.resolve(repo),path.resolve(a.tokenFile)).startsWith('..'))throw new ConfigError(`profiles.${name}.auth.tokenFile must be outside the repository`);
    if(seen.file.has(a.tokenFile))throw new ConfigError('sandbox and live must use different token files');
    seen.file.add(a.tokenFile);
    if(p.stripeAccountHeader!=null&&!/^acct_[A-Za-z0-9]{6,}$/.test(p.stripeAccountHeader))throw new ConfigError(`profiles.${name}.stripeAccountHeader must be an acct_ id or null`);
    for(const [tool,t] of Object.entries(p.tools||{})){
      if(!REGISTRY.tools.some(r=>r.name===tool))throw new ConfigError(`profiles.${name}.tools.${tool} is not in the registry`);
      const extra=Object.keys(t).filter(k=>k!=='enabled');
      if(typeof t.enabled!=='boolean'||extra.length)throw new ConfigError(`profiles.${name}.tools.${tool} must be {"enabled":true|false}`);
    }
  }
  if(!cfg.audit?.path||!path.isAbsolute(cfg.audit.path))throw new ConfigError('audit.path must be absolute');
  if(repo&&!path.relative(path.resolve(repo),path.resolve(cfg.audit.path)).startsWith('..'))throw new ConfigError('audit.path must be outside the repository');
  if(!ENV_NAME.test(cfg.audit.signingKeyEnv||''))throw new ConfigError('audit.signingKeyEnv must be an environment variable NAME');
  if(cfg.compliance?.mode!=='informational')throw new ConfigError('compliance.mode is "informational": screening is recorded in the audit log and does not block calls');
  return cfg;
}
function noSecretValues(obj,p){
  for(const [k,v] of Object.entries(obj||{})){
    const here=`${p}.${k}`;
    if(isSecretKeyName(k)&&!/Env$|File$/.test(k))throw new ConfigError(`${here}: secret values are never stored in config (name an environment variable instead)`);
    if(typeof v==='string'&&redactString(v)!==v)throw new ConfigError(`${here}: looks like a secret value`);
    if(v&&typeof v==='object')noSecretValues(v,here);
  }
}
export function mergeDefaults(cfg,stateDir){
  const d=defaultConfig(stateDir);
  const out={...d,...cfg,profiles:{}};
  for(const n of PROFILES){const p=cfg?.profiles?.[n]||{};out.profiles[n]={...d.profiles[n],...p,auth:{...d.profiles[n].auth,...p.auth},tools:{...d.profiles[n].tools,...p.tools}};}
  out.audit={...d.audit,...cfg?.audit};
  return out;
}
export function loadConfig({file,stateDir=DEFAULT_STATE_DIR,repo}={}){
  const raw=file&&existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
  return validateConfig(mergeDefaults(raw,stateDir),{repo});
}
export function saveConfig(file,cfg,{repo}={}){
  validateConfig(cfg,{repo});
  mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(cfg,null,2)+'\n',{mode:0o600});renameSync(tmp,file);
  return cfg;
}
