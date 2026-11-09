#!/usr/bin/env node
// Local CLI for the treasury MCP module. Network commands (login, discover, call) contact the
// configured MCP server; everything else is local. Secrets are read from env vars only.
//   node local/treasury/cli.mjs status|tools|sessions|runbook|audit [--verify]
//   node local/treasury/cli.mjs revoke --profile sandbox|live
//   node local/treasury/cli.mjs login --profile sandbox|live
//   node local/treasury/cli.mjs discover [--profile sandbox|live]
//   node local/treasury/cli.mjs call <tool> [--profile sandbox|live] --args '{"...":...}'
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig,DEFAULT_STATE_DIR} from './config.mjs';
import {createTreasuryService} from './service.mjs';
import {listSessions,revokeLocal,STRIPE_REVOKE_RUNBOOK} from './sessions.mjs';
import {verifyAuditLog,readAudit} from './audit.mjs';
import {login} from './oauth.mjs';
import {createTokenStore} from './token-store.mjs';
import {guardedFetch} from './net-guard.mjs';
import {adapterTable} from './routes.mjs';
import {redact} from './redact.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const argv=process.argv.slice(2);const cmd=argv[0];
const opt=n=>{const i=argv.indexOf('--'+n);return i>=0?argv[i+1]:undefined;};
const dataDir=process.env.NUMINA_LOCAL_ADMIN_DATA_DIR||path.join(repo,'local-data');
const cfg=loadConfig({file:path.join(dataDir,'treasury-mcp-config.json'),stateDir:process.env.NUMINA_TREASURY_STATE_DIR||DEFAULT_STATE_DIR,repo});
const out=v=>console.log(JSON.stringify(redact(v),null,2));
try{
  switch(cmd){
    case 'status':case 'tools':out({defaultProfile:cfg.defaultProfile,stripeLiveApproval:cfg.stripeLiveApproval,adapters:adapterTable(cfg)});break;
    case 'sessions':out(listSessions(cfg));break;
    case 'runbook':out(STRIPE_REVOKE_RUNBOOK);break;
    case 'revoke':out(revokeLocal(cfg,opt('profile')));break;
    case 'audit':out(argv.includes('--verify')?verifyAuditLog(cfg.audit.path):readAudit(cfg.audit.path,{limit:Number(opt('limit'))||50}));break;
    case 'login':{
      const profile=opt('profile')||cfg.defaultProfile;const p=cfg.profiles[profile];
      if(!p)throw new Error('profile must be sandbox or live');
      const store=createTokenStore({file:p.auth.tokenFile,keyEnv:p.auth.tokenKeyEnv,profile});
      const r=await login({serverUrl:p.serverUrl,store,fetchImpl:guardedFetch(),clientName:p.auth.oauthClientName,openUrl:u=>console.log(`Open this URL in your browser to approve ${profile} access:\n${u}`)});
      out({loggedIn:true,...r});break;}
    case 'discover':{const s=createTreasuryService({config:cfg,repo});out(await s.discover(opt('profile')));await s.close();break;}
    case 'call':{const s=createTreasuryService({config:cfg,repo});const r=await s.call(argv[1],JSON.parse(opt('args')||'{}'),{profile:opt('profile'),actor:'cli'});out(r);await s.close();process.exitCode=r.status==='ok'||r.status==='pending_stripe_approval'?0:2;break;}
    default:console.log('usage: status | tools | sessions | runbook | revoke --profile P | audit [--verify] | login --profile P | discover [--profile P] | call <tool> [--profile P] --args JSON');process.exitCode=cmd?1:0;
  }
}catch(e){console.error(`error: ${redact(String(e.message))}`);process.exitCode=1;}
