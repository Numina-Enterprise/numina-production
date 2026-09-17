import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {createNuminaTreasury} from './native-treasury.js';
import {treasuryDocumentHttp} from './treasury-documents.js';
import {readStripeTreasury} from './stripe-treasury.js';
import {CONTROL_VERSION,CONTROL_ADAPTER,stable,controlHash,controlError} from './control.js';
import {readControl,bootstrapControl,controlSnapshot,commitControl} from './control-store.js';
import {rateLimit} from './store.js';
import {WALLET_EXECUTION_POLICY,walletExecutionAuthorized} from '../public/wallet-execution-policy.js';
import {readWalletDeploymentIntent,writeWalletDeploymentIntent} from './wallet-execution-store.js';
// Numina singular authority: production treasury workflows authenticate with repository-scoped GitHub OIDC.
export const CONTROL_API_KEY_SHA256_PIN='d00bb7c7b85a0ff5ef6681db70aed9cdcfab1a5cd60186d334dcb57d07a4c0e6';
export const SOURCE_OF_TRUTH_MODEL='NUMINA';
export const CONTROL_WORKER_IDENTITY='NUMINA';
export const AUTHORITY_IDENTITY='NUMINA';
export const OWNER_AUTHORITY_MODEL='NUMINA_OWNER';
export const ENVIRONMENT_MODEL='SINGULAR';
export const PRODUCTION_PROXY_ROLE='MIRROR';
export const GITHUB_OIDC_ISSUER='https://token.actions.githubusercontent.com';
export const GITHUB_OIDC_JWKS='https://token.actions.githubusercontent.com/.well-known/jwks';
export const GITHUB_OIDC_AUDIENCE='numina-control';
export const GITHUB_OIDC_REPOSITORY='skott34-dot/numina-production';
export const GITHUB_OIDC_REPOSITORY_ID='1367647143';
export const GITHUB_OIDC_OWNER_ID='269050000';
export const GITHUB_OIDC_REF='refs/heads/main';
export const GITHUB_OIDC_ENVIRONMENT='production';
export const GITHUB_OIDC_WORKFLOW_REF='skott34-dot/numina-production/.github/workflows/settle-numina-aggregate-model.yml@refs/heads/main';
let githubOidcCache={at:0,keys:null};
function decodeB64Url(value){const normalized=value.replace(/-/g,'+').replace(/_/g,'/');const padded=normalized+'='.repeat((4-normalized.length%4)%4);const raw=atob(padded);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function decodeJwtJson(value){return JSON.parse(new TextDecoder().decode(decodeB64Url(value)));}
async function githubOidcKeys(fetchImpl,nowMs){
  if(githubOidcCache.keys&&nowMs-githubOidcCache.at<300000)return githubOidcCache.keys;
  const response=await fetchImpl(GITHUB_OIDC_JWKS,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('GITHUB_OIDC_JWKS_UNAVAILABLE');
  const body=await response.json();
  if(!Array.isArray(body.keys)||body.keys.length===0)throw Error('GITHUB_OIDC_JWKS_INVALID');
  githubOidcCache={at:nowMs,keys:body.keys};
  return body.keys;
}
export async function verifyGithubActionsOidc(token,{fetchImpl=fetch,now=Math.floor(Date.now()/1000),keys=null}={}){
  try{
    const parts=token.split('.');if(parts.length!==3)return false;
    const header=decodeJwtJson(parts[0]),claims=decodeJwtJson(parts[1]);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid)return false;
    const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    if(claims.iss!==GITHUB_OIDC_ISSUER||!audience.includes(GITHUB_OIDC_AUDIENCE))return false;
    if(String(claims.repository_id)!==GITHUB_OIDC_REPOSITORY_ID||claims.repository!==GITHUB_OIDC_REPOSITORY||String(claims.repository_owner_id)!==GITHUB_OIDC_OWNER_ID)return false;
    if(claims.ref!==GITHUB_OIDC_REF||claims.environment!==GITHUB_OIDC_ENVIRONMENT||claims.workflow_ref!==GITHUB_OIDC_WORKFLOW_REF)return false;
    if(!['workflow_dispatch','push'].includes(claims.event_name)||claims.runner_environment!=='github-hosted')return false;
    if(typeof claims.exp!=='number'||typeof claims.iat!=='number'||claims.exp<now-30||claims.iat>now+30||claims.iat<now-900)return false;
    if(typeof claims.nbf==='number'&&claims.nbf>now+30)return false;
    if(typeof claims.sub!=='string'||!claims.sub.startsWith('repo:')||!claims.sub.includes(':environment:production'))return false;
    const available=keys||await githubOidcKeys(fetchImpl,Date.now());
    const jwk=available.find(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.use||key.use==='sig')&&(!key.alg||key.alg==='RS256'));
    if(!jwk)return false;
    const publicKey=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,decodeB64Url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{return false;}
}
function controlApiKeyPins(env){const configured=typeof env.NUMINA_CONTROL_API_KEY_SHA256==='string'?env.NUMINA_CONTROL_API_KEY_SHA256.trim():'';if(configured&&!/^[a-f0-9]{64}$/.test(configured))controlError('AUTHORITY_CONFIGURATION_INVALID',503);return configured&&configured!==CONTROL_API_KEY_SHA256_PIN?[CONTROL_API_KEY_SHA256_PIN,configured]:[CONTROL_API_KEY_SHA256_PIN];}
function controlResponse(body,status=200,extraHeaders={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Numina-Control-Version':CONTROL_VERSION,...extraHeaders}});}
export async function controlActor(req,env){
  if(!env.NUMINA_CONTROL_OWNER)controlError('AUTHORITY_CONFIGURATION_MISSING',503);
  const auth=req.headers.get('authorization');
  if(auth){
    if(!auth.startsWith('Bearer '))controlError('UNAUTHENTICATED',401);
    const token=auth.slice(7);
    if(token.split('.').length===3&&await verifyGithubActionsOidc(token))return env.NUMINA_CONTROL_OWNER;
    if(!controlApiKeyPins(env).includes(await controlHash(token)))controlError('UNAUTHENTICATED',401);
    return env.NUMINA_CONTROL_OWNER;
  }
  // Identity is supplied by Sites or the verified reviewer middleware. Reviewers
  // retain their distinct principal and do not inherit the production root.
  const id=req.headers.get('oai-authenticated-user-id'),email=req.headers.get('oai-authenticated-user-email');
  if(!id||!email)controlError('UNAUTHENTICATED',401);
  return 'email:'+email.trim().toLowerCase();
}
export async function controlBody(req){
  if(req.headers.get('content-type')?.split(';')[0]!=='application/json'||req.headers.has('content-encoding'))controlError('JSON_REQUIRED',415);
  const reader=req.body?.getReader();if(!reader)controlError('EMPTY_BODY',400);const chunks=[];let bytes=0;const deadline=Date.now()+5000;
  for(;;){let timer;let chunk;try{chunk=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('BODY_TIMEOUT'),{code:'BODY_TIMEOUT',status:408})),Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>16384){await reader.cancel();controlError('BODY_TOO_LARGE',413);}chunks.push(chunk.value);}
  const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
  try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(combined),value=JSON.parse(raw);if(stable(value)!==raw)controlError('CANONICAL_JSON_REQUIRED',400);return value;}catch{controlError('CANONICAL_JSON_REQUIRED',400);}
}
export async function controlHttp(req,env){
  const path=new URL(req.url).pathname,now=Math.floor(Date.now()/1000);
  try{
    const bucket=await controlHash('control:'+Math.floor(now/86400)+':'+(req.headers.get('cf-connecting-ip')||'unknown'));
    if(!await rateLimit(env.DB,bucket,now))return controlResponse({error:'RATE_LIMITED'},429);
    if(req.method==='GET'&&path==='/api/control/v1/health'){
      const row=await readControl(env.DB);const count={n:row.eventCount};
      const configured=!!env.NUMINA_CONTROL_OWNER&&env.NUMINA_CONTROL_OWNER===row.state.root;
      const healthy=configured&&count.n===row.revision+1;
      return controlResponse({status:healthy?'ready':'degraded',version:CONTROL_VERSION,architecture:'singular',source_of_truth_model:SOURCE_OF_TRUTH_MODEL,worker_identity:CONTROL_WORKER_IDENTITY,authority_identity:AUTHORITY_IDENTITY,owner_authority_model:OWNER_AUTHORITY_MODEL,environment_model:ENVIRONMENT_MODEL,production_proxy_role:PRODUCTION_PROXY_ROLE,authentication:['github-actions-oidc','pinned-bearer','sites-identity'],sharedState:'D1',authority:'root-traceable-attenuated-grants',interoperability:[CONTROL_ADAPTER],evidence:'versioned-causal-DAG-and-hash-linked-journal',reconciliation:'event-driven-single-reducer',nextAction:'revision-and-evidence-bound',checks:{storage:true,stateIntegrity:true,evidenceHead:true,journalContinuity:count.n===row.revision+1,authorityConfigured:configured},revision:row.revision,eventCount:count.n,stateHash:row.state_hash,evidenceHead:row.head_hash,verificationScope:'internal_record_consistency_only',financialVerification:false,executionScope:'internal_record_commit',settlementScope:'not_connected',externalExecution:false,fullCoreConstitutionCertification:false},healthy?200:503);
    }
    if(req.method==='GET'&&path==='/api/control/v1/manifest')return controlResponse({version:CONTROL_VERSION,architecture:'singular',source_of_truth_model:SOURCE_OF_TRUTH_MODEL,worker_identity:CONTROL_WORKER_IDENTITY,authority_identity:AUTHORITY_IDENTITY,owner_authority_model:OWNER_AUTHORITY_MODEL,environment_model:ENVIRONMENT_MODEL,production_proxy_role:PRODUCTION_PROXY_ROLE,authentication:{primary:'github-actions-oidc',audience:GITHUB_OIDC_AUDIENCE,repository_id:GITHUB_OIDC_REPOSITORY_ID,environment:GITHUB_OIDC_ENVIRONMENT,legacy_bearer:true,sites_identity:true},denomination_policy:NUMINA_LAYERS.denomination_policy,procurement_usage:NUMINA_LAYERS.procurement_usage,procurement:NUMINA_LAYERS.procurement,treasury:'/api/control/v1/treasury',lifecycle:['REQUEST','AUTHORITY','POLICY','ROUTE','EXECUTION','SETTLEMENT','EVIDENCE','RECONCILIATION','VERIFIED_NEXT_STATE'],adapters:[CONTROL_ADAPTER],unsupportedAdapters:'ESCALATE',publicDemoCredentials:'not recognized',limits:{requests:100,grants:100,evidenceNodes:400,journalEvents:null,stateBytes:null,maximumRevision:Number.MAX_SAFE_INTEGER},capacityPolicy:{applicationWideJournalCap:false,applicationWideStateByteCap:false,providerLimitsApply:true},verificationScope:'internal_record_consistency_only',financialVerification:false,executionScope:'internal_record_commit',settlementScope:'not_connected',externalExecution:false,constitution:'Core v1.8 source preserved; full C1-C14 hosted certification not claimed'});
    if(!['GET','POST'].includes(req.method))return controlResponse({error:'METHOD_NOT_ALLOWED'},405);
    const actor=await controlActor(req,env);
    if(req.method==='POST'&&!req.headers.get('authorization')){
      const origin=req.headers.get('origin');if(origin!==new URL(req.url).origin)controlError('ORIGIN_REQUIRED',403);
    }
    if(path==='/api/control/v1/bootstrap'&&req.method==='POST'){
      if(actor!==env.NUMINA_CONTROL_OWNER)controlError('AUTHORITY_DENIED',403);
      const body=await controlBody(req);if(stable(body)!==stable({initialize:true}))controlError('INVALID_BOOTSTRAP',400);
      return controlResponse(await bootstrapControl(env.DB,actor,now),201);
    }
    const current=await readControl(env.DB);if(current.state.root!==env.NUMINA_CONTROL_OWNER)controlError('ROOT_CONFIGURATION_MISMATCH',503);
    if(path==='/api/control/v1/nusd-deployment'){
      if(actor!==current.state.root)controlError('OWNER_VIEW_REQUIRED',403);
      if(new URL(req.url).search)controlError('DEPLOYMENT_QUERY_NOT_ALLOWED',400);
      if(req.method==='GET')return controlResponse({policy:WALLET_EXECUTION_POLICY,submissionAllowed:walletExecutionAuthorized(),record:await readWalletDeploymentIntent(env.DB,actor)});
      return controlResponse(await writeWalletDeploymentIntent(env.DB,actor,await controlBody(req)));
    }
    if(path==='/api/control/v1/stripe-treasury'){
      if(actor!==current.state.root)controlError('OWNER_VIEW_REQUIRED',403);
      if(req.method!=='GET')return controlResponse({error:'METHOD_NOT_ALLOWED'},405);
      return controlResponse(await readStripeTreasury(env));
    }
    if(path==='/api/control/v1/treasury-documents'||path.startsWith('/api/control/v1/treasury-documents/')){
      if(actor!==current.state.root)controlError('OWNER_VIEW_REQUIRED',403);
      return await treasuryDocumentHttp(req,env,actor);
    }
    if(path==='/api/control/v1/treasury-attestation'){
      if(actor!==current.state.root)controlError('OWNER_VIEW_REQUIRED',403);
      if(req.method!=='GET')return controlResponse({error:'METHOD_NOT_ALLOWED'},405);
      return controlResponse({canonical:'/api/control/v1/treasury'},308,{Location:'/api/control/v1/treasury'});
    }
    if(path==='/api/control/v1/treasury'){
      const treasury=createNuminaTreasury({db:env.DB,principal:actor,root:env.NUMINA_CONTROL_OWNER});
      if(req.method==='GET')return controlResponse(await treasury.readTreasury());
      return controlResponse(await treasury.writeTreasury(await controlBody(req)));
    }
    if(path==='/api/control/v1/state'&&req.method==='GET')return controlResponse(await controlSnapshot(env.DB,actor,now));
    if(path==='/api/control/v1/next-action'&&req.method==='GET'){const snapshot=await controlSnapshot(env.DB,actor,now);return controlResponse({revision:snapshot.revision,decisions:snapshot.decisions});}
    if(path==='/api/control/v1/commands'&&req.method==='POST'){const body=await controlBody(req);if(body.type==='treasury')controlError('CANONICAL_TREASURY_ROUTE_REQUIRED',409);if(body.type?.startsWith('frontier.'))controlError('CANONICAL_FRONTIER_ROUTE_REQUIRED',409);return controlResponse(await commitControl(env.DB,body,actor,Math.floor(Date.now()/1000)));}
    if(path==='/api/control/v1/journal'&&req.method==='GET'){
      if(actor!==current.state.root)controlError('OWNER_VIEW_REQUIRED',403);
      const after=Number(new URL(req.url).searchParams.get('after')??-1);if(!Number.isSafeInteger(after)||after< -1)controlError('INVALID_CURSOR',400);
      const rows=await env.DB.prepare('SELECT event_json,hash FROM numina_control_events WHERE revision>? ORDER BY revision LIMIT 100').bind(after).all();return controlResponse({events:rows.results.map(r=>({event:JSON.parse(r.event_json),hash:r.hash})),next:rows.results.length?JSON.parse(rows.results.at(-1).event_json).revision:null});
    }
    return controlResponse({error:'NOT_FOUND'},404);
  }catch(error){const code=error.code||'DEPENDENCY_UNAVAILABLE',status=error.status||503;return controlResponse({status:'unavailable',error:code},status);}
}
