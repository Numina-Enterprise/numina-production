// Minimal MCP client over Streamable HTTP (JSON-RPC 2.0): initialize, notifications/initialized,
// tools/list (paginated) and tools/call. Handles JSON and text/event-stream responses and the
// Mcp-Session-Id header. Credentials come from an auth provider; they are never logged.
export const PROTOCOL_VERSION='2025-06-18';
export const CLIENT_INFO={name:'numina-local-treasury-mcp',version:'1.0.0'};
export class McpError extends Error{constructor(m,{code='MCP_ERROR',status,rpc,wwwAuthenticate}={}){super(m);this.name='McpError';this.code=code;this.status=status;this.rpc=rpc;this.wwwAuthenticate=wwwAuthenticate;}}

async function readSse(res,id){
  const reader=res.body.getReader();const dec=new TextDecoder();let buf='';
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(value)buf+=dec.decode(value,{stream:true});
      let i;
      while((i=buf.search(/\r?\n\r?\n/))>=0){
        const raw=buf.slice(0,i);buf=buf.slice(i+(buf[i]==='\r'?4:2));
        const data=raw.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
        if(!data)continue;
        let msg;try{msg=JSON.parse(data);}catch{continue;}
        if(msg.id===id&&('result' in msg||'error' in msg))return msg;
      }
      if(done)break;
    }
  }finally{reader.cancel().catch(()=>{});}
  throw new McpError('event stream ended without a response',{code:'MCP_NO_RESPONSE'});
}

export function createMcpClient({serverUrl,auth,fetchImpl,extraHeaders={},timeoutMs=60000}){
  let sessionId=null,nextId=1,initialized=null,protocolVersion=PROTOCOL_VERSION;
  for(const k of Object.keys(extraHeaders))if(!/^stripe-account$/i.test(k))throw new McpError(`header ${k} is not allowed`,{code:'MCP_HEADER'});
  async function post(body,{retryAuth=true}={}){
    const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',...extraHeaders,...(await auth.headers())};
    if(sessionId)headers['Mcp-Session-Id']=sessionId;
    if(initialized)headers['MCP-Protocol-Version']=protocolVersion;
    const res=await fetchImpl(serverUrl,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
    if(res.status===401){
      const www=res.headers.get('www-authenticate')||'';
      if(retryAuth&&auth.onUnauthorized&&await auth.onUnauthorized(www))return post(body,{retryAuth:false});
      throw new McpError('the MCP server rejected the credentials (401)',{code:'MCP_UNAUTHORIZED',status:401,wwwAuthenticate:www});
    }
    if(res.status===404&&sessionId){sessionId=null;initialized=null;throw new McpError('MCP session expired',{code:'MCP_SESSION_EXPIRED',status:404});}
    const sid=res.headers.get('mcp-session-id');if(sid)sessionId=sid;
    if(!('id' in body)){if(res.status>=400)throw new McpError(`notification rejected (${res.status})`,{status:res.status});return null;}
    if(!res.ok)throw new McpError(`MCP HTTP ${res.status}`,{code:'MCP_HTTP',status:res.status});
    const ct=res.headers.get('content-type')||'';
    const msg=ct.includes('text/event-stream')?await readSse(res,body.id):await res.json();
    if(msg.error)throw new McpError(`MCP error ${msg.error.code}: ${msg.error.message}`,{code:'MCP_RPC',rpc:msg.error});
    return msg.result;
  }
  const rpc=(method,params)=>post({jsonrpc:'2.0',id:nextId++,method,...(params?{params}:{})});
  async function initialize(){
    if(initialized)return initialized;
    const r=await rpc('initialize',{protocolVersion:PROTOCOL_VERSION,capabilities:{},clientInfo:CLIENT_INFO});
    protocolVersion=r.protocolVersion||PROTOCOL_VERSION;initialized=r;
    await post({jsonrpc:'2.0',method:'notifications/initialized'});
    return r;
  }
  return {
    initialize,
    get sessionId(){return sessionId;},
    async listTools(){
      await initialize();const tools=[];let cursor;
      for(let page=0;page<50;page++){const r=await rpc('tools/list',cursor?{cursor}:undefined);tools.push(...(r.tools||[]));if(!r.nextCursor)break;cursor=r.nextCursor;}
      return tools;
    },
    async callTool(name,args){await initialize();return rpc('tools/call',{name,arguments:args});},
    async close(){
      if(!sessionId)return;
      try{await fetchImpl(serverUrl,{method:'DELETE',headers:{'Mcp-Session-Id':sessionId,...(await auth.headers())}});}catch{}
      sessionId=null;initialized=null;
    }
  };
}

// Auth providers. Agent API key: read from the named env var at request time, never stored.
export function apiKeyAuth({env=process.env,envName}){
  return {method:'agent_api_key',async headers(){
    const k=env[envName];
    if(!k)throw new McpError(`environment variable ${envName} is not set`,{code:'MCP_NO_CREDENTIAL'});
    return {Authorization:`Bearer ${k}`};
  }};
}
export function oauthAuth({store,refresh}){
  return {method:'oauth',
    async headers(){const s=store.load();if(!s?.accessToken)throw new McpError(`no OAuth session for ${store.profile}; run: npm run treasury -- login --profile ${store.profile}`,{code:'MCP_NO_CREDENTIAL'});return {Authorization:`Bearer ${s.accessToken}`};},
    async onUnauthorized(){try{await refresh();return true;}catch{return false;}}
  };
}
