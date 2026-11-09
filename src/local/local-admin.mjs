// numina-local-admin: LOCAL-ONLY management console and private-route host.
// Never imported by scripts/build.mjs or the Cloudflare Worker bundle (see tests/local-admin.test.mjs).
// - Serves the private Worker handlers (MCP, discovery, /api/control, treasury, financial, NUSD,
//   ops, app, reviewer) by dispatching to src/worker.js under a local hostname, so the public-host
//   gate does not apply.
// - Serves /downloads/* from the non-published folders (local-data/private-downloads first, then
//   dist/private-downloads/downloads from the last build).
// - /admin: inspect the private MCP connection config, view/edit the local treasury API route
//   config file (config only: no signing, no keys, no provider or financial calls), and browse,
//   add and remove files in local-data/private-downloads.
// Write actions require NUMINA_LOCAL_ADMIN_TOKEN (set locally; never committed).
import {readFileSync,writeFileSync,existsSync,statSync,readdirSync,mkdirSync,unlinkSync,renameSync} from 'node:fs';
import {timingSafeEqual,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import worker from '../worker.js';

export const LOCAL_ADMIN_MARKER='numina-local-admin';
const REPO=fileURLToPath(new URL('../../',import.meta.url));
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.md':'text/markdown; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.zip':'application/zip','.pem':'application/x-pem-file'};
const SECRET_KEY=/(secret|token|password|passphrase|private|api[_-]?key|authorization|cookie|credential|jwk|seed)/i;
const SECRET_VALUE=/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk_(live|test)_[A-Za-z0-9]+|\brk_(live|test)_[A-Za-z0-9]+|\bghp_[A-Za-z0-9]{20,}/;
const FILE_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_UPLOAD=50*1024*1024;

export const DEFAULT_TREASURY_ROUTE_CONFIG=Object.freeze({
  schema:'numina.local.treasury-route-config.v1',
  note:'Local configuration file only. The console never signs, never stores keys and never calls a provider or financial API. The deployed Worker does not read this file.',
  ownerTreasuryLookup:{url:'https://personal-space-m7q9.skott34.chatgpt.site/api/control/v1/treasury',method:'GET',timeoutMs:8000,enabled:false},
  providerRoutesFile:'config/stripe-provider-routes.json'
});

const json=(body,status=200,extra={})=>new Response(JSON.stringify(body,null,2),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Robots-Tag':'noindex',...extra}});
const sha=b=>createHash('sha256').update(b).digest('hex');

export function validateRouteConfig(config){
  if(!config||typeof config!=='object'||Array.isArray(config))throw Object.assign(Error('Config must be a JSON object'),{status:400});
  const walk=(v,p)=>{if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){if(SECRET_KEY.test(k))throw Object.assign(Error('Secrets are not allowed in the route config (field '+p+k+')'),{status:400});walk(x,p+k+'.');}}else if(typeof v==='string'&&SECRET_VALUE.test(v))throw Object.assign(Error('Secret-looking value rejected at '+p.slice(0,-1)),{status:400});};
  walk(config,'');
  const url=config.ownerTreasuryLookup?.url;if(url!==undefined&&!/^https:\/\/[^\s/]+\//.test(url))throw Object.assign(Error('ownerTreasuryLookup.url must be an https URL'),{status:400});
  if(JSON.stringify(config).length>64*1024)throw Object.assign(Error('Config too large'),{status:400});
  return config;
}

export function createLocalAdmin({repo=REPO,env={},adminToken=process.env.NUMINA_LOCAL_ADMIN_TOKEN,dataDir}={}){
  const data=dataDir||path.join(repo,'local-data');
  const uploads=path.join(data,'private-downloads'),routeFile=path.join(data,'treasury-route-config.json');
  const builtDownloads=path.join(repo,'dist/private-downloads/downloads'),client=path.join(repo,'dist/client'),privateDist=path.join(repo,'dist/private-downloads');
  const token=typeof adminToken==='string'&&adminToken.length>=16?Buffer.from(adminToken):null;
  const authorized=req=>{if(!token)return false;const h=req.headers.get('authorization')||'';const given=Buffer.from(h.startsWith('Bearer ')?h.slice(7):'');return given.length===token.length&&timingSafeEqual(given,token);};
  const requireWrite=req=>token?(authorized(req)?null:json({error:'UNAUTHORIZED',message:'Send Authorization: Bearer <NUMINA_LOCAL_ADMIN_TOKEN>.'},401)):json({error:'WRITES_DISABLED',message:'Set NUMINA_LOCAL_ADMIN_TOKEN (16+ characters) in the local environment to enable write actions.'},403);
  const fileIn=(dir,rel)=>{const f=path.resolve(dir,'.'+rel);return f.startsWith(path.resolve(dir)+path.sep)&&existsSync(f)&&statSync(f).isFile()?f:null;};
  const serveFile=(f,method)=>new Response(method==='HEAD'?null:readFileSync(f),{status:200,headers:{'Content-Type':TYPES[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'}});
  const assets={fetch(req){const u=new URL(req.url);let p=decodeURIComponent(u.pathname);if(p==='/')p='/index.html';for(const dir of [client,privateDist]){let f=fileIn(dir,p);if(!f&&!path.extname(p))f=fileIn(dir,p+'.html');if(f)return serveFile(f,req.method);}return new Response('Not found',{status:404});}};
  const workerEnv={...env,ASSETS:env.ASSETS||assets};
  const listDir=(dir,source)=>{if(!existsSync(dir))return [];const out=[];const walk=rel=>{for(const n of readdirSync(path.join(dir,rel)).sort()){const r=rel?rel+'/'+n:n,st=statSync(path.join(dir,r));if(st.isDirectory())walk(r);else out.push({name:r,bytes:st.size,modified:st.mtime.toISOString(),source,removable:source==='local'});}};walk('');return out;};
  const readRoute=()=>existsSync(routeFile)?{config:JSON.parse(readFileSync(routeFile,'utf8')),file:path.relative(repo,routeFile),saved:true}:{config:DEFAULT_TREASURY_ROUTE_CONFIG,file:path.relative(repo,routeFile),saved:false};
  const mcpConfig=()=>{
    const surfaces=JSON.parse(readFileSync(path.join(repo,'public/security-surfaces.json'),'utf8'));
    const src=readFileSync(path.join(repo,'src/sites-mcp-http.js'),'utf8');
    const publicNames=[...(src.match(/SITES_MCP_PUBLIC_NAMES=new Set\(\[([^\]]*)\]/)?.[1]||'').matchAll(/'([^']+)'/g)].map(m=>m[1]);
    const ownerRoutes=Object.fromEntries([...(src.match(/SITES_MCP_OWNER_ROUTES=\{([^}]*)\}/)?.[1]||'').matchAll(/(\w+):'([^']+)'/g)].map(m=>[m[1],m[2]]));
    return {source:['public/security-surfaces.json','src/sites-mcp-http.js'],endpoint:'/mcp',discovery:['/api/control/v2/discovery-mcp','/.well-known/agent-card.json'],toolsWithoutOwnerAuth:publicNames,ownerOnlyTools:ownerRoutes,connections:surfaces.connections??null,surfaces:(surfaces.surfaces||[]).map(s=>({id:s.id,entry:s.entry,access:s.access})),publicHost:'blocked on numinalabs.xyz and www (403 private notice)'};
  };
  async function admin(req,url){
    const p=url.pathname,m=req.method;
    if(p==='/admin'||p==='/admin/')return new Response(ADMIN_PAGE,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"}});
    if(p==='/admin/api/status'&&m==='GET')return json({console:LOCAL_ADMIN_MARKER,writesEnabled:!!token,dataDir:path.relative(repo,data)||'.',builtDownloads:existsSync(builtDownloads),treasuryModule:existsSync(path.join(repo,'local/treasury/routes.mjs'))?'mounted at /admin/treasury/':'not installed'});
    if(p==='/admin/api/mcp'&&m==='GET')return json(mcpConfig());
    if(p==='/admin/api/treasury-route'){
      if(m==='GET')return json(readRoute());
      if(m==='PUT'){const denied=requireWrite(req);if(denied)return denied;let body;try{body=JSON.parse(await req.text());}catch{return json({error:'INVALID_JSON'},400);}
        try{validateRouteConfig(body);}catch(error){return json({error:'INVALID_CONFIG',message:error.message},error.status||400);}
        mkdirSync(data,{recursive:true});const tmp=routeFile+'.tmp';writeFileSync(tmp,JSON.stringify(body,null,2)+'\n',{mode:0o600});renameSync(tmp,routeFile);return json({saved:true,file:path.relative(repo,routeFile)});}
      return json({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET, PUT'});
    }
    if(p==='/admin/api/downloads'&&m==='GET')return json({local:listDir(uploads,'local'),build:listDir(builtDownloads,'build')});
    const dl=p.match(/^\/admin\/api\/downloads\/([^/]+)$/);
    if(dl){
      const name=decodeURIComponent(dl[1]);if(!FILE_NAME.test(name))return json({error:'INVALID_NAME',message:'Use letters, digits, dot, dash or underscore.'},400);
      const target=path.join(uploads,name);
      if(m==='GET'){const f=fileIn(uploads,'/'+name)||fileIn(builtDownloads,'/'+name);return f?serveFile(f,'GET'):json({error:'NOT_FOUND'},404);}
      const denied=requireWrite(req);if(denied)return denied;
      if(m==='PUT'){const bytes=Buffer.from(await req.arrayBuffer());if(bytes.length>MAX_UPLOAD)return json({error:'TOO_LARGE'},413);if(SECRET_VALUE.test(bytes.subarray(0,1024*1024).toString('latin1')))return json({error:'SECRET_REJECTED',message:'Files containing private keys or API secrets are not accepted.'},400);
        mkdirSync(uploads,{recursive:true});const tmp=target+'.tmp';writeFileSync(tmp,bytes);renameSync(tmp,target);return json({saved:name,bytes:bytes.length,sha256:sha(bytes)},201);}
      if(m==='DELETE'){if(!existsSync(target))return json({error:'NOT_FOUND',message:'Only files in local-data/private-downloads can be removed; build files are regenerated by npm run build.'},404);unlinkSync(target);return json({removed:name});}
      return json({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET, PUT, DELETE'});
    }
    return json({error:'NOT_FOUND'},404);
  }
  // Mount point for the separately built local/treasury module (merged later). When
  // local/treasury/routes.mjs exists it must export handle(request,{repo,dataDir,authorized})
  // returning a Response (or null for "not mine"). Nothing is mounted when the file is absent.
  let treasuryModule;
  const treasuryEntry=path.join(repo,'local/treasury/routes.mjs');
  async function treasury(req){
    if(!existsSync(treasuryEntry))return json({error:'NOT_INSTALLED',message:'local/treasury/routes.mjs is not present.'},404);
    treasuryModule??=await import(pathToFileURL(treasuryEntry).href);
    const result=typeof treasuryModule.handle==='function'?await treasuryModule.handle(req,{repo,dataDir:data,authorized:()=>authorized(req),writesEnabled:!!token}):null;
    return result||json({error:'NOT_FOUND'},404);
  }
  return async function handle(req){
    const url=new URL(req.url);
    if(url.pathname==='/admin/treasury'||url.pathname.startsWith('/admin/treasury/'))return treasury(req);
    if(url.pathname==='/admin'||url.pathname.startsWith('/admin/'))return admin(req,url);
    if(url.pathname.startsWith('/downloads/')&&['GET','HEAD'].includes(req.method)){const rel=decodeURIComponent(url.pathname.slice('/downloads'.length));const f=fileIn(uploads,rel)||fileIn(builtDownloads,rel);return f?serveFile(f,req.method):new Response('Not found',{status:404});}
    // Private Worker handlers under a local hostname: the public-host gate applies only to
    // numinalabs.xyz and www.numinalabs.xyz.
    const local=new URL(url.pathname+url.search,'http://127.0.0.1');
    return worker.fetch(new Request(local,req),workerEnv);
  };
}

const ADMIN_PAGE=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Numina local admin</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;max-width:1100px;color:#111}h1{font-size:22px}section{border:1px solid #ccc;border-radius:8px;padding:14px;margin:14px 0}pre,textarea{width:100%;box-sizing:border-box;font:12px/1.4 ui-monospace,monospace;background:#f6f6f6;padding:8px;max-height:360px;overflow:auto}textarea{height:240px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eee;padding:4px;text-align:left;font-size:13px}.warn{color:#8a4b00}</style></head>
<body data-console="${LOCAL_ADMIN_MARKER}"><h1>Numina local admin</h1><p class="warn">Local network only. Config files only: this console does not sign, store keys or call providers.</p>
<label>Admin token (for write actions, kept in this tab only): <input id="token" type="password" size="40" autocomplete="off"></label> <span id="status"></span>
<section><h2>Private MCP connection config</h2><button id="mcp-load">Load</button><pre id="mcp"></pre></section>
<section><h2>Treasury API route config (local file)</h2><button id="route-load">Load</button> <button id="route-save">Save</button><textarea id="route"></textarea><div id="route-msg"></div></section>
<section><h2>Private downloads</h2><button id="dl-load">Refresh</button> <input id="dl-file" type="file"> <button id="dl-add">Add</button><table><thead><tr><th>Name</th><th>Bytes</th><th>Source</th><th></th></tr></thead><tbody id="dl"></tbody></table><div id="dl-msg"></div></section>
<script>
const $=id=>document.getElementById(id),auth=()=>({Authorization:'Bearer '+$('token').value});
async function call(path,opts={}){const r=await fetch(path,opts);const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t}if(!r.ok)throw Error((b&&b.message)||(b&&b.error)||r.status);return b}
async function status(){const s=await call('/admin/api/status');$('status').textContent=s.writesEnabled?'writes enabled':'writes disabled (set NUMINA_LOCAL_ADMIN_TOKEN)'}
$('mcp-load').onclick=async()=>{$('mcp').textContent=JSON.stringify(await call('/admin/api/mcp'),null,2)};
$('route-load').onclick=async()=>{const r=await call('/admin/api/treasury-route');$('route').value=JSON.stringify(r.config,null,2);$('route-msg').textContent=(r.saved?'Saved file: ':'Defaults (not saved yet): ')+r.file};
$('route-save').onclick=async()=>{try{const r=await call('/admin/api/treasury-route',{method:'PUT',headers:{...auth(),'Content-Type':'application/json'},body:$('route').value});$('route-msg').textContent='Saved '+r.file}catch(e){$('route-msg').textContent='Not saved: '+e.message}};
async function list(){const d=await call('/admin/api/downloads');const rows=[...d.local,...d.build];$('dl').replaceChildren(...rows.map(f=>{const tr=document.createElement('tr');for(const v of [f.name,f.bytes,f.source]){const td=document.createElement('td');td.textContent=v;tr.append(td)}const td=document.createElement('td');if(f.removable){const b=document.createElement('button');b.textContent='Remove';b.onclick=async()=>{try{await call('/admin/api/downloads/'+encodeURIComponent(f.name),{method:'DELETE',headers:auth()});list()}catch(e){$('dl-msg').textContent=e.message}};td.append(b)}tr.append(td);return tr}))}
$('dl-load').onclick=list;
$('dl-add').onclick=async()=>{const f=$('dl-file').files[0];if(!f)return;try{await call('/admin/api/downloads/'+encodeURIComponent(f.name),{method:'PUT',headers:auth(),body:f});$('dl-msg').textContent='Added '+f.name;list()}catch(e){$('dl-msg').textContent='Not added: '+e.message}};
status().catch(e=>$('status').textContent=e.message);
</script></body></html>`;
