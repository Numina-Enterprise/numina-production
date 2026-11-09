// Shared OAuth client for MCP HTTP transports.
// Stripe MCP (oauth21:true, the default here) requires OAuth 2.1: authorization_code + refresh_token
// only, PKCE S256, public client (token_endpoint_auth_method=none), RFC 8707 resource on
// authorize/token/refresh, and RFC 9207 iss validation when the AS advertises it.
// For providers that only speak OAuth 2.0-style flows, pass {oauth21:false} to relax resource/iss
// requirements while still preferring PKCE S256 and the authorization_code grant.
// Spec titles such as "OAuth 2.0 Protected Resource Metadata (RFC9728)" name the RFCs; our Stripe
// flow is OAuth 2.1. Tokens are never printed or logged.
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';

export class OAuthError extends Error{constructor(m,code='OAUTH_ERROR'){super(m);this.name='OAuthError';this.code=code;}}
const b64url=b=>Buffer.from(b).toString('base64url');
export function pkcePair(){const verifier=b64url(randomBytes(32));return {verifier,challenge:b64url(createHash('sha256').update(verifier).digest()),method:'S256'};}
export function canonicalResource(serverUrl){const u=new URL(serverUrl);u.hash='';u.search='';let s=u.toString();if(s.endsWith('/')&&u.pathname==='/')s=s.slice(0,-1);return s;}

export function parseWwwAuthenticate(h){
  const out={};if(!h)return out;
  for(const m of h.matchAll(/([a-zA-Z_]+)="([^"]*)"/g))out[m[1]]=m[2];
  return out;
}
async function getJson(fetchImpl,url){
  const r=await fetchImpl(url,{headers:{Accept:'application/json'}});
  if(!r.ok)throw new OAuthError(`GET ${new URL(url).origin}${new URL(url).pathname} -> ${r.status}`,'OAUTH_DISCOVERY');
  return r.json();
}
export async function discover({serverUrl,fetchImpl,wwwAuthenticate}){
  const base=new URL(serverUrl);
  const hinted=parseWwwAuthenticate(wwwAuthenticate).resource_metadata;
  const candidates=hinted?[hinted]:[...new Set([new URL('/.well-known/oauth-protected-resource'+(base.pathname==='/'?'':base.pathname.replace(/\/$/,'')),base).toString(),new URL('/.well-known/oauth-protected-resource',base).toString()])];
  let prm;
  for(const u of candidates){try{prm=await getJson(fetchImpl,u);break;}catch(e){if(u===candidates.at(-1))throw e;}}
  const issuer=prm.authorization_servers?.[0];
  if(!issuer)throw new OAuthError('protected resource metadata lists no authorization server','OAUTH_DISCOVERY');
  const iu=new URL(issuer);const suffix=iu.pathname==='/'?'':iu.pathname;
  let as;
  for(const cand of [`/.well-known/oauth-authorization-server${suffix}`,`/.well-known/openid-configuration${suffix}`,`${suffix}/.well-known/openid-configuration`]){
    try{as=await getJson(fetchImpl,new URL(cand,iu).toString());break;}catch{}
  }
  if(!as)throw new OAuthError('authorization server metadata not found','OAUTH_DISCOVERY');
  if(!(as.code_challenge_methods_supported||[]).includes('S256'))throw new OAuthError('authorization server does not advertise PKCE S256; refusing','OAUTH_NO_PKCE');
  return {resource:prm.resource||canonicalResource(serverUrl),issuer:as.issuer||issuer,as,scopes:prm.scopes_supported||as.scopes_supported||[]};
}
async function register({as,fetchImpl,redirectUri,clientName}){
  if(!as.registration_endpoint)throw new OAuthError('no registration endpoint; configure a client id','OAUTH_NO_REGISTRATION');
  // OAuth 2.1 public client: authorization_code + refresh_token only; no client secret; no implicit/password.
  const body={client_name:clientName,redirect_uris:[redirectUri],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'};
  const r=await fetchImpl(as.registration_endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new OAuthError(`client registration failed (${r.status})`,'OAUTH_REGISTRATION');
  return r.json();
}
async function tokenRequest({as,fetchImpl,params}){
  const r=await fetchImpl(as.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(params).toString()});
  const body=await r.json().catch(()=>({}));
  if(!r.ok||!body.access_token)throw new OAuthError(`token endpoint returned ${r.status}${body.error?` (${body.error})`:''}`,'OAUTH_TOKEN');
  return body;
}
const toSession=(tok,{clientId,issuer,resource,prev})=>({accessToken:tok.access_token,refreshToken:tok.refresh_token||prev?.refreshToken||null,
  tokenType:tok.token_type||'Bearer',scope:tok.scope||null,expiresAt:tok.expires_in?new Date(Date.now()+tok.expires_in*1000).toISOString():null,clientId,issuer,resource});

// Loopback redirect listener bound to 127.0.0.1 only, on an ephemeral port.
function loopbackListener(timeoutMs){
  return new Promise((resolve,reject)=>{
    let done;const result=new Promise((res,rej)=>{done={res,rej};});
    const srv=createServer((req,res)=>{
      const u=new URL(req.url,'http://127.0.0.1');
      if(u.pathname!=='/callback'){res.writeHead(404).end();return;}
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end('Numina local admin: authorization received. You can close this tab.');
      done.res(Object.fromEntries(u.searchParams));
    });
    srv.listen(0,'127.0.0.1',()=>{
      const timer=setTimeout(()=>done.rej(new OAuthError('timed out waiting for the OAuth redirect','OAUTH_TIMEOUT')),timeoutMs);
      resolve({redirectUri:`http://127.0.0.1:${srv.address().port}/callback`,result:result.finally(()=>{clearTimeout(timer);srv.close();})});
    });
    srv.on('error',reject);
  });
}

// openUrl receives the authorization URL; the CLI prints it for the user to open in a browser.
export async function login({serverUrl,store,fetchImpl,openUrl,clientName='Numina local admin',clientId,wwwAuthenticate,timeoutMs=300000,scope,oauth21=true}){
  const meta=await discover({serverUrl,fetchImpl,wwwAuthenticate});
  const {redirectUri,result}=await loopbackListener(timeoutMs);
  const client=clientId?{client_id:clientId}:await register({as:meta.as,fetchImpl,redirectUri,clientName});
  const pkce=pkcePair();const state=b64url(randomBytes(16));
  const auth=new URL(meta.as.authorization_endpoint);
  // authorization_code only — never implicit or password (OAuth 2.1 / MCP auth).
  const q={response_type:'code',client_id:client.client_id,redirect_uri:redirectUri,code_challenge:pkce.challenge,code_challenge_method:'S256',state};
  if(oauth21||meta.resource)q.resource=meta.resource;
  const resolvedScope=scope||(meta.scopes.includes('mcp')?'mcp':meta.scopes.join(' '));
  if(resolvedScope)q.scope=resolvedScope;
  for(const [k,v] of Object.entries(q))auth.searchParams.set(k,v);
  await openUrl(auth.toString());
  const cb=await result;
  if(cb.state!==state)throw new OAuthError('OAuth state mismatch; discarding response','OAUTH_STATE');
  if(cb.error)throw new OAuthError(`authorization denied (${cb.error})`,'OAUTH_DENIED');
  if(!cb.code)throw new OAuthError('no authorization code returned','OAUTH_NO_CODE');
  // RFC 9207 iss: when the AS advertises authorization_response_iss_parameter_supported, iss is required and must match.
  const issSupported=meta.as.authorization_response_iss_parameter_supported===true;
  if(issSupported){
    if(!cb.iss)throw new OAuthError('authorization response missing required iss parameter (RFC 9207)','OAUTH_ISS');
    if(cb.iss!==meta.issuer)throw new OAuthError('authorization response iss does not match the recorded issuer','OAUTH_ISS');
  }else if(cb.iss&&cb.iss!==meta.issuer){
    throw new OAuthError('authorization response iss does not match the recorded issuer','OAUTH_ISS');
  }
  const tokenParams={grant_type:'authorization_code',code:cb.code,redirect_uri:redirectUri,client_id:client.client_id,code_verifier:pkce.verifier};
  if(oauth21||meta.resource)tokenParams.resource=meta.resource;
  const tok=await tokenRequest({as:meta.as,fetchImpl,params:tokenParams});
  const session={...toSession(tok,{clientId:client.client_id,issuer:meta.issuer,resource:meta.resource}),tokenEndpoint:meta.as.token_endpoint};
  store.save(session);
  return {profile:store.profile,scope:session.scope,expiresAt:session.expiresAt};
}
export async function refresh({store,fetchImpl,oauth21=true}){
  const s=store.load();
  if(!s?.refreshToken||!s.tokenEndpoint)throw new OAuthError('no refresh token; run login again','OAUTH_REAUTH');
  const params={grant_type:'refresh_token',refresh_token:s.refreshToken,client_id:s.clientId};
  if((oauth21||s.resource)&&s.resource)params.resource=s.resource;
  const tok=await tokenRequest({as:{token_endpoint:s.tokenEndpoint},fetchImpl,params});
  const next={...s,...toSession(tok,{clientId:s.clientId,issuer:s.issuer,resource:s.resource,prev:s})};
  store.save(next);return next;
}
