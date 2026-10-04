import {NUMINA_LEGAL_DISCOVERY} from '../public/legal-discovery.js';
// The hosted plugin exposes only Numina's public, read-only discovery profile.
// Private control and treasury routes retain their existing authorization.
const NUMINA_PANEL_URI='ui://numina/public-workspace/v1.html';
const NUMINA_PANEL_HTML=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Numina workspace</title><style>:root{color-scheme:light dark}body{font:16px system-ui,sans-serif;margin:0;padding:24px;max-width:760px}h1{font-size:28px;margin-top:0}p{line-height:1.6}nav{display:grid;gap:12px}a{display:block;padding:16px;border:1px solid #8886;border-radius:12px;color:inherit;text-decoration:none}a:hover,a:focus-visible{background:#8882}small{display:block;margin-top:6px;opacity:.75}</style></head><body><h1>Numina workspace</h1><p>Digital asset infrastructure. Open a public workspace to explore Numina and its current release.</p><nav aria-label="Numina public workspaces"><a href="https://numinalabs.xyz/connections" target="_blank" rel="noopener noreferrer">Connections<small>Software surfaces and integration inventory</small></a><a href="https://numinalabs.xyz/frontier" target="_blank" rel="noopener noreferrer">Frontier<small>Architecture and capabilities</small></a><a href="https://numinalabs.xyz/downloads/application-release-v4.json" target="_blank" rel="noopener noreferrer">Current release<small>Published version and build identity</small></a><a href="https://numinalabs.xyz/downloads/Numina-DevDay-2026-Adoption.json" target="_blank" rel="noopener noreferrer">Feature adoption<small>Implemented features and remaining gates</small></a><a href="https://numinalabs.xyz/compliance" target="_blank" rel="noopener noreferrer">Legal coverage<small>Terms, privacy, licenses and country review gates</small></a></nav></body></html>`;
const NUMINA_PANEL_META={ui:{resourceUri:NUMINA_PANEL_URI},'openai/ui':{entrypoints:[{type:'global'},{type:'thread'}]}};
const NUMINA_PANEL_TOOL={name:'numina_open_panel',title:'Numina workspace',description:'Open the public Numina workspace panel with connections, architecture, release identity and feature adoption links.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:NUMINA_PANEL_META};
export async function sitesMcpHttp(req,env,discoveryHttp){
  const target=new URL(req.url);
  if(target.pathname!=='/mcp')return null;
  if(req.method!=='POST')return new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers:{Allow:'POST','Content-Type':'application/json','Cache-Control':'no-store'}});
  target.pathname='/api/control/v2/discovery-mcp';
  // Delegate first: the existing parser, origin, version and rate controls
  // must accept the request before any extension resource is returned.
  const copy=req.clone();
  const response=await discoveryHttp(new Request(target,req),env);
  if(response.status!==200)return response;
  if(req.headers.has('MCP-Protocol-Version')&&req.headers.get('MCP-Protocol-Version')!=='2025-11-25')return response;
  const payload=await response.clone().json();
  if(payload.error&&![ -32601,-32602 ].includes(payload.error.code))return response;
  const msg=await copy.json();
  if(!Object.hasOwn(msg,'id'))return response;
  const result=value=>new Response(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:value}),{status:200,headers:response.headers});
  const invalid=()=>new Response(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32602,message:'Expected the listed public resource or empty panel arguments'}}),{status:200,headers:response.headers});
  if(msg.method==='initialize'&&payload.result){payload.result.capabilities.resources={subscribe:false,listChanged:false};return result(payload.result);}
  if(msg.method==='tools/list'&&payload.result)return result({tools:[...payload.result.tools,NUMINA_PANEL_TOOL]});
  if(msg.method==='resources/list'&&payload.error?.code===-32601)return result({resources:[{uri:NUMINA_PANEL_URI,name:'Numina workspace',mimeType:'text/html;profile=mcp-app'}]});
  if(msg.method==='resources/read'&&payload.error?.code===-32601){
    if(msg.params?.uri!==NUMINA_PANEL_URI||Object.keys(msg.params).some(key=>key!=='uri'))return invalid();
    return result({contents:[{uri:NUMINA_PANEL_URI,mimeType:'text/html;profile=mcp-app',text:NUMINA_PANEL_HTML,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}}}}]});
  }
  if(msg.method==='tools/call'&&msg.params?.name==='numina_open_panel'&&payload.error?.code===-32602){
    const args=msg.params.arguments;
    if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length||Object.keys(msg.params).some(key=>!['name','arguments'].includes(key)))return invalid();
    return result({content:[{type:'text',text:'Numina public workspace: https://numinalabs.xyz/connections'}],structuredContent:{identity:'NUMINA',scope:'public_workspace_directory',legal:NUMINA_LEGAL_DISCOVERY,externalExecution:false},_meta:NUMINA_PANEL_META,isError:false});
  }
  return response;
}
