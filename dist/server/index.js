const VERSION = '0.2.0';
const PROFILE = Object.freeze({id:'numina-demo-rp-0.1',version:'0.1',environment:'test',issuer:'numina-demo',audience:'numina-demo-gateway',action:'simulate.commit',maxLifetimeSeconds:600,keyPurpose:'eac-test-authorization',canonicalization:'numina-ascii-json-v0.1',invariants:'Frozen v0.2 source preserved; full hosted enforcement not claimed'});
const encoder = new TextEncoder();
function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value,-0)) return String(value);
  if (typeof value === 'string' && /^[\x20-\x7e]*$/.test(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{'+Object.keys(value).sort().map(k=>canonical(k)+':'+canonical(value[k])).join(',')+'}';
  throw new Error('NON_CANONICAL_VALUE');
}
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
function unb64(s) { if (typeof s!=='string'||!s.length||!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('BASE64'); const b=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)); if(b64(b)!==s)throw new Error('BASE64'); return b; }
async function digest(x) { return b64(await crypto.subtle.digest('SHA-256',encoder.encode(typeof x==='string'?x:canonical(x)))); }
function exact(o,keys) { return o && !Array.isArray(o) && typeof o==='object' && Object.keys(o).sort().join(',')===keys.split(',').sort().join(','); }
const token = s => typeof s==='string' && /^[A-Za-z0-9:_-]{1,100}$/.test(s);
function schema(e) {
  if(!exact(e,'credential,signature')||!exact(e.signature,'alg,kid,purpose,value'))return false;
  const c=e.credential,s=e.signature;
  if(!exact(c,'version,environment,issuer,subject,audience,profile,action,resource,eventId,nonce,issuedAt,notBefore,expiresAt')) return false;
  if(!['version','environment','issuer','subject','audience','profile','action','resource','eventId','nonce'].every(k=>typeof c[k]==='string'&&c[k].length<=100))return false;
  if(!['subject','eventId','nonce'].every(k=>token(c[k]))||c.nonce.length<22)return false;
  if(!['issuedAt','notBefore','expiresAt'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0))return false;
  return s.alg==='Ed25519'&&token(s.kid)&&token(s.purpose)&&typeof s.value==='string'&&/^[A-Za-z0-9_-]{86}$/.test(s.value);
}
const decision=(outcome,reason)=>({outcome,reason,profile:PROFILE.id,version:VERSION,scope:'test-only'});
async function verifyCredential(e,keys,now=Math.floor(Date.now()/1000)) {
  if(!schema(e))return decision('INVALID','SCHEMA_INVALID');
  const c=e.credential,s=e.signature;
  const k=keys.find(k=>k.kid===s.kid);
  if(!k)return decision('INVALID','UNTRUSTED_KEY');
  if(s.purpose!==PROFILE.keyPurpose||k.purpose!==s.purpose||k.issuer!==c.issuer)return decision('INVALID','KEY_PURPOSE_OR_ISSUER');
  if(k.revoked)return decision('INVALID','KEY_REVOKED');
  try { const pk=await crypto.subtle.importKey('jwk',k.jwk,{name:'Ed25519'},false,['verify']); if(!await crypto.subtle.verify('Ed25519',pk,unb64(s.value),encoder.encode(canonical({credential:c,protected:{alg:s.alg,kid:s.kid,purpose:s.purpose}}))))return decision('INVALID','SIGNATURE_INVALID'); } catch {return decision('INVALID','SIGNATURE_INVALID');}
  if(c.version!=='0.1'||c.environment!=='test'||c.issuer!==PROFILE.issuer||c.audience!==PROFILE.audience||c.action!==PROFILE.action||c.resource!=='demo:ledger')return decision('INVALID','SCOPE_DENIED');
  if(c.profile!==PROFILE.id)return decision('REVALIDATION_REQUIRED','PROFILE_CHANGED');
  if(c.issuedAt>c.notBefore||c.notBefore>=c.expiresAt||c.expiresAt-c.issuedAt>PROFILE.maxLifetimeSeconds)return decision('INVALID','TIME_RANGE_INVALID');
  if(c.issuedAt>now||c.notBefore>now)return decision('REVALIDATION_REQUIRED','NOT_YET_VALID');
  if(c.expiresAt<=now)return decision('REVALIDATION_REQUIRED','EXPIRED');
  return decision('VALID_FOR_COMMIT','TEST_AUTHORITY_VALID');
}
async function signCredential(c,jwk,kid='numina-demo-eac-1') {
  const protectedHeader={alg:'Ed25519',kid,purpose:PROFILE.keyPurpose};
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'Ed25519'},false,['sign']);
  const value=b64(await crypto.subtle.sign('Ed25519',key,encoder.encode(canonical({credential:c,protected:protectedHeader}))));
  return {credential:c,signature:{...protectedHeader,value}};
}
function freshCredential(now=Math.floor(Date.now()/1000)) {return {version:'0.1',environment:'test',issuer:PROFILE.issuer,subject:'demo-user',audience:PROFILE.audience,profile:PROFILE.id,action:PROFILE.action,resource:'demo:ledger',eventId:crypto.randomUUID(),nonce:crypto.randomUUID(),issuedAt:now,notBefore:now,expiresAt:now+300};}

const SCHEMA = [
 'CREATE TABLE IF NOT EXISTS numina_events_v1 (event_id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, credential_hash TEXT NOT NULL, receipt_id TEXT NOT NULL UNIQUE, receipt_json TEXT NOT NULL, created_at INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS numina_violations_v1 (receipt_id TEXT PRIMARY KEY, receipt_json TEXT NOT NULL, created_at INTEGER NOT NULL)',
 'CREATE TABLE IF NOT EXISTS numina_limits_v1 (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
 'CREATE INDEX IF NOT EXISTS numina_limits_expiry_v1 ON numina_limits_v1(expires_at)'
];
async function initialize(db) { if(!db)throw new Error('STORAGE_UNAVAILABLE'); await db.prepare('SELECT 1 FROM numina_events_v1 LIMIT 1').first(); }
async function rateLimit(db,ip,now) {
  const window=Math.floor(now/60), expiry=(window+1)*60;
  const sql='INSERT INTO numina_limits_v1(bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count';
  const rows=await db.batch([db.prepare('DELETE FROM numina_limits_v1 WHERE expires_at < ?').bind(now), db.prepare(sql).bind('global:'+window,expiry)]);
  if(rows[1].results[0].count>300)return false;
  const personal=await db.prepare(sql).bind(ip+':'+window,expiry).first();
  return personal.count<=30;
}
async function replay(db,c) {return !!await db.prepare('SELECT event_id FROM numina_events_v1 WHERE event_id=? OR nonce=? LIMIT 1').bind(c.eventId,c.nonce).first();}
async function commitEvent(db,c,hash,receipt,now) {
  const r=await db.prepare('INSERT INTO numina_events_v1(event_id,nonce,credential_hash,receipt_id,receipt_json,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM numina_events_v1)<10000 AND ? > unixepoch() ON CONFLICT DO NOTHING RETURNING event_id').bind(c.eventId,c.nonce,hash,receipt.receipt.id,JSON.stringify(receipt),now,c.expiresAt).all();
  return r.results.length===1;
}
async function storeViolation(db,receipt,now) { const r=await db.prepare('INSERT INTO numina_violations_v1(receipt_id,receipt_json,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM numina_violations_v1)<10000 RETURNING receipt_id').bind(receipt.receipt.id,JSON.stringify(receipt),now).all(); return r.results.length===1; }
async function coverage(db) {
  const count=await db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN receipt_json IS NULL OR json_valid(receipt_json)=0 THEN 1 ELSE 0 END),0) AS missing FROM numina_events_v1').first();
  return {scope:'demo ledger only',registeredEndpoints:['POST /api/v0.1/commit'],events:count.total,eventsWithoutReceipt:count.missing,bypassDetected:count.missing>0,assurance:'Structural receipt presence only; database-admin writes and systems outside this ledger are not covered.',externalExecution:'disabled',constitutionalConformance:'Frozen source preserved; full hosted enforcement not established'};
}

const DEMO_KEY={"kid":"numina-demo-eac-1","purpose":"eac-test-authorization","issuer":"numina-demo","jwk":{"crv":"Ed25519","x":"i5RQlrCzD4rCOHRKkWLf_7njALDaboOfEcO4ilWiZIQ","kty":"OKP"},"warning":"PUBLIC TEST KEY. Never use for real authority."};
const CONFORMANCE={"suite":"numina-implementation-v0.1","passed":20,"total":20,"results":[{"name":"valid","pass":true},{"name":"wrong environment","pass":true},{"name":"wrong audience","pass":true},{"name":"wrong action","pass":true},{"name":"wrong resource","pass":true},{"name":"wrong issuer","pass":true},{"name":"profile changed","pass":true},{"name":"expired","pass":true},{"name":"not yet valid","pass":true},{"name":"lifetime exceeded","pass":true},{"name":"inverted window","pass":true},{"name":"issuance after activation","pass":true},{"name":"short nonce","pass":true},{"name":"unsupported version","pass":true},{"name":"extra field","pass":true},{"name":"fractional time","pass":true},{"name":"tampered signature","pass":true},{"name":"untrusted key","pass":true},{"name":"wrong key purpose","pass":true},{"name":"unsupported algorithm","pass":true}]};

const CORE_MANIFEST={"coreVersion": "1.8.0", "archiveSha256": "721df2152065a43c887c5e42910c6b86bd734338c56d20436861765f5cfc3929", "constitutionSource": "specs/AUTHORITY-PHYSICS-v0.2.md", "constitutionSha256": "38be7b9764e717a4898463f5ce2063252ce8b1e2bc7cb234361ef8b4c8fabe1d", "invariants": [{"id": "C1", "name": "Authority Non-Creation"}, {"id": "C2", "name": "Attenuation"}, {"id": "C3", "name": "Exclusive Occupancy"}, {"id": "C4", "name": "Commit Uniqueness"}, {"id": "C5", "name": "Reality Preservation"}, {"id": "C6", "name": "No Optimistic Release"}, {"id": "C7", "name": "Finality Non-Bootstrapping"}, {"id": "C8", "name": "Dependency Closure"}, {"id": "C9", "name": "Historical Immutability"}, {"id": "C10", "name": "Administrative Non-Sovereignty"}, {"id": "C11", "name": "Atomic Transition"}, {"id": "C12", "name": "Projection Equivalence"}, {"id": "C13", "name": "Deterministic Projection"}, {"id": "C14", "name": "Recovery Reachability"}], "sourceTests": {"runner": "unittest + zero-argument functions; pytest.raises adapted, not pytest", "testsRun": 309, "failures": 0, "errors": 0, "manifestFiles": 106, "manifestMismatches": ["./__pycache__/numina_core.cpython-313.pyc", "./__pycache__/test_numina_core.cpython-313-pytest-9.0.2.pyc"], "zipSha256": "721df2152065a43c887c5e42910c6b86bd734338c56d20436861765f5cfc3929"}, "hostedScope": ["signed reference EAC verification with test-profile narrowing", "observational margin assessment"], "notHosted": ["Python institutional runtime", "rights creation and contracting", "clearing state transitions", "financial execution"], "kernelDecisions": ["ALLOW", "DENY", "ESCALATE"], "eacOutcomes": ["VALID_FOR_COMMIT", "INVALID", "REVALIDATION_REQUIRED"]};
const CORE_CONTEXT={"sequence": 100, "issuer": "numina-demo", "constitutionDigest": "38be7b9764e717a4898463f5ce2063252ce8b1e2bc7cb234361ef8b4c8fabe1d", "dependencyRoot": "99792641a2c2ed0959066935ade30b51008b0d7a840e85d30c7afcc612a85486", "preStateDigest": "94f907a31249bfa086ae8518ffbc9efede83b4b3c6f2e1abc331a2233a5dc358"};

// HTTP adapter for the supplied Numina Core v1.8. Original Python source stays in vendor/.
// Integer quantities remain BigInt internally; signed canonical bytes are never rounded.
const integerFields=['max_quantity_wei','max_price_usd_minor_per_eth','max_notional_usd_minor','issued_sequence','valid_until_sequence'];
const stringFields=['authorization_id','operation_id','principal_id','agent_id','mandate_id','asset','side','rail','nonce','dependency_root','pre_state_digest','constitution_digest','issuer_id'];
function coreCanonical(o){return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+(typeof o[k]==='bigint'?String(o[k]):JSON.stringify(o[k]))).join(',')+'}';}
function parseCoreCredential(raw){
 if(typeof raw!=='string'||raw.length>5000||!/^[\x20-\x7e]+$/.test(raw))throw Error('CORE_SCHEMA_INVALID');
 let offset=1;const c={},pattern=/"([a-z_]+)":("(?:[^"\\]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"|-?(?:0|[1-9][0-9]*))/y;
 if(raw[0]!=='{'||raw.at(-1)!=='}')throw Error('CORE_SCHEMA_INVALID');
 while(offset<raw.length-1){pattern.lastIndex=offset;const m=pattern.exec(raw);if(!m||Object.hasOwn(c,m[1]))throw Error('CORE_SCHEMA_INVALID');c[m[1]]=m[2][0]==='"'?JSON.parse(m[2]):BigInt(m[2]);offset=pattern.lastIndex;if(raw[offset]===',')offset++;else if(offset!==raw.length-1)throw Error('CORE_SCHEMA_INVALID');}
 if(!exact(c,[...integerFields,...stringFields].join(','))||coreCanonical(c)!==raw)throw Error('CORE_SCHEMA_INVALID');
 if(!integerFields.every(k=>typeof c[k]==='bigint'&&c[k]>=0n&&c[k]<10n**38n)||!stringFields.every(k=>typeof c[k]==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(c[k])))throw Error('CORE_SCHEMA_INVALID');
 return c;
}
async function verifyCoreEac(packet,context=CORE_CONTEXT){
 let c;try{if(!exact(packet,'credentialJson,signatureHex,kid')||packet.kid!==DEMO_KEY.kid||!/^[0-9a-f]{128}$/.test(packet.signatureHex))throw 0;c=parseCoreCredential(packet.credentialJson);}catch{return decision('INVALID','CORE_SCHEMA_INVALID');}
 // Preserve the reference recognition/sequence/replay precedence. Context belongs to the server.
 if(c.issuer_id!==context.issuer)return decision('INVALID','UNRECOGNIZED_ISSUER');
 if(c.constitution_digest!==context.constitutionDigest)return decision('INVALID','UNRECOGNIZED_CONSTITUTION');
 if(c.rail!=='SIM_A')return decision('INVALID','UNRECOGNIZED_RAIL');
 if(BigInt(context.sequence)>c.valid_until_sequence)return decision('REVALIDATION_REQUIRED','EXPIRED');
 if(BigInt(context.sequence)-c.issued_sequence>32n)return decision('REVALIDATION_REQUIRED','STATUS_STALE');
 const pk=await crypto.subtle.importKey('jwk',DEMO_KEY.jwk,'Ed25519',false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',pk,Uint8Array.from(packet.signatureHex.match(/../g),x=>parseInt(x,16)),encoder.encode(packet.credentialJson)))return decision('INVALID','INVALID_SIGNATURE');
 // Deployment profile narrows the reference: exact synthetic context, BUY/ETH and fixed bounds.
 if(c.issued_sequence>BigInt(context.sequence)||c.valid_until_sequence<c.issued_sequence)return decision('REVALIDATION_REQUIRED','SEQUENCE_INVALID');
 if(c.dependency_root!==context.dependencyRoot||c.pre_state_digest!==context.preStateDigest)return decision('REVALIDATION_REQUIRED','CONTEXT_CHANGED');
 if(c.asset!=='ETH'||c.side!=='BUY'||c.max_price_usd_minor_per_eth<=0n||c.max_notional_usd_minor>2000000n||c.max_quantity_wei*c.max_price_usd_minor_per_eth/1000000000000000000n>c.max_notional_usd_minor)return decision('INVALID','BOUNDS_DENIED');
 return {...decision('VALID_FOR_COMMIT','CORE_TEST_EAC_VALID'),coreVersion:'1.8.0',kernelDecision:'NOT_EVALUATED',commitAvailable:false,recognition:'reference EAC plus narrowing test profile; no core state transition'};
}
function assessStability(input){
 if(!exact(input,'exposure,eligibleCollateral,settlementCapacity,maintenanceBps,callBufferBps,maxCallAmount')||!Object.values(input).every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000000000)||input.maintenanceBps>10000||input.callBufferBps>10000)throw {status:400,reason:'STABILITY_SCHEMA_INVALID'};
 const i=Object.fromEntries(Object.entries(input).map(([k,v])=>[k,BigInt(v)]));
 const required=(i.exposure*i.maintenanceBps+9999n)/10000n,support=i.eligibleCollateral+i.settlementCapacity,deficiency=required>support?required-support:0n,buffered=deficiency+(deficiency*i.callBufferBps+9999n)/10000n;
 return {coreVersion:'1.8.0',scope:'observation-only synthetic inputs',requiredSupport:Number(required),deficiency:Number(deficiency),state:deficiency===0n?'HEALTHY':support>0n?'CALL_REQUIRED':'DEFAULT_PENDING',proposedCallAmount:Number(buffered<i.maxCallAmount?buffered:i.maxCallAmount),authorityChanged:false,callIssued:false};
}

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
async function signingReady(env){try{const privateKey=await crypto.subtle.importKey('jwk',JSON.parse(env.NUMINA_RECEIPT_PRIVATE_JWK),'Ed25519',false,['sign']);const publicKey=await crypto.subtle.importKey('jwk',JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK),'Ed25519',false,['verify']);const challenge=encoder.encode('numina-readiness-v1');return await crypto.subtle.verify('Ed25519',publicKey,await crypto.subtle.sign('Ed25519',privateKey,challenge),challenge);}catch{return false;}}
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
   if(path==='/api/v0.1/status'&&req.method==='GET'){const ready=await signingReady(env);return finish(response({status:ready?'ready':'degraded',version:VERSION,coreVersion:'1.8.0',storage:'available',receiptSigning:ready,financialExecution:false,constitutionalConformance:'SOURCE_PRESERVED_HOSTED_SCOPE_LIMITED',limits:{bodyBytes:LIMIT,requestsPerMinutePerIp:30,requestsPerMinuteGlobal:300,maxEvents:10000},coverage:await coverage(env.DB)},ready?200:503));}
   if(path==='/api/v0.1/profile'&&req.method==='GET')return finish(response(PROFILE));
   if(path==='/api/v0.1/keys'&&req.method==='GET')return finish(response({keys:[DEMO_KEY,...(env.NUMINA_RECEIPT_PUBLIC_JWK?[{kid:'numina-receipt-1',purpose:'external-test-receipt',jwk:JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)}]:[])],warning:'EAC key is intentionally public test material. Receipt keys cannot authorize credentials.'}));
   if(path==='/api/v0.1/conformance'&&req.method==='GET')return finish(response({version:VERSION,scope:'implementation conformance; not constitutional certification',report:CONFORMANCE,harness:'/downloads/conformance.mjs',vectors:'/downloads/conformance-vectors.json'}));
   if(path==='/api/v0.1/coverage'&&req.method==='GET')return finish(response(await coverage(env.DB)));
   if(path==='/api/core/v1.8/manifest'&&req.method==='GET')return finish(response(CORE_MANIFEST));
   if(path==='/api/core/v1.8/context'&&req.method==='GET')return finish(response(CORE_CONTEXT));
   if(['/api/core/v1.8/eac/verify','/api/core/v1.8/stability/assess'].includes(path)){
    if(req.method!=='POST')return finish(response({error:'METHOD_NOT_ALLOWED'},405,{Allow:'POST'}));
    const input=await readEnvelope(req);
    if(path.endsWith('/assess'))return finish(response(assessStability(input)));
    const result=await verifyCoreEac(input);outcome=result.outcome;reason=result.reason;
    return finish(response(result,result.outcome==='VALID_FOR_COMMIT'?200:result.outcome==='INVALID'?422:409));
   }
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
