import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {NUMINA,NUMINA_MANIFEST_SCHEMA,NUMINA_DELIVERY_SURFACES,NUMINA_PROVIDER_VERIFICATION,numinaRootProjection} from './numina-root.js';
import {NUMINA_TREASURY_INITIAL_BALANCE} from './native-treasury-model.js';
import {createNuminaTreasury} from './native-treasury.js';
import {treasuryDocumentHttp} from './treasury-documents.js';
import {readStripeTreasury} from './stripe-treasury.js';
import {CONTROL_VERSION,CONTROL_ADAPTER,stable,controlHash,controlError} from './control.js';
import {readControl,bootstrapControl,controlManifestView,commitControl} from './control-store.js';
import {rateLimit} from './store.js';
import {WALLET_EXECUTION_POLICY,walletExecutionAuthorized} from '../public/wallet-execution-policy.js';
import {readWalletDeploymentIntent,writeWalletDeploymentIntent} from './wallet-execution-store.js';
// NUMINA authentication: one verified signed identity-token path for protected production automation.
export const SOURCE_OF_TRUTH_MODEL=NUMINA;
export const CONTROL_WORKER_IDENTITY=NUMINA;
export const AUTHORITY_IDENTITY=NUMINA;
export const OWNER_AUTHORITY_MODEL=NUMINA;
export const ENVIRONMENT_MODEL=NUMINA;
export const DELIVERY_SURFACE_MODEL=NUMINA;
export const NUMINA_AUTH_ISSUER='https://token.actions.githubusercontent.com';
export const NUMINA_AUTH_JWKS='https://token.actions.githubusercontent.com/.well-known/jwks';
export const NUMINA_AUTH_AUDIENCE='numina-control';
export const NUMINA_AUTH_REPOSITORY='skott34-dot/numina-production';
export const NUMINA_AUTH_REPOSITORY_ID='1367647143';
export const NUMINA_AUTH_OWNER_ID='269050000';
export const NUMINA_AUTH_REF='refs/heads/main';
export const NUMINA_AUTH_ENVIRONMENT='production';
export const NUMINA_AUTH_WORKFLOW_REF='skott34-dot/numina-production/.github/workflows/settle-numina-aggregate-model.yml@refs/heads/main';
export const NUMINA_AUTH_WORKFLOW_REFS=Object.freeze([
  NUMINA_AUTH_WORKFLOW_REF,
  'skott34-dot/numina-production/.github/workflows/deploy-nusd-contracts.yml@refs/heads/main'
]);
let numinaAuthCache={at:0,keys:null};
function decodeB64Url(value){const normalized=value.replace(/-/g,'+').replace(/_/g,'/');const padded=normalized+'='.repeat((4-normalized.length%4)%4);const raw=atob(padded);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function decodeJwtJson(value){return JSON.parse(new TextDecoder().decode(decodeB64Url(value)));}
async function numinaAuthKeys(fetchImpl,nowMs){
  if(numinaAuthCache.keys&&nowMs-numinaAuthCache.at<300000)return numinaAuthCache.keys;
  const response=await fetchImpl(NUMINA_AUTH_JWKS,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('NUMINA_AUTH_JWKS_UNAVAILABLE');
  const body=await response.json();
  if(!Array.isArray(body.keys)||body.keys.length===0)throw Error('NUMINA_AUTH_JWKS_INVALID');
  numinaAuthCache={at:nowMs,keys:body.keys};
  return body.keys;
}
export async function verifyNuminaAuthenticationToken(token,{fetchImpl=fetch,now=Math.floor(Date.now()/1000),keys=null}={}){
  try{
    const parts=token.split('.');if(parts.length!==3)return false;
    const header=decodeJwtJson(parts[0]),claims=decodeJwtJson(parts[1]);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid)return false;
    const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    if(claims.iss!==NUMINA_AUTH_ISSUER||!audience.includes(NUMINA_AUTH_AUDIENCE))return false;
    if(String(claims.repository_id)!==NUMINA_AUTH_REPOSITORY_ID||claims.repository!==NUMINA_AUTH_REPOSITORY||String(claims.repository_owner_id)!==NUMINA_AUTH_OWNER_ID)return false;
    if(claims.ref!==NUMINA_AUTH_REF||claims.environment!==NUMINA_AUTH_ENVIRONMENT||!NUMINA_AUTH_WORKFLOW_REFS.includes(claims.workflow_ref))return false;
    if(!['workflow_dispatch','push'].includes(claims.event_name)||claims.runner_environment!=='github-hosted')return false;
    if(typeof claims.exp!=='number'||typeof claims.iat!=='number'||claims.exp<now-30||claims.iat>now+30||claims.iat<now-900)return false;
    if(typeof claims.nbf==='number'&&claims.nbf>now+30)return false;
    if(typeof claims.sub!=='string'||!claims.sub.startsWith('repo:')||!claims.sub.includes(':environment:production'))return false;
    const available=keys||await numinaAuthKeys(fetchImpl,Date.now());
    const jwk=available.find(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.use||key.use==='sig')&&(!key.alg||key.alg==='RS256'));
    if(!jwk)return false;
    const publicKey=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,decodeB64Url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{return false;}
}
function controlResponse(body,status=200,extraHeaders={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Numina-Control-Version':CONTROL_VERSION,...extraHeaders}});}
export async function controlActor(req,env){
  if(!env.NUMINA_CONTROL_OWNER)controlError('AUTHORITY_CONFIGURATION_MISSING',503);
  const auth=req.headers.get('authorization');
  if(!auth?.startsWith('Bearer '))controlError('UNAUTHENTICATED',401);
  const token=auth.slice(7);
  if(!await verifyNuminaAuthenticationToken(token))controlError('UNAUTHENTICATED',401);
  return env.NUMINA_CONTROL_OWNER;
}
export async function controlBody(req){
  if(req.headers.get('content-type')?.split(';')[0]!=='application/json'||req.headers.has('content-encoding'))controlError('JSON_REQUIRED',415);
  const reader=req.body?.getReader();if(!reader)controlError('EMPTY_BODY',400);const chunks=[];let bytes=0;const deadline=Date.now()+5000;
  for(;;){let timer;let chunk;try{chunk=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('BODY_TIMEOUT'),{code:'BODY_TIMEOUT',status:408})),Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>16384){await reader.cancel();controlError('BODY_TOO_LARGE',413);}chunks.push(chunk.value);}
  const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
  try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(combined),value=JSON.parse(raw);if(stable(value)!==raw)controlError('CANONICAL_JSON_REQUIRED',400);return value;}catch{controlError('CANONICAL_JSON_REQUIRED',400);}
}
async function readApplicationRelease(req,env){
  try{
    if(!env.ASSETS?.fetch)return null;
    const response=await env.ASSETS.fetch(new Request(new URL('/downloads/application-release-v4.json',req.url),{method:'GET'}));
    if(!response.ok)return null;
    const value=await response.json();
    return value?.root===NUMINA&&value?.identity===NUMINA?value:null;
  }catch{return null;}
}
async function controlNuminaManifest(req,env){
  const application=await readApplicationRelease(req,env);
  return numinaRootProjection({
    version:CONTROL_VERSION,
    core:NUMINA,repository:NUMINA,software:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,
    authentication:NUMINA,deployment:NUMINA,delivery:NUMINA,readiness:NUMINA,treasury:NUMINA,storage:NUMINA,projection:NUMINA,transport:NUMINA,
    deployed:true,
    mechanics:{
      repository:{full_name:NUMINA_AUTH_REPOSITORY,branch:'main'},
      runtime:{version:application?.runtime_dependency?.version??null,release:application?.runtime_dependency?.release??null},
      artifact:{build_id:application?.build_id??null},
      authentication:{identity:NUMINA,protocol:NUMINA,mechanism:'signed_identity_token',issuer:NUMINA_AUTH_ISSUER,audience:NUMINA_AUTH_AUDIENCE,verified:true},
      delivery:{transport_only:true,surfaces:NUMINA_DELIVERY_SURFACES}
    },
    provider_verification:NUMINA_PROVIDER_VERIFICATION,
    denomination_policy:NUMINA_LAYERS.denomination_policy,
    procurement_usage:NUMINA_LAYERS.procurement_usage,procurement:NUMINA_LAYERS.procurement,
    adapters:[CONTROL_ADAPTER],unsupportedAdapters:'ESCALATE',
    verificationScope:'NUMINA',financialVerification:false,externalExecution:false
  });
}
export async function controlHttp(req,env){
  const path=new URL(req.url).pathname,now=Math.floor(Date.now()/1000);
  try{
    const bucket=await controlHash('control:'+Math.floor(now/86400)+':'+(req.headers.get('cf-connecting-ip')||'unknown'));
    if(!await rateLimit(env.DB,bucket,now))return controlResponse({error:'RATE_LIMITED'},429);
    if(req.method==='GET'&&path==='/api/control/v1/health'){
      const row=await readControl(env.DB);const count={n:row.eventCount};
      const configured=!!env.NUMINA_CONTROL_OWNER&&env.NUMINA_CONTROL_OWNER===row.manifest.root;
      const healthy=configured&&count.n===row.revision+1;
      return controlResponse({root:NUMINA,manifest:NUMINA,identity:NUMINA,authority:NUMINA,source:NUMINA,evidence:NUMINA,provider:NUMINA,provider_verification:true,status:healthy?'ready':'degraded',version:CONTROL_VERSION,architecture:'singular',source_of_truth_model:SOURCE_OF_TRUTH_MODEL,worker_identity:CONTROL_WORKER_IDENTITY,authority_identity:AUTHORITY_IDENTITY,owner_authority_model:OWNER_AUTHORITY_MODEL,environment_model:ENVIRONMENT_MODEL,delivery_surface_model:DELIVERY_SURFACE_MODEL,authentication:{identity:NUMINA,protocol:NUMINA,mechanism:'signed_identity_token',verified:true},storage:'D1',interoperability:[CONTROL_ADAPTER],reconciliation:'event-driven-single-reducer',nextAction:'revision-and-evidence-bound',checks:{storage:true,manifestIntegrity:true,evidenceHead:true,journalContinuity:count.n===row.revision+1,authorityConfigured:configured},revision:row.revision,eventCount:count.n,manifestHash:row.manifest_hash,evidenceHead:row.head_hash,verificationScope:'NUMINA',financialVerification:false,executionScope:'internal_record_commit',settlementScope:'not_connected',externalExecution:false,fullCoreConstitutionCertification:false},healthy?200:503);
    }
    if(req.method==='GET'&&path==='/api/control/v1/manifest'){if(new URL(req.url).search)return controlResponse({error:'MANIFEST_QUERY_NOT_ALLOWED'},400);return controlResponse(await controlNuminaManifest(req,env));}
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
    const current=await readControl(env.DB);if(current.manifest.root!==env.NUMINA_CONTROL_OWNER)controlError('ROOT_CONFIGURATION_MISMATCH',503);
    if(path==='/api/control/v1/nusd-deployment'){
      if(actor!==current.manifest.root)controlError('OWNER_VIEW_REQUIRED',403);
      if(new URL(req.url).search)controlError('DEPLOYMENT_QUERY_NOT_ALLOWED',400);
      if(req.method==='GET')return controlResponse({policy:WALLET_EXECUTION_POLICY,submissionAllowed:walletExecutionAuthorized(),record:await readWalletDeploymentIntent(env.DB,actor)});
      return controlResponse(await writeWalletDeploymentIntent(env.DB,actor,await controlBody(req)));
    }
    if(path==='/api/control/v1/stripe-treasury'){
      if(actor!==current.manifest.root)controlError('OWNER_VIEW_REQUIRED',403);
      if(req.method!=='GET')return controlResponse({error:'METHOD_NOT_ALLOWED'},405);
      return controlResponse(await readStripeTreasury(env));
    }
    if(path==='/api/control/v1/treasury-documents'||path.startsWith('/api/control/v1/treasury-documents/')){
      if(actor!==current.manifest.root)controlError('OWNER_VIEW_REQUIRED',403);
      return await treasuryDocumentHttp(req,env,actor);
    }
    if(path==='/api/control/v1/treasury-attestation'){
      if(actor!==current.manifest.root)controlError('OWNER_VIEW_REQUIRED',403);
      if(req.method!=='GET')return controlResponse({error:'METHOD_NOT_ALLOWED'},405);
      return controlResponse({canonical:'/api/control/v1/treasury'},308,{Location:'/api/control/v1/treasury'});
    }
    if(path==='/api/control/v1/treasury'){
      const treasury=createNuminaTreasury({db:env.DB,principal:actor,root:env.NUMINA_CONTROL_OWNER});
      if(req.method==='GET')return controlResponse(await treasury.readTreasury());
      return controlResponse(await treasury.writeTreasury(await controlBody(req)));
    }
    if(path==='/api/control/v1/state'&&req.method==='GET')return controlResponse({...await controlManifestView(env.DB,actor,now),compatibility:{route:'/api/control/v1/state',role:'legacy_route_only'}});
    if(path==='/api/control/v1/next-action'&&req.method==='GET'){const manifest=await controlManifestView(env.DB,actor,now);return controlResponse({root:NUMINA,manifest:NUMINA,revision:manifest.revision,decisions:manifest.decisions});}
    if(path==='/api/control/v1/commands'&&req.method==='POST'){const body=await controlBody(req);if(body.type==='treasury')controlError('CANONICAL_TREASURY_ROUTE_REQUIRED',409);if(body.type?.startsWith('frontier.'))controlError('CANONICAL_FRONTIER_ROUTE_REQUIRED',409);return controlResponse(await commitControl(env.DB,body,actor,Math.floor(Date.now()/1000)));}
    if(path==='/api/control/v1/journal'&&req.method==='GET'){
      if(actor!==current.manifest.root)controlError('OWNER_VIEW_REQUIRED',403);
      const after=Number(new URL(req.url).searchParams.get('after')??-1);if(!Number.isSafeInteger(after)||after< -1)controlError('INVALID_CURSOR',400);
      const rows=await env.DB.prepare('SELECT event_json,hash FROM numina_control_events WHERE revision>? ORDER BY revision LIMIT 100').bind(after).all();return controlResponse({events:rows.results.map(r=>({event:JSON.parse(r.event_json),hash:r.hash})),next:rows.results.length?JSON.parse(rows.results.at(-1).event_json).revision:null});
    }
    return controlResponse({error:'NOT_FOUND'},404);
  }catch(error){const code=error.code||'DEPENDENCY_UNAVAILABLE',status=error.status||503;return controlResponse({status:'unavailable',error:code},status);}
}
