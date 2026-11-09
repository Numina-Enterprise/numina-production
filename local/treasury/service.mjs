// Treasury MCP service: per-profile clients (sandbox and live configured separately), tools/list
// discovery that pins each call to the server's real inputSchema, input validation, the Stripe
// approval guard, informational compliance screening, and an audit entry for every attempt.
import {createMcpClient,apiKeyAuth,oauthAuth,McpError} from './mcp-client.mjs';
import {createTokenStore} from './token-store.mjs';
import {refresh as oauthRefresh} from './oauth.mjs';
import {guardedFetch} from './net-guard.mjs';
import {createAuditLog,argsDigest} from './audit.mjs';
import {createComplianceAdapter} from './compliance-adapter.mjs';
import {assertNoBypassInArgs,detectPendingApproval,STRIPE_APPROVAL_REQUIRED} from './approval-guard.mjs';
import {validateSemantics,validateSchema} from './validate.mjs';
import {PROFILES,validateConfig} from './config.mjs';
import {REGISTRY,toolSpec,isWrite,movesMoney} from './registry.mjs';
import {ADAPTERS} from './adapters/index.mjs';

const summarizeArgs=args=>{
  const picked={};
  const walk=(o,p='')=>{if(!o||typeof o!=='object')return;for(const [k,v] of Object.entries(o)){const q=p?`${p}.${k}`:k;
    if(/amount|currency/i.test(k)&&(typeof v==='number'||typeof v==='string'))picked[q]=v;else if(v&&typeof v==='object')walk(v,q);}};
  walk(args);
  return {keys:Object.keys(args||{}).sort(),digest:argsDigest(args),amounts:picked};
};

export function createTreasuryService({config,repo,env=process.env,fetchImpl=globalThis.fetch,compliance}={}){
  validateConfig(config,{repo});
  const fetchSafe=guardedFetch(env,fetchImpl);
  const stores=Object.fromEntries(PROFILES.map(p=>[p,createTokenStore({file:config.profiles[p].auth.tokenFile,keyEnv:config.profiles[p].auth.tokenKeyEnv,env,profile:p})]));
  const secrets=()=>{
    const out=[];
    for(const p of PROFILES){const a=config.profiles[p].auth;if(env[a.apiKeyEnv])out.push(env[a.apiKeyEnv]);if(env[a.tokenKeyEnv])out.push(env[a.tokenKeyEnv]);
      try{const s=stores[p].exists()&&env[a.tokenKeyEnv]?stores[p].load():null;if(s){out.push(s.accessToken,s.refreshToken);}}catch{}}
    if(env[config.audit.signingKeyEnv])out.push(env[config.audit.signingKeyEnv]);
    return out.filter(Boolean);
  };
  const audit=createAuditLog({file:config.audit.path,env,signingKeyEnv:config.audit.signingKeyEnv,secrets});
  const screen=compliance||createComplianceAdapter({repo});
  const clients={},discovered={};

  function client(profile){
    if(clients[profile])return clients[profile];
    const p=config.profiles[profile];
    const auth=p.auth.method==='agent_api_key'?apiKeyAuth({env,envName:p.auth.apiKeyEnv}):oauthAuth({store:stores[profile],refresh:()=>oauthRefresh({store:stores[profile],fetchImpl:fetchSafe})});
    return clients[profile]=createMcpClient({serverUrl:p.serverUrl,auth,fetchImpl:fetchSafe,extraHeaders:p.stripeAccountHeader?{'Stripe-Account':p.stripeAccountHeader}:{}});
  }
  const resolveProfile=p=>{const name=p||config.defaultProfile;if(!PROFILES.includes(name))throw Object.assign(new Error('profile must be sandbox or live'),{code:'INVALID_PROFILE'});return name;};

  async function discover(profileName){
    const profile=resolveProfile(profileName);
    try{
      const tools=await client(profile).listTools();
      const byName=new Map(tools.map(t=>[t.name,t]));
      discovered[profile]={at:new Date().toISOString(),byName};
      const report={profile,at:discovered[profile].at,serverToolCount:tools.length,
        available:REGISTRY.tools.filter(t=>byName.has(t.name)).map(t=>t.name),
        missingFromServer:REGISTRY.tools.filter(t=>!byName.has(t.name)).map(t=>t.name),
        unregistered:tools.filter(t=>!REGISTRY.tools.some(r=>r.name===t.name)).map(t=>t.name),
        schemas:Object.fromEntries(tools.map(t=>[t.name,t.inputSchema||null]))};
      audit.append({type:'discovery',profile,status:'ok',serverToolCount:tools.length,missingFromServer:report.missingFromServer,unregistered:report.unregistered});
      return report;
    }catch(e){audit.append({type:'discovery',profile,status:'error',error:e.code||e.name,message:String(e.message)});throw e;}
  }

  async function call(tool,args={},{profile:profileName,actor='local-admin'}={}){
    const started=Date.now();let profile=null;
    const base={type:'tool_call',tool,actor,stripeApproval:STRIPE_APPROVAL_REQUIRED};
    const finish=(status,extra={})=>{const entry=audit.append({...base,profile,status,durationMs:Date.now()-started,...extra});return {status,auditSeq:entry.seq,auditHash:entry.hash,...extra};};
    let spec,summary;
    try{
      profile=resolveProfile(profileName);
      spec=toolSpec(tool);
      base.access=isWrite(spec)?'write':'read';base.movesMoney=movesMoney(spec);base.stripeHumanConfirmation=spec.stripeHumanConfirmation;
      summary=summarizeArgs(args);base.args=summary;
      if(!config.profiles[profile].tools[tool]?.enabled)return finish('blocked',{reason:'TOOL_DISABLED_IN_PROFILE'});
      if(!discovered[profile])await discover(profile);
      const live=discovered[profile].byName.get(tool);
      if(!live)return finish('blocked',{reason:'TOOL_NOT_ON_SERVER'});
      assertNoBypassInArgs(args,live.inputSchema);
      validateSemantics(args);
      ADAPTERS[tool].check(args);
      validateSchema(live.inputSchema||{type:'object'},args);
      const compliance=await screen({tool,profile,access:base.access,movesMoney:base.movesMoney,args});
      base.compliance=compliance;
      const result=await client(profile).callTool(tool,args);
      const pending=detectPendingApproval(result);
      if(pending.pending)return {...finish('pending_stripe_approval',{approvalUrl:pending.approvalUrl}),result};
      return {...finish(result?.isError?'tool_error':'ok'),result};
    }catch(e){
      const reason=e.code||e.name||'ERROR';
      const blocked=['INVALID_INPUT','APPROVAL_BYPASS_REJECTED','UNKNOWN_TOOL','INVALID_PROFILE','NETWORK_GUARD','MCP_NO_CREDENTIAL','MCP_HEADER'].includes(reason);
      return finish(blocked?'blocked':'error',{reason,message:String(e.message).slice(0,300)});
    }
  }
  return {config,audit,discover,call,stores,profiles:PROFILES,close:async()=>{for(const c of Object.values(clients))await c.close();}};
}
