// Mounted by src/local/local-admin.mjs at /admin/treasury/* (local console only; never imported
// by src/worker.js or scripts/build.mjs). Reads are open on the loopback console; every write
// (config change, discovery, tool call, session revoke) needs the NUMINA_LOCAL_ADMIN_TOKEN bearer.
// Requests whose Host is not loopback are refused even if the console was started with --allow-lan.
import path from 'node:path';
import {loadConfig,saveConfig,DEFAULT_STATE_DIR,ConfigError,mergeDefaults,PROFILES} from './config.mjs';
import {createTreasuryService} from './service.mjs';
import {listSessions,revokeLocal,STRIPE_REVOKE_RUNBOOK} from './sessions.mjs';
import {verifyAuditLog,readAudit} from './audit.mjs';
import {REGISTRY} from './registry.mjs';
import {ADAPTERS} from './adapters/index.mjs';

const json=(b,s=200)=>new Response(JSON.stringify(b,null,2),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const LOOPBACK_HOST=/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export function adapterTable(config){
  return REGISTRY.tools.map(t=>({tool:t.name,group:t.group,status:t.status,access:t.access,movesMoney:t.movesMoney,
    stripeHumanConfirmation:t.stripeHumanConfirmation,permissions:t.permissions,adapter:`local/treasury/adapters/${t.name}.mjs`,implemented:!!ADAPTERS[t.name],
    sandbox:config.profiles.sandbox.tools[t.name]?.enabled?'enabled':'disabled',live:config.profiles.live.tools[t.name]?.enabled?'enabled':'disabled',
    stripeLiveApproval:'required (cannot be turned off)',source:t.source}));
}

export function createTreasuryRoutes({env=process.env,fetchImpl=globalThis.fetch,stateDir,compliance}={}){
  let service=null,serviceKey=null;
  const configFile=dataDir=>path.join(dataDir,'treasury-mcp-config.json');
  const sd=()=>stateDir||env.NUMINA_TREASURY_STATE_DIR||DEFAULT_STATE_DIR;
  const getService=(cfg,repo)=>{const k=JSON.stringify(cfg);if(!service||serviceKey!==k){service=createTreasuryService({config:cfg,repo,env,fetchImpl,compliance});serviceKey=k;}return service;};
  return async function handle(req,{repo,dataDir,authorized}){
    const url=new URL(req.url);const p=url.pathname.replace(/\/+$/,'')||'/';const m=req.method;
    if(!p.startsWith('/admin/treasury'))return null;
    if(!LOOPBACK_HOST.test(req.headers.get('host')||url.host))return json({error:'LOOPBACK_ONLY',message:'The treasury console only answers on 127.0.0.1.'},403);
    const needWrite=()=>authorized()?null:json({error:'UNAUTHORIZED',message:'Send Authorization: Bearer <NUMINA_LOCAL_ADMIN_TOKEN>.'},401);
    let cfg;
    try{cfg=loadConfig({file:configFile(dataDir),stateDir:sd(),repo});}catch(e){if(!(e instanceof ConfigError)&&e.code!=='APPROVAL_BYPASS_REJECTED')throw e;return json({error:e.code,message:e.message},500);}
    try{
      if(p==='/admin/treasury'&&m==='GET')return new Response(page(cfg),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      if(p==='/admin/treasury/status'&&m==='GET')return json({module:'numina-local-treasury-mcp',server:REGISTRY.server,defaultProfile:cfg.defaultProfile,stripeLiveApproval:cfg.stripeLiveApproval,
        profiles:Object.fromEntries(PROFILES.map(n=>[n,{serverUrl:cfg.profiles[n].serverUrl,authMethod:cfg.profiles[n].auth.method,apiKeyEnv:cfg.profiles[n].auth.apiKeyEnv,apiKeyEnvSet:!!env[cfg.profiles[n].auth.apiKeyEnv]}])),
        compliance:'informational (recorded in audit, never blocks)',notices:REGISTRY.notices||[],adapters:adapterTable(cfg)});
      if(p==='/admin/treasury/tools'&&m==='GET')return json({adapters:adapterTable(cfg)});
      if(p==='/admin/treasury/config'&&m==='GET')return json(cfg);
      if(p==='/admin/treasury/config'&&m==='PUT'){const d=needWrite();if(d)return d;
        let body;try{body=await req.json();}catch{return json({error:'BAD_JSON'},400);}
        try{return json(saveConfig(configFile(dataDir),mergeDefaults(body,sd()),{repo}));}catch(e){return json({error:e.code||'INVALID_CONFIG',message:e.message},400);}}
      if(p==='/admin/treasury/sessions'&&m==='GET')return json({sessions:listSessions(cfg,env),runbook:STRIPE_REVOKE_RUNBOOK});
      if(p==='/admin/treasury/sessions/runbook'&&m==='GET')return json(STRIPE_REVOKE_RUNBOOK);
      const rev=p.match(/^\/admin\/treasury\/sessions\/(sandbox|live)$/);
      if(rev&&m==='DELETE'){const d=needWrite();if(d)return d;const r=revokeLocal(cfg,rev[1],env);getService(cfg,repo).audit.append({type:'session_revoke_local',profile:rev[1],deleted:r.deleted});return json(r);}
      if(p==='/admin/treasury/audit'&&m==='GET')return json({file:cfg.audit.path,entries:readAudit(cfg.audit.path,{limit:Math.min(Number(url.searchParams.get('limit'))||100,1000)})});
      if(p==='/admin/treasury/audit/verify'&&m==='GET'){const svc=getService(cfg,repo);return json({...verifyAuditLog(cfg.audit.path,{publicKey:svc.audit.publicKey||undefined}),signed:svc.audit.signed,keyId:svc.audit.keyId});}
      if(p==='/admin/treasury/discover'&&m==='POST'){const d=needWrite();if(d)return d;
        try{return json(await getService(cfg,repo).discover(url.searchParams.get('profile')||undefined));}catch(e){return json({error:e.code||'ERROR',message:e.message},502);}}
      const call=p.match(/^\/admin\/treasury\/call\/([a-z0-9_]+)$/);
      if(call&&m==='POST'){const d=needWrite();if(d)return d;
        let body;try{body=await req.json();}catch{return json({error:'BAD_JSON'},400);}
        const r=await getService(cfg,repo).call(call[1],body.args||{},{profile:body.profile});
        return json(r,r.status==='blocked'?403:r.status==='error'?502:200);}
      return json({error:'NOT_FOUND'},404);
    }catch(e){return json({error:e.code||'ERROR',message:String(e.message)},500);}
  };
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
function page(cfg){
  const rows=adapterTable(cfg).map(a=>`<tr><td><code>${esc(a.tool)}</code></td><td>${esc(a.group)}</td><td>${esc(a.access)}</td><td>${a.movesMoney===true?'yes':'no'}</td><td>${esc(a.sandbox)}</td><td>${esc(a.live)}</td><td>${esc(a.status)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>numina-local-admin · treasury MCP</title><body style="font:14px system-ui;margin:2rem">
<h1>Stripe Treasury MCP (local only)</h1><p>Default profile: <b>${esc(cfg.defaultProfile)}</b>. Stripe live money-movement approval: <b>required</b> (cannot be turned off).
Compliance screening: informational. JSON: <a href="/admin/treasury/status">status</a> · <a href="/admin/treasury/sessions">sessions</a> · <a href="/admin/treasury/audit/verify">audit verify</a></p>
<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Tool</th><th>Group</th><th>Access</th><th>Moves money</th><th>Sandbox</th><th>Live</th><th>Stripe status</th></tr>${rows}</table>
<p>Calls: POST /admin/treasury/call/&lt;tool&gt; {"profile":"sandbox","args":{...}} with the admin bearer token. Agent API keys must be agent-tagged by 2026-11-30.</p></body>`;
}
const defaultHandler=createTreasuryRoutes();
export function handle(req,ctx){return defaultHandler(req,ctx);}
