import {frontierHttp} from './frontier-http.js';
import {controlActor,controlHttp} from './control-http.js';
import {FRONTIER_VERSION} from './frontier.js';

const SITES_MCP_PROTOCOL_VERSIONS=['2025-03-26','2025-06-18','2025-11-25'];
const SITES_MCP_PUBLIC_NAMES=new Set(['numina_connections','numina_architecture','numina_capabilities','numina_head']);
const SITES_MCP_OWNER_ROUTES={numina_provider_routes:'/api/control/v2/treasury/provider-routes',numina_treasury_evidence:'/api/control/v2/treasury/evidence',numina_owner_state:'/api/control/v1/state'};
const SITES_MCP_TOOLS=[
  ['numina_connections','Discover the canonical Numina surface inventory and connection workspace.'],
  ['numina_architecture','Read the canonical Numina frontier layers.'],
  ['numina_capabilities','Read declared production capabilities and provider availability.'],
  ['numina_head','Read the singular public build projection; no private journal or mutable state.'],
  ['numina_provider_routes','Owner-only read of existing provider-route observations; no funding, settlement or submission.'],
  ['numina_treasury_evidence','Owner-only read of the existing treasury evidence snapshot; declarations retain their recorded scope.'],
  ['numina_owner_state','Owner-only read of the canonical control state through the existing authorized control API.']
].map(([name,description])=>({name,description,inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:name==='numina_provider_routes'||name==='numina_treasury_evidence'}}));
const SITES_MCP_PUBLIC_ERROR_CODES=new Set(['UNAUTHENTICATED','AUTHORITY_DENIED','OWNER_REQUIRED','OWNER_VIEW_REQUIRED','AUTHORITY_CONFIGURATION_MISSING','AUTHORITY_CONFIGURATION_INVALID','ROOT_CONFIGURATION_MISMATCH','ORIGIN_DENIED','RATE_LIMITED','DEPENDENCY_UNAVAILABLE','CONNECTION_MANIFEST_UNAVAILABLE','SIGNING_CONFIGURATION_MISSING','SIGNING_CONFIGURATION_INVALID','SERVICE_UNAVAILABLE','APPLICATION_RELEASE_UNAVAILABLE','APPLICATION_RELEASE_INVALID']);
function sitesMcpResponse(value,status=200,extra={}){return new Response(value===null?null:JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization, Cookie, oai-authenticated-user-id, oai-authenticated-user-email',...extra}});}
function sitesMcpError(id,code,message,status=400,reason=null){return sitesMcpResponse({jsonrpc:'2.0',id,error:{code,message,...(reason?{data:{reason}}:{})}},status,status===405?{Allow:'POST'}:{});}
function sitesMcpFailure(reason,status=400){return Object.assign(new Error(reason),{code:reason,status});}
async function sitesMcpReadJson(req){
  if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||req.headers.has('content-encoding'))throw sitesMcpFailure('JSON_REQUIRED',415);
  const reader=req.body?.getReader();if(!reader)throw sitesMcpFailure('EMPTY_BODY');
  const chunks=[],deadline=Date.now()+5000;let length=0;
  for(;;){
    let timer,part;
    try{part=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(sitesMcpFailure('BODY_TIMEOUT',408)),Math.max(1,deadline-Date.now()));})]);}
    catch(error){reader.cancel().catch(()=>{});throw error;}
    finally{clearTimeout(timer);}
    if(part.done)break;
    length+=part.value.byteLength;if(length>16384){reader.cancel().catch(()=>{});throw sitesMcpFailure('BODY_TOO_LARGE',413);}chunks.push(part.value);
  }
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw sitesMcpFailure('INVALID_JSON');}
}
function sitesMcpInternalRequest(req,path,{method='GET',body=null}={}){
  const url=new URL(path,req.url),headers=new Headers(req.headers);
  headers.delete('content-length');headers.delete('content-encoding');headers.set('MCP-Protocol-Version','2025-11-25');
  if(body!==null)headers.set('Content-Type','application/json');
  return new Request(url,{method,headers,...(body!==null?{body:JSON.stringify(body)}:{})});
}
function sitesMcpSafeReason(value){return SITES_MCP_PUBLIC_ERROR_CODES.has(value)?value:'DEPENDENCY_UNAVAILABLE';}
function sitesMcpOwnerIdentityRequest(req){
  const headers=new Headers(req.headers);
  // Dispatch must validate and replace visitor headers before reaching this
  // Worker. They are the established Sites identity boundary, not proof supplied
  // by a tool argument or bypass token. Prefer that identity to an OAuth bearer
  // that the legacy control API would otherwise mistake for its own credential.
  if(headers.get('oai-authenticated-user-id')?.trim()&&headers.get('oai-authenticated-user-email')?.trim())headers.delete('authorization');
  return new Request(req.url,{method:'GET',headers});
}
function sitesMcpLogDependency(requestId,reason,stage,exception='Error'){
  const types=new Set(['Error','TypeError','ReferenceError','RangeError','URIError','SyntaxError','AggregateError']);
  console.error(JSON.stringify({event:'numina_request_failure',requestId:requestId||null,path:'/mcp',method:'POST',stage,exception:types.has(exception)?exception:'Error',code:sitesMcpSafeReason(reason)}));
}

// Sites performs OAuth and supplies trusted visitor headers at dispatch. This
// adapter creates no issuer, credentials, consent, identities or write authority.
export async function sitesMcpHttp(req,env,{requestId=null}={}){
  if(req.method!=='POST')return sitesMcpError(null,-32000,'Use POST for this stateless MCP endpoint',405,'METHOD_NOT_ALLOWED');
  const url=new URL(req.url);
  if(url.search)return sitesMcpError(null,-32600,'Unexpected endpoint parameters',400,'UNEXPECTED_PARAMETERS');
  if(req.headers.has('origin')&&req.headers.get('origin')!==url.origin)return sitesMcpError(null,-32001,'Origin denied',403,'ORIGIN_DENIED');
  let msg;
  try{msg=await sitesMcpReadJson(req);}catch(error){return sitesMcpError(null,error?.code==='INVALID_JSON'?-32700:-32600,error?.code==='INVALID_JSON'?'Parse error':'Invalid request body',error?.status||400,['JSON_REQUIRED','EMPTY_BODY','BODY_TIMEOUT','BODY_TOO_LARGE','INVALID_JSON'].includes(error?.code)?error.code:'INVALID_REQUEST_BODY');}
  const id=msg?.id??null,hasId=msg&&Object.hasOwn(msg,'id');
  if(!msg||Array.isArray(msg)||typeof msg!=='object'||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||(hasId&&id!==null&&typeof id!=='string'&&!Number.isSafeInteger(id)))return sitesMcpError(null,-32600,'Invalid Request');
  if(!hasId)return sitesMcpResponse(null,202);
  if(msg.params!==undefined&&(!msg.params||Array.isArray(msg.params)||typeof msg.params!=='object'))return sitesMcpError(id,-32602,'Expected object parameters');
  const version=req.headers.get('MCP-Protocol-Version');
  if(version&&!SITES_MCP_PROTOCOL_VERSIONS.includes(version))return sitesMcpError(id,-32602,'Unsupported MCP protocol version',400,'UNSUPPORTED_PROTOCOL_VERSION');
  const result=value=>sitesMcpResponse({jsonrpc:'2.0',id,result:value});
  if(msg.method==='initialize'){
    const requested=msg.params?.protocolVersion;
    if(requested!==undefined&&typeof requested!=='string')return sitesMcpError(id,-32602,'Expected a protocol version string');
    return result({protocolVersion:SITES_MCP_PROTOCOL_VERSIONS.includes(requested)?requested:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'numina',version:FRONTIER_VERSION},instructions:'Public tools are read-only. Owner tools require genuine Sites identity or an existing authorized control credential; service access alone grants no owner identity.'});
  }
  if(msg.method==='ping')return result({});
  if(msg.method==='tools/list'){
    if(msg.params&&Object.keys(msg.params).some(key=>!['_meta'].includes(key)))return sitesMcpError(id,-32602,'This stateless tool list has no cursor');
    return result({tools:SITES_MCP_TOOLS});
  }
  if(msg.method!=='tools/call')return sitesMcpError(id,-32601,'Method not found',400);
  const params=msg.params,name=params?.name,args=params?.arguments===undefined?{}:params.arguments;
  if(!params||Object.keys(params).some(key=>!['name','arguments','_meta'].includes(key))||typeof name!=='string'||(!SITES_MCP_PUBLIC_NAMES.has(name)&&!Object.hasOwn(SITES_MCP_OWNER_ROUTES,name))||!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).length)return sitesMcpError(id,-32602,'Expected a listed read-only tool and empty arguments');
  try{
    let response;
    if(SITES_MCP_PUBLIC_NAMES.has(name)){
      response=await frontierHttp(sitesMcpInternalRequest(req,'/api/control/v2/discovery-mcp',{method:'POST',body:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{}}}}),env);
    }else{
      // A Sites service bypass is intentionally ignored. Browser/platform access
      // is not itself a control actor; callers must pass the existing owner check.
      const identityRequest=sitesMcpOwnerIdentityRequest(req);
      if(!identityRequest.headers.has('authorization')&&(!identityRequest.headers.get('oai-authenticated-user-id')?.trim()||!identityRequest.headers.get('oai-authenticated-user-email')?.trim()))return sitesMcpError(id,-32001,'Authentication required',401,'UNAUTHENTICATED');
      const actor=await controlActor(identityRequest,env);
      if(actor!==env.NUMINA_CONTROL_OWNER)return sitesMcpError(id,-32001,'Owner authority required',403,'OWNER_REQUIRED');
      const path=SITES_MCP_OWNER_ROUTES[name],forward=sitesMcpInternalRequest(identityRequest,path);
      response=await (path.startsWith('/api/control/v2/')?frontierHttp(forward,env):controlHttp(forward,env));
    }
    const payload=await response.json();
    if(!response.ok){const reason=sitesMcpSafeReason(payload?.error);if(response.status>=500)sitesMcpLogDependency(requestId,reason,'mcp_backend_response');return sitesMcpError(id,[401,403].includes(response.status)?-32001:-32000,[401,403].includes(response.status)?'Authorization denied':'Tool dependency unavailable',response.status,reason);}
    if(SITES_MCP_PUBLIC_NAMES.has(name)){
      if(payload.jsonrpc!=='2.0'||payload.id!==id||(!payload.result&&!payload.error)){sitesMcpLogDependency(requestId,'DEPENDENCY_UNAVAILABLE','mcp_discovery_response');return sitesMcpError(id,-32000,'Invalid discovery response',503,'DEPENDENCY_UNAVAILABLE');}
      return sitesMcpResponse(payload);
    }
    return result({content:[{type:'text',text:JSON.stringify(payload)}],isError:false});
  }catch(error){const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:503;if(status>=500)sitesMcpLogDependency(requestId,error?.code,'mcp_backend_dispatch',error?.name);return sitesMcpError(id,[401,403].includes(status)?-32001:-32000,[401,403].includes(status)?'Authorization denied':'Tool dependency unavailable',status,sitesMcpSafeReason(error?.code));}
}
