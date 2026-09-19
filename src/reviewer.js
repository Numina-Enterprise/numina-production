import {appDigest} from './app-core.js';

export const REVIEW_USER='google-play-reviewer';
export const REVIEW_EMAIL='reviewer@numina.invalid';
export const REVIEW_SUBJECT='numina:google-play-reviewer';
const REVIEW_COOKIE='__Host-numina-review';
const REVIEW_SECONDS=8*60*60;
const reviewFailure=(code,status=400)=>Object.assign(new Error(code),{code,status});
const reviewResponse=(value,status=200,extra={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Numina-Review':'production-own-records',...extra}});
const reviewConfigured=env=>env.NUMINA_REVIEW_ENABLED==='true'&&env.NUMINA_REVIEW_RECORD_SCOPE==='own'&&env.NUMINA_CONTROL_OWNER!=='email:'+REVIEW_EMAIL&&/^[a-f0-9]{64}$/.test(env.NUMINA_REVIEW_PASSWORD_SHA256||'')&&/^[a-f0-9]{64}$/.test(env.NUMINA_REVIEW_SESSION_KEY||'');
function reviewCookie(req){const values=(req.headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(REVIEW_COOKIE+'='));if(values.length>1)return 'invalid';return values[0]?.slice(REVIEW_COOKIE.length+1)||null;}
function reviewSecure(req){const url=new URL(req.url);return url.protocol==='https:'||['127.0.0.1','localhost'].includes(url.hostname);}
function reviewOrigin(req){if(!reviewSecure(req)||req.headers.get('origin')!==new URL(req.url).origin)throw reviewFailure('ORIGIN_REQUIRED',403);}
async function reviewMac(value,env){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.NUMINA_REVIEW_SESSION_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function reviewEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function reviewValid(req,env,token,now){if(!reviewConfigured(env)||!reviewSecure(req)||!/^v1\.\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token||''))return false;const [version,expires,nonce,mac]=token.split('.');if(Number(expires)<=now||Number(expires)>now+REVIEW_SECONDS)return false;return reviewEqual(mac,await reviewMac([version,expires,nonce,new URL(req.url).origin].join('.'),env));}
async function reviewBody(req){
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||req.headers.has('content-encoding'))throw reviewFailure('JSON_REQUIRED',415);
 const reader=req.body?.getReader();if(!reader)throw reviewFailure('EMPTY_BODY');let size=0;const chunks=[];let timer;
 try{return await Promise.race([(async()=>{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048)throw reviewFailure('BODY_TOO_LARGE',413);chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw reviewFailure('INVALID_JSON');}})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(reviewFailure('BODY_TIMEOUT',408)),5000);})]);}
 finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
export async function reviewerContext(req,env,now=Math.floor(Date.now()/1000)){
 const token=reviewCookie(req);if(!token)return null;
 if(!await reviewValid(req,env,token,now))return {error:reviewResponse({error:'REVIEW_SIGN_IN_REQUIRED'},401)};
 const headers=new Headers(req.headers);headers.delete('authorization');headers.delete('stripe-signature');headers.set('oai-authenticated-user-id',REVIEW_SUBJECT);headers.set('oai-authenticated-user-email',REVIEW_EMAIL);
 // A verified reviewer is an ordinary customer in the existing production data
 // store. Existing ownership checks apply; the principal never becomes owner.
 // Worker bindings may be inherited by the request-scoped environment. Spreading
 // it drops DB/ASSETS and breaks authenticated reviewer requests.
 const reviewEnv=Object.create(env);
 Object.defineProperty(reviewEnv,'NUMINA_REVIEW_SESSION',{value:true,enumerable:true});
 return {req:new Request(req,{headers}),env:Object.freeze(reviewEnv)};
}
export async function reviewerHttp(req,env,now=Math.floor(Date.now()/1000)){
 const path=new URL(req.url).pathname;
 try{
  if(path==='/api/reviewer/v1/session'&&req.method==='GET')return reviewResponse({active:await reviewValid(req,env,reviewCookie(req),now),hasSession:!!reviewCookie(req),scope:'production-own-records',checkout:'live'});
  if(req.method!=='POST')return reviewResponse({error:'METHOD_NOT_ALLOWED'},405,{Allow:path==='/api/reviewer/v1/session'?'GET':'POST'});
  reviewOrigin(req);
  if(path==='/api/reviewer/v1/logout')return reviewResponse({signedOut:true},200,{'Set-Cookie':REVIEW_COOKIE+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict'});
  if(path!=='/api/reviewer/v1/login')throw reviewFailure('NOT_FOUND',404);
  if(!reviewConfigured(env))throw reviewFailure('REVIEW_ACCESS_UNAVAILABLE',503);
  const window=Math.floor(now/60),bucket=await appDigest('review-login:'+window+':'+(req.headers.get('cf-connecting-ip')||'unknown'));
  await env.DB.prepare('DELETE FROM numina_review_login_rate WHERE window<?').bind(window-2).run();
  const row=await env.DB.prepare('INSERT INTO numina_review_login_rate (bucket,window,count) VALUES (?,?,1) ON CONFLICT(bucket,window) DO UPDATE SET count=count+1 WHERE count<12 RETURNING count').bind(bucket,window).first();if(!row)throw reviewFailure('RATE_LIMITED',429);
  const body=await reviewBody(req);
  if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='password,username'||typeof body.password!=='string'||body.password.length>128||body.username!==REVIEW_USER||!reviewEqual(await appDigest(body.password),env.NUMINA_REVIEW_PASSWORD_SHA256))throw reviewFailure('INVALID_REVIEW_CREDENTIALS',401);
  const data=['v1',now+REVIEW_SECONDS,crypto.randomUUID().replaceAll('-','')].join('.');const token=data+'.'+await reviewMac(data+'.'+new URL(req.url).origin,env);
  return reviewResponse({signedIn:true,workspace:'/app',scope:'production-own-records',checkout:'live'},200,{'Set-Cookie':REVIEW_COOKIE+'='+token+'; Path=/; Max-Age='+REVIEW_SECONDS+'; Secure; HttpOnly; SameSite=Strict'});
 }catch(error){return reviewResponse({error:error.code||'REVIEW_ACCESS_UNAVAILABLE'},error.status||503);}
}
