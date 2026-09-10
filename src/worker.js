import {VERSION,PROFILE,canonical,encoder,b64,digest,verifyCredential,decision} from './core.js';
import {initialize,rateLimit,replay,commitEvent,storeViolation,coverage} from './store.js';
import {DEMO_KEY,CONFORMANCE} from './generated.js';
const LIMIT=8192;
const security={'X-Numina-Version':VERSION,'X-Numina-Profile':PROFILE.id,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
function response(body,status=200,extra={}) {return new Response(JSON.stringify(body),{status,headers:{...security,'Content-Type':'application/json','Cache-Control':'no-store',...extra}});}
async function receiptFor(env,result,hash,requestId,kind,now) {
  const receipt={id:crypto.randomUUID(),kind,requestId,credentialHash:hash,issuedAt:now,version:VERSION,profile:PROFILE.id,scope:'test-only',outcome:result.outcome,reason:result.reason};
  const key=await crypto.subtle.importKey('jwk',JSON.parse(env.NUMINA_RECEIPT_PRIVATE_JWK),{name:'Ed25519'},false,['sign']);
  const protectedHeader={alg:'Ed25519',kid:'numina-receipt-1',purpose:'external-test-receipt'};
  const value=b64(await crypto.subtle.sign('Ed25519',key,encoder.encode(canonical({receipt,protected:protectedHeader}))));
  return {receipt,signature:{...protectedHeader,value}};
}
async function readEnvelope(req) {
  if((req.headers.get('content-type')||'').split(';')[0].trim()!=='application/json')throw {status:415,reason:'JSON_REQUIRED'};
  if(req.headers.has('content-encoding'))throw {status:415,reason:'ENCODING_UNSUPPORTED'};
  if(Number(req.headers.get('content-length'))>LIMIT)throw {status:413,reason:'BODY_TOO_LARGE'};
  if(!req.body)throw {status:400,reason:'EMPTY_BODY'};
  const reader=req.body.getReader(),parts=[]; let total=0;const deadline=Date.now()+5000;
  for(;;){let timer;let chunk;try{chunk=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject({status:408,reason:'BODY_TIMEOUT'}),Math.max(1,deadline-Date.now()));})]);}catch(e){reader.cancel().catch(()=>{});throw e;}finally{clearTimeout(timer);}const {done,value}=chunk;if(done)break;total+=value.byteLength;if(total>LIMIT){await reader.cancel();throw {status:413,reason:'BODY_TOO_LARGE'};}parts.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const parsed=JSON.parse(raw);if(canonical(parsed)!==raw)throw 0;return parsed;}catch{throw {status:400,reason:'CANONICAL_JSON_REQUIRED'};}
}
export default {
 async fetch(req,env) {
  const requestId=crypto.randomUUID(),start=Date.now(),now=Math.floor(start/1000),url=new URL(req.url),path=url.pathname;
  let status=200,outcome,reason;
  const finish=r=>{status=r.status;r.headers.set('X-Request-Id',requestId);return r;};
  try {
   if(!path.startsWith('/api/')) { const r=await env.ASSETS.fetch(req);const h=new Headers(r.headers);for(const [k,v]of Object.entries(security))h.set(k,v); return new Response(r.body,{status:r.status,headers:h}); }
   if(!['GET','POST'].includes(req.method))return finish(response({error:'METHOD_NOT_ALLOWED'},405,{'Allow':'GET, POST'}));
   if(path==='/api/v0.1/health'&&req.method==='GET')return finish(response({status:'up',version:VERSION,scope:'test-only',fundsExecution:false}));
   await initialize(env.DB);
   // Cloudflare supplies CF-Connecting-IP; untrusted forwarded headers are never used.
   const ip=await digest('numina-rate:'+now.toString().slice(0,-5)+':'+(req.headers.get('cf-connecting-ip')||'unknown'));
   if(!await rateLimit(env.DB,ip,now))return finish(response({error:'RATE_LIMITED'},429,{'Retry-After':String(60-now%60)}));
   if(path==='/api/v0.1/status'&&req.method==='GET')return finish(response({status:env.NUMINA_RECEIPT_PRIVATE_JWK?'ready':'degraded',version:VERSION,storage:'available',receiptSigning:!!env.NUMINA_RECEIPT_PRIVATE_JWK,financialExecution:false,constitutionalConformance:'UNVERIFIED_C1_C14',limits:{bodyBytes:LIMIT,requestsPerMinutePerIp:30,requestsPerMinuteGlobal:300,maxEvents:10000},coverage:await coverage(env.DB)},env.NUMINA_RECEIPT_PRIVATE_JWK?200:503));
   if(path==='/api/v0.1/profile'&&req.method==='GET')return finish(response(PROFILE));
   if(path==='/api/v0.1/keys'&&req.method==='GET')return finish(response({keys:[DEMO_KEY,...(env.NUMINA_RECEIPT_PUBLIC_JWK?[{kid:'numina-receipt-1',purpose:'external-test-receipt',jwk:JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)}]:[])],warning:'EAC key is intentionally public test material. Receipt keys cannot authorize credentials.'}));
   if(path==='/api/v0.1/conformance'&&req.method==='GET')return finish(response({version:VERSION,scope:'implementation conformance; not constitutional certification',report:CONFORMANCE,harness:'/downloads/conformance.mjs',vectors:'/downloads/conformance-vectors.json'}));
   if(path==='/api/v0.1/coverage'&&req.method==='GET')return finish(response(await coverage(env.DB)));
   if(path.startsWith('/api/v0.1/receipts/')&&req.method==='GET') {
    const id=path.slice('/api/v0.1/receipts/'.length);if(!/^[0-9a-f-]{36}$/.test(id))return finish(response({error:'NOT_FOUND'},404));
    const row=await env.DB.prepare('SELECT receipt_json FROM numina_events_v1 WHERE receipt_id=? UNION ALL SELECT receipt_json FROM numina_violations_v1 WHERE receipt_id=? LIMIT 1').bind(id,id).first();
    return finish(row?response(JSON.parse(row.receipt_json)):response({error:'NOT_FOUND'},404));
   }
   if(!['/api/v0.1/verify','/api/v0.1/commit'].includes(path))return finish(response({error:'NOT_FOUND'},404));
   if(req.method!=='POST')return finish(response({error:'METHOD_NOT_ALLOWED'},405,{Allow:'POST'}));
   if(!env.NUMINA_RECEIPT_PRIVATE_JWK)throw new Error('RECEIPT_SIGNING_UNAVAILABLE');
   const envelope=await readEnvelope(req),hash=await digest(envelope);
   let result=await verifyCredential(envelope,[DEMO_KEY],now),durable=false,receipt;
   if(result.outcome==='VALID_FOR_COMMIT'&&await replay(env.DB,envelope.credential))result=decision('INVALID','REPLAY_DETECTED');
   if(path.endsWith('/commit')&&result.outcome==='VALID_FOR_COMMIT') {
    receipt=await receiptFor(env,result,hash,requestId,'SIMULATED_COMMIT',now);
    durable=await commitEvent(env.DB,envelope.credential,hash,receipt,now);
    if(!durable){result=await replay(env.DB,envelope.credential)?decision('INVALID','REPLAY_DETECTED'):decision('REVALIDATION_REQUIRED',envelope.credential.expiresAt<=Math.floor(Date.now()/1000)?'EXPIRED':'LEDGER_CAPACITY');receipt=null;}
   }
   if(!receipt)receipt=await receiptFor(env,result,hash,requestId,result.outcome==='VALID_FOR_COMMIT'?'VERIFICATION':'VIOLATION',now);
   if(result.outcome!=='VALID_FOR_COMMIT')durable=await storeViolation(env.DB,receipt,now);
   outcome=result.outcome;reason=result.reason;
   console.log(JSON.stringify({event:'authority_decision',requestId,version:VERSION,outcome,reason,credentialHash:hash,receiptId:receipt.receipt.id,durable}));
   return finish(response({...result,committed:path.endsWith('/commit')&&result.outcome==='VALID_FOR_COMMIT',receipt,persisted:durable,receiptUrl:durable?'/api/v0.1/receipts/'+receipt.receipt.id:null},result.outcome==='VALID_FOR_COMMIT'?200:result.outcome==='INVALID'?422:409));
  } catch(e) { reason=e.reason||'DEPENDENCY_UNAVAILABLE';outcome=e.status?'INVALID':'REVALIDATION_REQUIRED';return finish(response({...decision(outcome,reason),requestId},e.status||503)); }
  finally {if(path.startsWith('/api/'))console.log(JSON.stringify({event:'http_request',requestId,version:VERSION,route:path.replace(/\/receipts\/.*/, '/receipts/:id').slice(0,120),method:req.method,status,outcome,reason,durationMs:Date.now()-start}));}
 }
};
