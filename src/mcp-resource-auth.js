import {controlActor,GITHUB_OIDC_ISSUER,verifyGithubActionsOidc} from './control-http.js';

// Canonical protected resource from the connector gate. The resource identifier
// does not follow the request host: www and the control backend advertise this URL.
export const MCP_RESOURCE='https://numinalabs.xyz/api/control/v2/mcp';
export const MCP_RESOURCE_PATH='/api/control/v2/mcp';
export const MCP_SCOPE='numina.mcp';
export const MCP_PROTECTED_RESOURCE_PATHS=Object.freeze([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/api/control/v2/mcp'
]);
export const MCP_RESOURCE_METADATA_URL='https://numinalabs.xyz/.well-known/oauth-protected-resource/api/control/v2/mcp';
// GitHub Actions OIDC is the issuer already configured for control bearer JWTs.
// Numina does not host an authorization server, and no ChatGPT redirect is registered in this tree.
export const MCP_ISSUER_ROLE='external';
export const MCP_REGISTERED_REDIRECT_URI=null;
const LOCAL_AUTHORIZATION_PATHS=new Set(['/.well-known/oauth-authorization-server','/.well-known/openid-configuration']);

export function mcpIssuerConfiguration(){
  if(MCP_ISSUER_ROLE!=='external'||typeof GITHUB_OIDC_ISSUER!=='string'||GITHUB_OIDC_ISSUER!=='https://token.actions.githubusercontent.com')return null;
  return {issuer:GITHUB_OIDC_ISSUER,role:MCP_ISSUER_ROLE,registeredRedirectUri:MCP_REGISTERED_REDIRECT_URI,scope:MCP_SCOPE,resource:MCP_RESOURCE};
}

export function mcpProtectedResourceMetadata(){
  const configuration=mcpIssuerConfiguration();
  if(!configuration)return null;
  return {
    resource:configuration.resource,
    authorization_servers:[configuration.issuer],
    scopes_supported:[configuration.scope],
    bearer_methods_supported:['header'],
    resource_signing_alg_values_supported:['RS256']
  };
}

export function mcpWwwAuthenticate(error){
  const params=[`resource_metadata="${MCP_RESOURCE_METADATA_URL}"`];
  if(error)params.unshift(`error="${error}"`);
  return 'Bearer '+params.join(', ');
}

function mcpResponse(body,status,extra={}){
  return new Response(body===null?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization',...extra}});
}

export function mcpChallenge(status,error){
  return mcpResponse({error:error==='invalid_token'?'INVALID_TOKEN':error==='invalid_request'?'INVALID_REQUEST':'UNAUTHENTICATED'},status,{'WWW-Authenticate':mcpWwwAuthenticate(error)});
}

export function localAuthorizationServerPath(path){
  return LOCAL_AUTHORIZATION_PATHS.has(path)||path.startsWith('/.well-known/oauth-authorization-server/');
}

// Authorization-code decisions stay fail-closed. The external issuer role never
// reaches the redirect comparison, and a missing registered redirect cannot succeed.
export function decideAuthorizationCode({redirectUri,codeChallenge,codeChallengeMethod,registeredRedirectUri=MCP_REGISTERED_REDIRECT_URI,issuerRole=MCP_ISSUER_ROLE}={}){
  if(issuerRole!=='local')return {accepted:false,code:'ISSUER_ROLE_EXTERNAL'};
  if(typeof registeredRedirectUri!=='string'||registeredRedirectUri.length===0)return {accepted:false,code:'REGISTERED_REDIRECT_UNCONFIGURED'};
  if(redirectUri!==registeredRedirectUri)return {accepted:false,code:'REDIRECT_NOT_REGISTERED'};
  if(codeChallengeMethod!=='S256')return {accepted:false,code:'PKCE_METHOD_REJECTED'};
  if(typeof codeChallenge!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge))return {accepted:false,code:'PKCE_CHALLENGE_REJECTED'};
  return {accepted:true,code:'AUTHORIZATION_CODE_ACCEPTED'};
}

export async function resolveMcpActor(req,env){
  const configuration=mcpIssuerConfiguration();
  if(!configuration)return {response:mcpResponse({error:'AUTHORITY_CONFIGURATION_MISSING'},503)};
  const header=req.headers.get('authorization');
  if(!header)return {response:mcpChallenge(401)};
  if(!header.startsWith('Bearer ')||!header.slice(7))return {response:mcpChallenge(401,'invalid_request')};
  if(!env.NUMINA_CONTROL_OWNER)return {response:mcpResponse({error:'AUTHORITY_CONFIGURATION_MISSING'},503)};
  const token=header.slice(7);
  if(token.split('.').length===3){
    const ok=await verifyGithubActionsOidc(token,{audience:configuration.resource,scope:configuration.scope});
    if(!ok)return {response:mcpChallenge(401,'invalid_token'),mechanism:'github-actions-oidc'};
    return {actor:env.NUMINA_CONTROL_OWNER,mechanism:'github-actions-oidc'};
  }
  try{
    const actor=await controlActor(req,env);
    if(actor!==env.NUMINA_CONTROL_OWNER)return {response:mcpResponse({error:'AUTHORITY_DENIED'},403,{'WWW-Authenticate':mcpWwwAuthenticate('insufficient_scope')})};
    return {actor,mechanism:'opaque-owner-bearer'};
  }catch(error){
    if(error?.code==='AUTHORITY_CONFIGURATION_INVALID')throw error;
    if(error?.status===401||error?.code==='UNAUTHENTICATED')return {response:mcpChallenge(401,'invalid_token'),mechanism:'opaque-owner-bearer'};
    return {response:mcpResponse({error:error?.code||'DEPENDENCY_UNAVAILABLE'},error?.status||503)};
  }
}

export function mcpMetadataResponse(method){
  const metadata=mcpProtectedResourceMetadata();
  if(!metadata)return mcpResponse({error:'AUTHORITY_CONFIGURATION_MISSING'},503);
  return mcpResponse(method==='HEAD'?null:metadata,200);
}
