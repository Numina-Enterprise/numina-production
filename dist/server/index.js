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

// The only production state machine. No network effects or device-local authority.
const CONTROL_VERSION = '1.0.0';
const CONTROL_SCOPES = ['request.create','evidence.attest','evidence.resolve','record.write','authority.delegate'];
const CONTROL_ADAPTER = {id:'internal.record.v1',version:1,action:'record.write',externalExecution:false};
function stable(value) {
  if(value===null || typeof value==='boolean') return JSON.stringify(value);
  if(typeof value==='number' && Number.isSafeInteger(value) && !Object.is(value,-0)) return String(value);
  if(typeof value==='string') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value && Object.getPrototypeOf(value)===Object.prototype) return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  throw new Error('INVALID_CANONICAL_VALUE');
}
async function controlHash(value) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:stable(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
function controlError(code,status=422) {throw Object.assign(new Error(code),{status,code});}
function demand(ok,code,status=422){if(!ok)controlError(code,status);}
function textField(value,max=160){return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);}
function controlExact(obj,keys){demand(obj&&Object.getPrototypeOf(obj)===Object.prototype&&Object.keys(obj).every(k=>keys.includes(k)),'UNKNOWN_FIELDS');}
function resourceWithin(resource,prefix){return prefix==='*'||resource.startsWith(prefix);}
function prefixWithin(child,parent){return parent==='*'||(child!=='*'&&child.startsWith(parent));}
function initialControlState(owner,now) {
  return {schema:1,root:owner,createdAt:now,grants:[{id:'root',parent:null,subject:owner,scopes:[...CONTROL_SCOPES],resourcePrefix:'*',expiresAt:253402300799,revoked:false}],requests:[],evidence:[],records:[]};
}
function grantValid(state,grant,now,seen=new Set()) {
  if(!grant||seen.has(grant.id)||seen.size>=8||grant.revoked||grant.expiresAt<=now)return false;
  if(grant.id==='root')return grant.parent===null&&grant.subject===state.root;
  seen.add(grant.id);const parent=state.grants.find(g=>g.id===grant.parent);
  return !!parent&&grantValid(state,parent,now,seen)&&parent.scopes.includes('authority.delegate')&&grant.scopes.every(s=>parent.scopes.includes(s))&&prefixWithin(grant.resourcePrefix,parent.resourcePrefix)&&grant.expiresAt<=parent.expiresAt;
}
function authorizeControl(state,actor,scope,resource,now,grantId) {
  return state.grants.find(g=>(!grantId||g.id===grantId)&&g.subject===actor&&g.scopes.includes(scope)&&resourceWithin(resource,g.resourcePrefix)&&grantValid(state,g,now))||null;
}
function authorized(state,actor,scope,resource,now,grantId){const grant=authorizeControl(state,actor,scope,resource,now,grantId);demand(grant,'AUTHORITY_DENIED',403);return grant;}
function normalizeRecord(input) {
  controlExact(input,['resource','payload']);demand(textField(input.resource,160)&&/^record:[a-zA-Z0-9_.:/-]+$/.test(input.resource),'INVALID_RESOURCE');
  demand(textField(input.payload,4000),'INVALID_PAYLOAD');
  const canonical={resource:input.resource,payload:input.payload};
  demand(stable(JSON.parse(stable(canonical)))===stable(input),'ADAPTER_SEMANTIC_LOSS');return canonical;
}
function selectedEvidence(state,request,key,now,visiting=new Set(),memo=new Map()){
  if(memo.has(key))return memo.get(key);
  if(visiting.has(key))return {reason:'EVIDENCE_DEPENDENCY_CYCLE'};
  visiting=new Set(visiting);visiting.add(key);
  const nodes=state.evidence.filter(e=>e.kind==='attestation'&&e.requestId===request.id&&e.key===key);
  if(!nodes.length)return {reason:'MISSING_EVIDENCE'};
  const resolution=state.evidence.filter(e=>e.kind==='resolution'&&e.requestId===request.id&&e.key===key&&authorizeControl(state,e.actor,'evidence.resolve',request.wants.resource,now,e.grantId)).at(-1);
  let active=nodes;
  if(resolution){const selected=nodes.find(e=>e.id===resolution.selectedId);const later=nodes.filter(e=>e.sequence>resolution.sequence);active=[selected,...later].filter(Boolean);}
  if(new Set(active.map(e=>e.value)).size>1)return {reason:'CONTRADICTORY_EVIDENCE'};
  const valid=active.filter(e=>e.expiresAt>now&&authorizeControl(state,e.actor,'evidence.attest',request.wants.resource,now,e.grantId)&&e.parents.every(id=>{
    const parent=state.evidence.find(p=>p.id===id);if(!parent||parent.kind!=='attestation'||parent.key===key)return false;
    const selected=selectedEvidence(state,request,parent.key,now,visiting,memo);return !!selected.nodes?.some(p=>p.id===id);
  }));
  const result=valid.length?{nodes:valid}:{reason:'STALE_EVIDENCE'};memo.set(key,result);return result;
}
function reconcileControl(state,now) {
  // One event-driven loop; all decision projections are derived from current state.
  return state.requests.map(request=>{
    if(request.execution.state==='committed')return {requestId:request.id,outcome:'ALLOW',reason:'INTERNAL_RECORD_COMMITTED',action:null};
    if(!authorizeControl(state,request.who,'record.write',request.wants.resource,now,request.authority))return {requestId:request.id,outcome:'DENY',reason:'AUTHORITY_UNAVAILABLE',action:null};
    if(request.route!==CONTROL_ADAPTER.id)return {requestId:request.id,outcome:'ESCALATE',reason:'UNSUPPORTED_ADAPTER',action:null};
    for(const key of request.policy.requiredEvidence){const result=selectedEvidence(state,request,key,now);if(result.reason)return {requestId:request.id,outcome:'ESCALATE',reason:result.reason,action:null};}
    return {requestId:request.id,outcome:'ALLOW',reason:'BOUNDS_AND_EVIDENCE_VERIFIED',action:'record.write'};
  });
}
async function verifiedActions(state,revision,now,actor) {
  const stateHash=await controlHash(state);const decisions=reconcileControl(state,now);
  return Promise.all(decisions.map(async d=>{
    const request=state.requests.find(r=>r.id===d.requestId);
    const canAct=!!authorizeControl(state,actor,'record.write',request.wants.resource,now);
    const next=d.action&&canAct?{kind:d.action,requestId:request.id,expectedRevision:revision,adapter:CONTROL_ADAPTER.id,actionId:await controlHash({revision,stateHash,requestId:request.id,actor,kind:d.action})}:null;
    return {...d,nextAction:next};
  }));
}
async function reduceControl(current,command,actor,revision,now) {
  controlExact(command,['id','expectedRevision','type','data']);demand(textField(command.id,100)&&/^[a-zA-Z0-9_-]+$/.test(command.id),'INVALID_COMMAND_ID');
  demand(command.expectedRevision===revision,'STALE_REVISION',409);demand(Number.isSafeInteger(now)&&now>0,'INVALID_TIME');
  const state=structuredClone(current),data=command.data;let result={};let parentIds=[];
  demand(data&&Object.getPrototypeOf(data)===Object.prototype,'INVALID_COMMAND');
  if(command.type==='request'){
    controlExact(data,['id','route','wants','requiredEvidence','grantId']);const wants=normalizeRecord(data.wants);
    demand(textField(data.id,100)&&!state.requests.some(r=>r.id===data.id),'REQUEST_ID_CONFLICT');demand(textField(data.route,100),'INVALID_ROUTE');
    demand(Array.isArray(data.requiredEvidence)&&data.requiredEvidence.length<=10&&data.requiredEvidence.every(k=>textField(k,80))&&new Set(data.requiredEvidence).size===data.requiredEvidence.length,'INVALID_EVIDENCE_REQUIREMENTS');
    authorized(state,actor,'request.create',wants.resource,now,data.grantId);const grant=authorized(state,actor,'record.write',wants.resource,now,data.grantId);
    state.requests.push({id:data.id,who:actor,wants,authority:grant.id,policy:{requiredEvidence:data.requiredEvidence},route:data.route,evidence:[],execution:{state:'pending'},settlement:{state:'not_applicable'},verifiedOutcome:null,createdAt:now});result={requestId:data.id};
  }else if(command.type==='attest'){
    controlExact(data,['requestId','key','value','expiresAt','parents']);const request=state.requests.find(r=>r.id===data.requestId);demand(request,'REQUEST_NOT_FOUND',404);demand(request.execution.state==='pending','REQUEST_FINAL',409);
    const grant=authorized(state,actor,'evidence.attest',request.wants.resource,now);demand(request.policy.requiredEvidence.includes(data.key)&&textField(data.value,2000),'INVALID_ATTESTATION');
    demand(Number.isSafeInteger(data.expiresAt)&&data.expiresAt>now&&data.expiresAt<=Math.min(now+86400,grant.expiresAt),'INVALID_EVIDENCE_EXPIRY');
    demand(Array.isArray(data.parents)&&data.parents.length<=10&&new Set(data.parents).size===data.parents.length&&data.parents.every(id=>state.evidence.some(e=>e.id===id&&e.requestId===request.id&&e.kind==='attestation'&&e.key!==data.key)),'INVALID_EVIDENCE_PARENTS');
    const node={id:command.id,sequence:revision+1,kind:'attestation',actor,grantId:grant.id,requestId:request.id,key:data.key,value:data.value,expiresAt:data.expiresAt,parents:data.parents,at:now,provenance:{source:'authenticated-operator',externalVerification:false}};
    node.hash=await controlHash(node);state.evidence.push(node);request.evidence.push(node.id);parentIds=[node.id];result={evidenceId:node.id};
  }else if(command.type==='resolve'){
    controlExact(data,['requestId','key','selectedId','reason']);const request=state.requests.find(r=>r.id===data.requestId);demand(request,'REQUEST_NOT_FOUND',404);demand(request.execution.state==='pending','REQUEST_FINAL',409);
    const grant=authorized(state,actor,'evidence.resolve',request.wants.resource,now);demand(textField(data.reason,1000),'RESOLUTION_REASON_REQUIRED');
    const nodes=state.evidence.filter(e=>e.kind==='attestation'&&e.requestId===request.id&&e.key===data.key);demand(nodes.some(e=>e.id===data.selectedId),'EVIDENCE_NOT_FOUND');
    const node={id:command.id,sequence:revision+1,kind:'resolution',actor,grantId:grant.id,requestId:request.id,key:data.key,selectedId:data.selectedId,reason:data.reason,parents:nodes.map(e=>e.id),at:now};node.hash=await controlHash(node);state.evidence.push(node);request.evidence.push(node.id);parentIds=[node.id];result={evidenceId:node.id};
  }else if(command.type==='delegate'){
    controlExact(data,['id','parent','subject','scopes','resourcePrefix','expiresAt']);const parent=state.grants.find(g=>g.id===data.parent);
    demand(parent&&parent.subject===actor&&grantValid(state,parent,now)&&parent.scopes.includes('authority.delegate'),'AUTHORITY_DENIED',403);
    demand(textField(data.id,100)&&!state.grants.some(g=>g.id===data.id),'GRANT_ID_CONFLICT');demand(textField(data.subject,254)&&/^email:[^\s@]+@[^\s@]+$/.test(data.subject),'INVALID_SUBJECT');
    demand(Array.isArray(data.scopes)&&data.scopes.length>0&&new Set(data.scopes).size===data.scopes.length&&data.scopes.every(s=>parent.scopes.includes(s)),'AUTHORITY_BROADENING');
    demand(textField(data.resourcePrefix,160)&&prefixWithin(data.resourcePrefix,parent.resourcePrefix),'AUTHORITY_BROADENING');
    demand(Number.isSafeInteger(data.expiresAt)&&data.expiresAt>now&&data.expiresAt<=parent.expiresAt&&data.expiresAt<=now+2592000,'AUTHORITY_BROADENING');
    const grant={...data,revoked:false};state.grants.push(grant);demand(grantValid(state,grant,now),'INVALID_GRANT_CHAIN');result={grantId:grant.id};
  }else if(command.type==='revoke'){
    controlExact(data,['grantId']);const grant=state.grants.find(g=>g.id===data.grantId);demand(grant&&grant.id!=='root','INVALID_GRANT');
    const parent=state.grants.find(g=>g.id===grant.parent);demand(actor===state.root||(parent?.subject===actor&&grantValid(state,parent,now)),'AUTHORITY_DENIED',403);grant.revoked=true;result={grantId:grant.id};
  }else if(command.type==='execute'){
    controlExact(data,['requestId','actionId']);const request=state.requests.find(r=>r.id===data.requestId);demand(request,'REQUEST_NOT_FOUND',404);authorized(state,actor,'record.write',request.wants.resource,now);
    const projected=(await verifiedActions(state,revision,now,actor)).find(d=>d.requestId===request.id);demand(projected.nextAction&&projected.nextAction.actionId===data.actionId,'NEXT_ACTION_NOT_VERIFIED',409);
    const normalized=normalizeRecord(request.wants);demand(!state.records.some(r=>r.requestId===request.id),'ALREADY_COMMITTED',409);
    const node={id:command.id,sequence:revision+1,kind:'execution',requestId:request.id,actor,at:now,adapter:CONTROL_ADAPTER.id,adapterVersion:1,parents:[...request.evidence],inputHash:await controlHash(normalized),outcome:'INTERNAL_RECORD_COMMITTED'};
    node.hash=await controlHash(node);state.evidence.push(node);request.evidence.push(node.id);state.records.push({...normalized,requestId:request.id,evidenceId:node.id,at:now});
    request.execution={state:'committed',recordId:request.id};request.verifiedOutcome={scope:'internal.record.v1',evidenceId:node.id,externalExecution:false};parentIds=[node.id];result={requestId:request.id,recordId:request.id,evidenceId:node.id};
  }else if(command.type==='reconcile'){
    controlExact(data,[]);demand(state.grants.some(g=>g.subject===actor&&grantValid(state,g,now)),'AUTHORITY_DENIED',403);result={reconciled:true};
  }else controlError('UNKNOWN_COMMAND');
  demand(state.requests.length<=100&&state.grants.length<=100&&state.evidence.length<=400,'STATE_CAPACITY',409);
  demand(new TextEncoder().encode(stable(state)).byteLength<=524288,'STATE_CAPACITY',409);
  return {state,result,parents:parentIds,decisions:reconcileControl(state,now)};
}

const CONTROL_SCHEMA=[
 'CREATE TABLE numina_control_state (id INTEGER PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, state_json TEXT NOT NULL, state_hash TEXT NOT NULL, head_hash TEXT NOT NULL, mutation_id TEXT NOT NULL)',
 'CREATE TABLE numina_control_events (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, command_hash TEXT NOT NULL, event_json TEXT NOT NULL, hash TEXT NOT NULL)',
 'CREATE UNIQUE INDEX numina_control_event_revision ON numina_control_events(revision)'
];
async function readControl(db){
  if(!db)controlError('STORAGE_UNAVAILABLE',503);
  const [stateRows,events]=await db.batch([db.prepare('SELECT * FROM numina_control_state WHERE id=1'),db.prepare('SELECT id,revision,hash,event_json FROM numina_control_events ORDER BY revision')]);
  const row=stateRows.results[0];if(!row)controlError('CONTROL_NOT_INITIALIZED',503);
  let state;try{state=JSON.parse(row.state_json);}catch{controlError('STATE_CORRUPT',503);}
  if(state.schema!==1||!Array.isArray(state.grants)||!Array.isArray(state.requests)||!Array.isArray(state.evidence)||!Array.isArray(state.records)||await controlHash(state)!==row.state_hash)controlError('STATE_CORRUPT',503);
  let previous=null,index=0,lastEvent;
  for(const entry of events.results){let event;try{event=JSON.parse(entry.event_json);}catch{controlError('JOURNAL_CORRUPT',503);}
    if(entry.revision!==index++||event.revision!==entry.revision||event.id!==entry.id||event.previous!==previous||await controlHash(event)!==entry.hash)controlError('JOURNAL_CORRUPT',503);previous=entry.hash;lastEvent=event;
  }
  if(index!==row.revision+1||previous!==row.head_hash||lastEvent?.id!==row.mutation_id||lastEvent?.stateHash!==row.state_hash)controlError('EVIDENCE_HEAD_CORRUPT',503);
  for(const node of state.evidence){const {hash,...value}=node;if(await controlHash(value)!==hash)controlError('EVIDENCE_CORRUPT',503);}
  return {...row,state,eventCount:index};
}
async function bootstrapControl(db,owner,now){
  const count=await db.prepare('SELECT COUNT(*) AS n FROM numina_control_events').first();if(count.n!==0)controlError('ALREADY_INITIALIZED',409);
  const state=initialControlState(owner,now),stateHash=await controlHash(state),event={id:'genesis',revision:0,actor:owner,at:now,type:'bootstrap',previous:null,stateHash};const hash=await controlHash(event);
  try{await db.batch([
    db.prepare('INSERT INTO numina_control_state(id,revision,state_json,state_hash,head_hash,mutation_id) VALUES(1,0,?,?,?,?)').bind(stable(state),stateHash,hash,'genesis'),
    db.prepare('INSERT INTO numina_control_events(id,revision,actor,command_hash,event_json,hash) VALUES(?,0,?,?,?,?)').bind('genesis',owner,await controlHash({type:'bootstrap',owner}),stable(event),hash)
  ]);}catch{controlError('BOOTSTRAP_CONFLICT',409);}
  return {initialized:true,revision:0,stateHash};
}
async function controlSnapshot(db,actor,now){const row=await readControl(db);if(!row.state.grants.some(g=>g.subject===actor&&grantValid(row.state,g,now)))controlError('AUTHORITY_DENIED',403);
  const allowed=new Set(row.state.requests.filter(r=>actor===row.state.root||authorizeControl(row.state,actor,'record.write',r.wants.resource,now)).map(r=>r.id));
  const visible=structuredClone(row.state);if(actor!==visible.root){visible.requests=visible.requests.filter(r=>allowed.has(r.id));visible.evidence=visible.evidence.filter(e=>allowed.has(e.requestId));visible.records=visible.records.filter(r=>allowed.has(r.requestId));const ids=new Set(visible.grants.filter(g=>g.subject===actor).map(g=>g.id));for(const id of [...ids]){let g=visible.grants.find(g=>g.id===id);while(g?.parent){ids.add(g.parent);g=visible.grants.find(p=>p.id===g.parent);}}visible.grants=visible.grants.filter(g=>ids.has(g.id));}
  return {revision:row.revision,stateHash:row.state_hash,evidenceHead:row.head_hash,projection:actor===row.state.root?'complete':'authority-scoped',state:visible,decisions:(await verifiedActions(row.state,row.revision,now,actor)).filter(d=>allowed.has(d.requestId))};
}
function controlResult(prior,replayed){const event=typeof prior.event_json==='string'?JSON.parse(prior.event_json):prior.event;return {replayed,event:{id:event.id,revision:event.revision,actor:event.actor,type:event.type,result:event.result},eventHash:prior.hash};}
async function commitControl(db,command,actor,now){
  if(!command||typeof command.id!=='string'||!Number.isSafeInteger(command.expectedRevision))controlError('INVALID_COMMAND',400);
  const commandHash=await controlHash(command),prior=await db.prepare('SELECT actor,command_hash,event_json,hash FROM numina_control_events WHERE id=?').bind(command.id).first();
  if(prior){if(prior.actor!==actor||prior.command_hash!==commandHash)controlError('IDEMPOTENCY_CONFLICT',409);return controlResult(prior,true);}
  const row=await readControl(db);if(row.revision>=2048)controlError('EVENT_CAPACITY',409);
  const reduced=await reduceControl(row.state,command,actor,row.revision,now),stateHash=await controlHash(reduced.state);
  const event={id:command.id,revision:row.revision+1,actor,at:now,type:command.type,command,commandHash,previous:row.head_hash,stateHash,parents:reduced.parents,result:reduced.result,decisionsHash:await controlHash(reduced.decisions)};const hash=await controlHash(event);
  // Conservative transaction-time fence: no previously active grant/evidence may expire while this command commits.
  const validUntil=Math.min(now+5,...row.state.grants.filter(g=>g.expiresAt>now).map(g=>g.expiresAt),...row.state.evidence.filter(e=>e.expiresAt>now).map(e=>e.expiresAt));
  let failure;try{await db.batch([
    db.prepare('UPDATE numina_control_state SET revision=?,state_json=?,state_hash=?,head_hash=?,mutation_id=? WHERE id=1 AND revision=? AND head_hash=? AND ? > unixepoch()').bind(event.revision,stable(reduced.state),stateHash,hash,command.id,row.revision,row.head_hash,validUntil),
    db.prepare('INSERT INTO numina_control_events(id,revision,actor,command_hash,event_json,hash) SELECT ?,?,?,?,?,? FROM numina_control_state WHERE id=1 AND mutation_id=? AND head_hash=? AND NOT EXISTS(SELECT 1 FROM numina_control_events WHERE id=?)').bind(command.id,event.revision,actor,commandHash,stable(event),hash,command.id,hash,command.id)
  ]);}catch(e){failure=e;}
  const persisted=await db.prepare('SELECT actor,command_hash,event_json,hash FROM numina_control_events WHERE id=?').bind(command.id).first();
  if(persisted){if(persisted.actor!==actor||persisted.command_hash!==commandHash)controlError('IDEMPOTENCY_CONFLICT',409);return controlResult(persisted,persisted.hash!==hash);}
  if(failure)throw failure;controlError('STALE_REVISION',409);
}


const TREASURY_DOCUMENT_LIMIT=10*1024*1024;
const treasuryDocumentHeaders={'Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'};
function treasuryDocumentResponse(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...treasuryDocumentHeaders,'Content-Type':'application/json'}});}
function treasuryDocumentName(raw){
 let name;try{name=decodeURIComponent(raw||'');}catch{controlError('INVALID_DOCUMENT_NAME',400);}
 if(!name||name!==name.trim()||new TextEncoder().encode(name).length>160||/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/.test(name)||!/[.](pdf|png|jpe?g)$/i.test(name))controlError('INVALID_DOCUMENT_NAME',400);
 return name;
}
function treasuryDocumentReceipt(object,prefix){
 const m=object?.customMetadata,id=object?.key?.slice(prefix.length);
 if(!object?.key?.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(id)||m?.schema!=='numina.supporting_document.v1'||m.sha256!==id||Number(m.size)!==object.size||object.size<1||object.size>TREASURY_DOCUMENT_LIMIT||!Number.isFinite(Date.parse(m.received_at))||!['application/pdf','image/png','image/jpeg'].includes(m.content_type))controlError('DOCUMENT_RECORD_UNAVAILABLE',503);
 return {id,name:treasuryDocumentName(m.encoded_name),size:object.size,content_type:m.content_type,sha256:id,received_at:m.received_at,classification:'owner_uploaded_unverified',bank_issuer_verified:false,independent_verification:'not_completed'};
}
async function treasuryDocumentBytes(req){
 if(req.headers.has('content-encoding'))controlError('ENCODED_DOCUMENT_NOT_SUPPORTED',415);
 const declared=req.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>TREASURY_DOCUMENT_LIMIT))controlError('DOCUMENT_TOO_LARGE',413);
 const reader=req.body?.getReader();if(!reader)controlError('EMPTY_DOCUMENT',400);
 const chunks=[];let length=0;const deadline=Date.now()+20000;
 try{for(;;){let timer;let part;try{part=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('DOCUMENT_UPLOAD_TIMEOUT'),{code:'DOCUMENT_UPLOAD_TIMEOUT',status:408})),Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}if(part.done)break;length+=part.value.byteLength;if(length>TREASURY_DOCUMENT_LIMIT)controlError('DOCUMENT_TOO_LARGE',413);chunks.push(part.value);}}
 catch(error){void reader.cancel().catch(()=>{});throw error;}
 if(!length)controlError('EMPTY_DOCUMENT',400);if(declared!==null&&Number(declared)!==length)controlError('DOCUMENT_LENGTH_MISMATCH',400);
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
function treasuryDocumentFormat(bytes,type,name){
 const signature=type==='application/pdf'?bytes.length>=8&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'&&/\.pdf$/i.test(name):type==='image/png'?bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&/\.png$/i.test(name):type==='image/jpeg'?bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217&&/\.jpe?g$/i.test(name):false;
 if(!signature)controlError('DOCUMENT_FORMAT_MISMATCH',415);
}
async function treasuryDocumentHttp(req,env,actor){
 // Caller has already checked authenticated root ownership, configuration and write origin.
 if(!env.BUCKET)controlError('DOCUMENT_STORAGE_UNAVAILABLE',503);
 const url=new URL(req.url),base='/api/control/v1/treasury-documents',prefix='treasury-documents/v1/'+await controlHash(actor)+'/',path=url.pathname;
 if(path===base&&req.method==='GET'){
  const cursor=url.searchParams.get('cursor')||undefined;if(cursor&&cursor.length>2048)controlError('INVALID_DOCUMENT_CURSOR',400);
  const result=await env.BUCKET.list({prefix,limit:50,include:['customMetadata'],...(cursor?{cursor}:{})});
  if(result.truncated&&!result.cursor)controlError('DOCUMENT_RECORD_UNAVAILABLE',503);
  return treasuryDocumentResponse({schema:'numina.supporting_documents.v1',documents:result.objects.map(object=>treasuryDocumentReceipt(object,prefix)),next_cursor:result.truncated?result.cursor:null,upload_limit_bytes:TREASURY_DOCUMENT_LIMIT,accepted_types:['application/pdf','image/png','image/jpeg'],receipt_scope:'file_storage_only',bank_issuer_verified:false,financial_execution:false});
 }
 if(path===base&&req.method==='POST'){
  const type=req.headers.get('content-type')?.split(';')[0];if(!['application/pdf','image/png','image/jpeg'].includes(type))controlError('DOCUMENT_TYPE_NOT_SUPPORTED',415);
  const name=treasuryDocumentName(req.headers.get('x-document-name')),bytes=await treasuryDocumentBytes(req);treasuryDocumentFormat(bytes,type,name);
  const digest=await crypto.subtle.digest('SHA-256',bytes),id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),key=prefix+id;
  const previous=await env.BUCKET.head(key);if(previous)return treasuryDocumentResponse({document:treasuryDocumentReceipt(previous,prefix),replayed:true});
  const metadata={schema:'numina.supporting_document.v1',encoded_name:encodeURIComponent(name),sha256:id,size:String(bytes.length),content_type:type,received_at:new Date().toISOString()};
  const stored=await env.BUCKET.put(key,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:digest,httpMetadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'},customMetadata:metadata});
  const confirmed=stored||await env.BUCKET.head(key);if(!confirmed)controlError('DOCUMENT_RECEIPT_UNCONFIRMED',503);
  return treasuryDocumentResponse({document:treasuryDocumentReceipt(confirmed,prefix),replayed:!stored},stored?201:200);
 }
 const match=path.match(/^\/api\/control\/v1\/treasury-documents\/([a-f0-9]{64})$/);
 if(match&&req.method==='GET'){
  const object=await env.BUCKET.get(prefix+match[1]);if(!object)controlError('DOCUMENT_NOT_FOUND',404);const receipt=treasuryDocumentReceipt(object,prefix);
  const fallback=receipt.name.replace(/[^A-Za-z0-9._-]/g,'_');
  return new Response(object.body,{headers:{...treasuryDocumentHeaders,'Content-Type':'application/octet-stream','Content-Length':String(receipt.size),'Content-Disposition':'attachment; filename="'+fallback+'"; filename*=UTF-8\'\''+encodeURIComponent(receipt.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),'Content-Security-Policy':"sandbox; default-src 'none'"}});
 }
 return treasuryDocumentResponse({error:req.method==='GET'?'DOCUMENT_NOT_FOUND':'METHOD_NOT_ALLOWED'},req.method==='GET'?404:405);
}

// This adapter reads one configured live Financial account. It has no money-movement methods.
const STRIPE_TREASURY_ACCOUNT='acct_1UEEPnQdJat0efmT';
const STRIPE_TREASURY_FINANCIAL_ACCOUNT='fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu';
const STRIPE_TREASURY_VERSION='2026-08-26.preview';
function stripeTreasuryError(code,status){return Object.assign(new Error(code),{code,status});}
function stripeTreasuryDiagnostic(value){try{console.log(JSON.stringify(value));}catch{}}
function stripeTreasuryExceptionCategory(error){
  const message=typeof error?.message==='string'?error.message:'';
  if(/illegal invocation|incorrect receiver|incompatible receiver/i.test(message))return 'invalid_receiver';
  if(/not implemented|not supported|unsupported/i.test(message))return 'unsupported_runtime_option';
  if(/different request|outside.*request|request context/i.test(message))return 'request_context';
  if(/redirect/i.test(message))return 'redirect_rejected';
  if(/permission|denied|blocked|not allowed|disallowed/i.test(message))return 'request_blocked';
  if(/invalid.*header|header.*invalid/i.test(message))return 'invalid_request_header';
  if(/network|connection|fetch failed|failed to fetch|disconnected|dns/i.test(message))return 'network_failure';
  return 'unclassified';
}
function stripeTreasuryAmount(bucket,currency){
  const amount=bucket?.[currency];
  if(amount===undefined||amount===null)return null;
  if(amount.currency!==currency||!Number.isSafeInteger(amount.value))throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
  // Keep the provider integer exact. USD uses cents; USDC uses six decimal places.
  const digits=currency==='usd'?2:6,raw=BigInt(amount.value),absolute=raw<0n?-raw:raw;
  const padded=absolute.toString().padStart(digits+1,'0'),whole=padded.slice(0,-digits).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const decimal=whole+'.'+padded.slice(-digits),sign=raw<0n?'-':'';
  return {currency,value:amount.value,formatted:currency==='usd'?sign+'$'+decimal:sign+decimal+' USDC'};
}
async function stripeTreasuryJson(response){
  if(!response.body)throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536){void reader.cancel().catch(()=>{});throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);}chunks.push(value);}
    const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(combined);
    // Financial account numbers are integer minor units. Check raw tokens before
    // JSON.parse can round a fractional or out-of-range number into a safe integer.
    // Quoted strings are consumed separately, so account names are not interpreted.
    for(const token of raw.matchAll(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)){
      if(token[1]===undefined)continue;
      if(!/^-?(?:0|[1-9]\d*)$/.test(token[1]))throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
      const integer=BigInt(token[1]);if(integer>9007199254740991n||integer< -9007199254740991n)throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
    }
    return JSON.parse(raw);
  }catch(error){if(error.code==='STRIPE_TREASURY_INVALID_RESPONSE')throw error;throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);}
  finally{reader.releaseLock();}
}
async function readStripeTreasury(env,{fetcher=(...args)=>globalThis.fetch(...args),timeoutMs=8000}={}){
  const key=env.NUMINA_STRIPE_TREASURY_READ_KEY,id=env.NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT;
  if(typeof key!=='string'||!/^rk_live_[A-Za-z0-9]{16,}$/.test(key)||id!==STRIPE_TREASURY_FINANCIAL_ACCOUNT)throw stripeTreasuryError('STRIPE_TREASURY_NOT_CONNECTED',503);
  const controller=new AbortController();let timer,stage='fetch_pending';
  try{return await Promise.race([
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(stripeTreasuryError('STRIPE_TREASURY_TIMEOUT',504));},timeoutMs);}),
    (async()=>{
      // Managed Workers may not enable RequestInit.cache. HTTP headers avoid that
      // compatibility dependency while private responses also remain no-store.
      // Inspect redirects as failed responses without following them or forwarding credentials.
      const response=await fetcher('https://api.stripe.com/v2/money_management/financial_accounts/'+id,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Authorization:'Bearer '+key,'Stripe-Version':STRIPE_TREASURY_VERSION,Accept:'application/json','Cache-Control':'no-store',Pragma:'no-cache'}});
      stage='response_received';
      if(!response.ok||response.redirected){const requestId=response.headers.get('request-id');stripeTreasuryDiagnostic({event:'stripe_treasury_provider_error',http_status:response.status,request_id:requestId&&/^[A-Za-z0-9._-]{1,100}$/.test(requestId)?requestId:null});void response.body?.cancel().catch(()=>{});throw stripeTreasuryError('STRIPE_TREASURY_UNAVAILABLE',503);}
      const value=await stripeTreasuryJson(response);
      stage='body_read';
      if(!value||value.object!=='v2.money_management.financial_account'||value.id!==id||value.livemode!==true||value.type!=='storage'||!['open','closed'].includes(value.status)||!value.balance||typeof value.balance!=='object'||Array.isArray(value.balance))throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
      const balances={};for(const name of ['available','inbound_pending','outbound_pending']){
        const bucket=value.balance[name];if(bucket!==undefined&&bucket!==null&&(typeof bucket!=='object'||Array.isArray(bucket)))throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
        balances[name]={usd:stripeTreasuryAmount(bucket,'usd'),usdc:stripeTreasuryAmount(bucket,'usdc')};
      }
      const header=name=>{const text=response.headers.get(name);return text&&/^[A-Za-z0-9._-]{1,100}$/.test(text)?text:null;};
      return {schema:'numina.stripe.treasury.v1',provider:'Stripe',connection:'read_only',account:{id,name:typeof value.display_name==='string'&&value.display_name.trim()?value.display_name.trim().slice(0,160):'Financial account',status:value.status,livemode:true},balances,observed_at:new Date().toISOString(),provider_request_id:header('request-id'),provider_api_version:header('stripe-version'),dashboard_url:'https://dashboard.stripe.com/'+STRIPE_TREASURY_ACCOUNT+'/treasury',transfer_execution:false,nusd_settlement:false};
    })()
  ]);}catch(error){if(['STRIPE_TREASURY_UNAVAILABLE','STRIPE_TREASURY_INVALID_RESPONSE','STRIPE_TREASURY_TIMEOUT'].includes(error?.code))throw error;stripeTreasuryDiagnostic({event:'stripe_treasury_runtime_error',stage,response_received:stage!=='fetch_pending',category:stripeTreasuryExceptionCategory(error),error_name:['Error','TypeError','RangeError','AbortError','NetworkError','SecurityError','NotSupportedError'].includes(error?.name)?error.name:'OtherError'});throw stripeTreasuryError('STRIPE_TREASURY_UNAVAILABLE',503);}
  finally{clearTimeout(timer);controller.abort();}
}

const OWNER_TREASURY_STATEMENT={"schema":"numina.treasury.owner_statement.v1","classification":"owner_reported_not_independently_verified","source":"User statements in the Numina build conversation; not a bank feed or signed reserve report","reported_owner":"SK Consulting LLC","reported_institution":"Bank of America","reported_account_type":"Savings","reported_as_of":"2026-09-11","reported_currency":"USD","reported_amount_usd":"500000000000000","reported_custodian":"Numina","owner_reports_funding_authorized":true,"owner_reports_evidence_supplied":true,"owner_evidence_statement":"Actual evidence: supplied.","owner_financial_activity_statement":"Treasury transfers and NUSD settlement are active. Funds moved.","bank_evidence_received":false,"independent_verification":"not_completed","verified_reserve_amount_usd":null,"verified_allocation_usd":null,"funds_moved_by_this_record":false,"financial_capabilities_activated":false};
function controlResponse(body,status=200,extraHeaders={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Numina-Control-Version':CONTROL_VERSION,...extraHeaders}});}
async function controlActor(req,env){
  if(!env.NUMINA_CONTROL_OWNER||!env.NUMINA_CONTROL_API_KEY_SHA256)controlError('AUTHORITY_CONFIGURATION_MISSING',503);
  const auth=req.headers.get('authorization');
  if(auth){if(!auth.startsWith('Bearer ')||await controlHash(auth.slice(7))!==env.NUMINA_CONTROL_API_KEY_SHA256)controlError('UNAUTHENTICATED',401);return env.NUMINA_CONTROL_OWNER;}
  // These two identity headers are set and overwritten by the Sites dispatcher.
  const id=req.headers.get('oai-authenticated-user-id'),email=req.headers.get('oai-authenticated-user-email');
  if(!id||!email)controlError('UNAUTHENTICATED',401);
  return 'email:'+email.trim().toLowerCase();
}
async function controlBody(req){
  if(req.headers.get('content-type')?.split(';')[0]!=='application/json'||req.headers.has('content-encoding'))controlError('JSON_REQUIRED',415);
  const reader=req.body?.getReader();if(!reader)controlError('EMPTY_BODY',400);const chunks=[];let bytes=0;const deadline=Date.now()+5000;
  for(;;){let timer;let chunk;try{chunk=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('BODY_TIMEOUT'),{code:'BODY_TIMEOUT',status:408})),Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>16384){await reader.cancel();controlError('BODY_TOO_LARGE',413);}chunks.push(chunk.value);}
  const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
  try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(combined),value=JSON.parse(raw);if(stable(value)!==raw)controlError('CANONICAL_JSON_REQUIRED',400);return value;}catch{controlError('CANONICAL_JSON_REQUIRED',400);}
}
async function controlHttp(req,env){
  const path=new URL(req.url).pathname,now=Math.floor(Date.now()/1000);
  try{
    const bucket=await controlHash('control:'+Math.floor(now/86400)+':'+(req.headers.get('cf-connecting-ip')||'unknown'));
    if(!await rateLimit(env.DB,bucket,now))return controlResponse({error:'RATE_LIMITED'},429);
    if(req.method==='GET'&&path==='/api/control/v1/health'){
      const row=await readControl(env.DB);const count={n:row.eventCount};
      const configured=!!env.NUMINA_CONTROL_OWNER&&!!env.NUMINA_CONTROL_API_KEY_SHA256&&env.NUMINA_CONTROL_OWNER===row.state.root;
      const healthy=configured&&count.n===row.revision+1;
      return controlResponse({status:healthy?'ready':'degraded',version:CONTROL_VERSION,architecture:'singular',sharedState:'D1',authority:'root-traceable-attenuated-grants',interoperability:[CONTROL_ADAPTER],evidence:'versioned-causal-DAG-and-hash-linked-journal',reconciliation:'event-driven-single-reducer',nextAction:'revision-and-evidence-bound',checks:{storage:true,stateIntegrity:true,evidenceHead:true,journalContinuity:count.n===row.revision+1,authorityConfigured:configured},revision:row.revision,eventCount:count.n,stateHash:row.state_hash,evidenceHead:row.head_hash,verificationScope:'internal_record_consistency_only',financialVerification:false,executionScope:'internal_record_commit',settlementScope:'not_connected',externalExecution:false,fullCoreConstitutionCertification:false},healthy?200:503);
    }
    if(req.method==='GET'&&path==='/api/control/v1/manifest')return controlResponse({version:CONTROL_VERSION,architecture:'singular',lifecycle:['REQUEST','AUTHORITY','POLICY','ROUTE','EXECUTION','SETTLEMENT','EVIDENCE','RECONCILIATION','VERIFIED_NEXT_STATE'],adapters:[CONTROL_ADAPTER],unsupportedAdapters:'ESCALATE',publicDemoCredentials:'not recognized',limits:{requests:100,grants:100,evidenceNodes:400,journalEvents:2048,stateBytes:524288},verificationScope:'internal_record_consistency_only',financialVerification:false,executionScope:'internal_record_commit',settlementScope:'not_connected',externalExecution:false,constitution:'Core v1.8 source preserved; full C1-C14 hosted certification not claimed'});
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
      return controlResponse(OWNER_TREASURY_STATEMENT,200,{'Cache-Control':'private, no-store','Vary':'Cookie, Authorization'});
    }
    if(path==='/api/control/v1/state'&&req.method==='GET')return controlResponse(await controlSnapshot(env.DB,actor,now));
    if(path==='/api/control/v1/next-action'&&req.method==='GET'){const snapshot=await controlSnapshot(env.DB,actor,now);return controlResponse({revision:snapshot.revision,decisions:snapshot.decisions});}
    if(path==='/api/control/v1/commands'&&req.method==='POST'){const body=await controlBody(req);return controlResponse(await commitControl(env.DB,body,actor,Math.floor(Date.now()/1000)));}
    if(path==='/api/control/v1/journal'&&req.method==='GET'){
      if(actor!==current.state.root)controlError('OWNER_VIEW_REQUIRED',403);
      const after=Number(new URL(req.url).searchParams.get('after')??-1);if(!Number.isSafeInteger(after)||after< -1)controlError('INVALID_CURSOR',400);
      const rows=await env.DB.prepare('SELECT event_json,hash FROM numina_control_events WHERE revision>? ORDER BY revision LIMIT 100').bind(after).all();return controlResponse({events:rows.results.map(r=>({event:JSON.parse(r.event_json),hash:r.hash})),next:rows.results.length?JSON.parse(rows.results.at(-1).event_json).revision:null});
    }
    return controlResponse({error:'NOT_FOUND'},404);
  }catch(error){const code=error.code||'DEPENDENCY_UNAVAILABLE',status=error.status||503;console.log(JSON.stringify({event:'control_error',route:path.replace(/\/treasury-documents\/[^/]+/,'/treasury-documents/:id'),code,status}));return controlResponse({status:'unavailable',error:code},status);}
}

const RC20_READ_PATHS = new Set(['/healthz', '/readyz', '/metrics', '/.well-known/security.txt', '/site.webmanifest', '/v1/preflight', '/v1/status', '/v1/capabilities', '/v1/release/manifest', '/v1/release/supply-chain', '/v1/release/sbom', '/v1/release/build-provenance', '/v1/release/attestation', '/v1/keys/release-verification']);
const RC20_POST_PATHS = new Set(['/v1/control/evaluate', '/v1/verify/release-attestation', '/v1/verify/status-witness', '/v1/verify/checkpoint']);

function rc20Error(status, message, extra = {}) {
  return new Response(JSON.stringify({error: message}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra}});
}

async function routeRc20(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/control' || path === '/control/') {
    if (!['GET', 'HEAD'].includes(request.method)) return rc20Error(405, 'METHOD_NOT_ALLOWED', {Allow: 'GET, HEAD'});
    const asset = await env.ASSETS.fetch(new Request(new URL('/control', url), {method: 'GET'}));
    const html = (await asset.text())
      .replace('rel="canonical" href="https://www.numinalabs.xyz/"', 'rel="canonical" href="https://www.numinalabs.xyz/control"')
      .replace('href="/" aria-current="page">Control plane', 'href="/control" aria-current="page">Control plane')
      .replace('return_to=%2F"', 'return_to=%2Fcontrol"');
    const headers = new Headers(asset.headers);
    headers.delete('Content-Length'); headers.delete('Content-Encoding'); headers.delete('ETag');
    headers.set('Cache-Control', 'no-store');
    return new Response(request.method === 'HEAD' ? null : html, {status: asset.status, headers});
  }
  // This branch stays inactive until a verified upstream is configured.
  if (!env.NUMINA_RC20_ORIGIN || (!RC20_READ_PATHS.has(path) && !RC20_POST_PATHS.has(path))) return null;
  const isPost = RC20_POST_PATHS.has(path);
  if (!(isPost ? request.method === 'POST' : ['GET', 'HEAD'].includes(request.method))) return rc20Error(405, 'METHOD_NOT_ALLOWED', {Allow: isPost ? 'POST' : 'GET, HEAD'});
  let origin;
  try {
    origin = new URL(env.NUMINA_RC20_ORIGIN);
    if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.vercel.app') || origin.username || origin.password || origin.port || origin.pathname !== '/' || origin.search || origin.hash) throw new Error();
  } catch { return rc20Error(503, 'RC20_ORIGIN_NOT_CONFIGURED'); }
  const upstream = new URL(path, origin);
  upstream.search = url.search;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let incomingReader;
  try {
    const headers = new Headers({Accept: isPost || path.startsWith('/v1/') ? 'application/json' : '*/*'});
    let body;
    if (isPost) {
      if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/json') return rc20Error(415, 'JSON_REQUIRED');
      if (request.headers.has('Content-Encoding')) return rc20Error(415, 'ENCODING_UNSUPPORTED');
      if (Number(request.headers.get('Content-Length')) > 65536) return rc20Error(413, 'BODY_TOO_LARGE');
      if (!request.body) return rc20Error(400, 'EMPTY_BODY');
      const reader = incomingReader = request.body.getReader(), chunks = [];
      const deadline = new Promise((_, reject) => {
        if (controller.signal.aborted) return reject(new Error('deadline'));
        controller.signal.addEventListener('abort', () => reject(new Error('deadline')), {once: true});
      });
      let size = 0;
      while (true) {
        const result = await Promise.race([reader.read(), deadline]);
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 65536) { void reader.cancel().catch(() => {}); return rc20Error(413, 'BODY_TOO_LARGE'); }
        chunks.push(result.value);
      }
      body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      headers.set('Content-Type', 'application/json');
    }
    // Send public requests only. Never forward identity, cookies or credentials.
    const result = await upstreamFetch(upstream.href, {method: isPost ? 'POST' : 'GET', headers, body, redirect: 'manual', signal: controller.signal});
    if (result.status >= 300 && result.status < 400) return rc20Error(502, 'RC20_UPSTREAM_REDIRECT');
    const responseHeaders = new Headers();
    for (const key of ['content-type', 'cache-control', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'strict-transport-security']) {
      if (result.headers.has(key)) responseHeaders.set(key, result.headers.get(key));
    }
    responseHeaders.set('Cache-Control', 'no-store');
    let content = await result.arrayBuffer();
    return new Response(request.method === 'HEAD' ? null : content, {status: result.status, headers: responseHeaders});
  } catch { return rc20Error(controller.signal.aborted ? 504 : 502, 'RC20_SERVICE_UNAVAILABLE'); }
  finally {
    clearTimeout(timer);
    if (controller.signal.aborted && incomingReader) void incomingReader.cancel().catch(() => {});
  }
}

const APP_VERSION='2026-09-12';
const APP_OFFERS={
 diagnostic:{name:'Operational Agent Diagnostic',amount:150000,currency:'usd',paymentLink:'plink_1UEZzUQdJat0efmTmZFJ5X6b',url:'https://book.stripe.com/fZu8wRb8UfHubiWgSxcbC07',description:'60–90 minutes focused on one authorized workflow, an opportunity map, dependencies, risks and a recommended next step.'},
 audit:{name:'Agentic Systems & Operations Audit',amount:750000,currency:'usd',paymentLink:'plink_1UEZzoQdJat0efmTN8cI8Xat',url:'https://book.stripe.com/3cI9AV7WIfHu5YC9q5cbC08',description:'A fixed-scope assessment, prioritized opportunities, control requirements and implementation roadmap.'},
 authorization_check:{name:'Authorization check',amount:null,currency:'nusd',requestOnly:true,description:'Submit the proposed agent action, authorized systems and acceptance criteria for scope review. Intended pricing: NUSD per accepted verification result; price and payment are not activated.'},
 result_access:{name:'Numina Result Access',amount:null,currency:'nusd',requestOnly:true,description:'Describe the API result, its intended use and the access you need. Scope and intended NUSD pricing are reviewed before any paid entitlement. Payment and result unlocking are not activated.'},
 workflow_delivery:{name:'Verified workflow delivery',amount:null,currency:'nusd',requestOnly:true,description:'Define the workflow, measurable outcome and delivery evidence for scope review. Intended pricing: NUSD per accepted outcome; payment and execution are not activated.'}
};
function appFail(code,status=400){throw Object.assign(new Error(code),{code,status});}
async function appDigest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function appText(value,min,max){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))appFail('INVALID_INPUT');return value.trim();}
function appIntake(input){
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['idempotencyKey','service','title','brief','successCriteria','country','consent'].includes(k)))appFail('INVALID_INPUT');
 if(!/^[a-f0-9-]{36}$/.test(input.idempotencyKey)||!Object.hasOwn(APP_OFFERS,input.service)||!/^[A-Z]{2}$/.test(input.country)||input.consent!==true)appFail('INVALID_INPUT');
 return {idempotencyKey:input.idempotencyKey,service:input.service,title:appText(input.title,3,120),brief:appText(input.brief,20,4000),successCriteria:appText(input.successCriteria,10,1500),country:input.country,consent:true};
}
function appPaymentSummary(payments,facts){
 const paid=payments.filter(p=>p.status==='paid');let gross=0,refunded=0,disputed=false;
 for(const p of paid){
  gross+=p.amount;const related=facts.filter(f=>f.payment_intent===p.payment_intent);
  refunded+=Math.min(p.amount,Math.max(0,...related.filter(f=>f.kind==='refund').map(f=>f.amount)));
  const disputes=new Map();
  for(const fact of related.filter(f=>f.kind==='dispute')){
   const latest=disputes.get(fact.object_id);
   if(!latest||fact.event_created>latest.at)disputes.set(fact.object_id,{at:fact.event_created,statuses:new Set([fact.status])});
   else if(fact.event_created===latest.at)latest.statuses.add(fact.status);
  }
  // IDs do not order events created in the same second. Ambiguous facts require review.
  if([...disputes.values()].some(d=>[...d.statuses].some(s=>!['won','warning_closed'].includes(s))))disputed=true;
 }
 return {status:disputed?'disputed':paid.length&&refunded>=gross?'refunded':refunded?'partially_refunded':paid.length?'paid':payments.some(p=>p.status==='pending')?'pending':'unconfirmed',gross,refunded,netBeforeFees:gross-refunded,currency:'usd',duplicatePayment:paid.length>1,disputed,confirmedBy:'Stripe-signed events only'};
}
function appTransition(order,input,isOperator,payment){
 if(!input||Object.keys(input).some(k=>!['action','note','revision','idempotencyKey'].includes(k)))appFail('INVALID_INPUT');
 if(!Number.isInteger(input.revision)||input.revision!==order.revision)appFail('REVISION_CONFLICT',409);
 if(!/^[a-f0-9-]{36}$/.test(input.idempotencyKey))appFail('INVALID_INPUT');
 const note=appText(input.note,5,4000),action=input.action;
 const transitions=isOperator?{scope:['submitted','scoped'],start:['scoped','in_progress'],deliver:['in_progress','delivered'],decline:['submitted','declined']}:{accept:['delivered','complete'],request_changes:['delivered','in_progress'],cancel:['submitted','cancelled']};
 if(APP_OFFERS[order.service]?.requestOnly&&order.status==='scoped'){if(isOperator)transitions.decline=['scoped','declined'];else transitions.cancel=['scoped','cancelled'];}
 const pair=transitions[action];if(!pair||order.status!==pair[0])appFail('TRANSITION_NOT_ALLOWED',409);
 if(APP_OFFERS[order.service]?.requestOnly&&['start','deliver','accept','request_changes'].includes(action))appFail('NUSD_NOT_ACTIVATED',409);
 if(action==='start'&&(payment.status!=='paid'||payment.duplicatePayment))appFail('CONFIRMED_PAYMENT_REQUIRED',409);
 if(action==='deliver'&&(payment.status!=='paid'||payment.duplicatePayment))appFail('PAYMENT_REVIEW_REQUIRED',409);
 return {status:pair[1],note,action};
}
async function appVerifyStripe(raw,signature,secret,now=Math.floor(Date.now()/1000)){
 if(!secret)appFail('PAYMENT_CONFIRMATION_UNAVAILABLE',503);
 const parts=(signature||'').split(',').map(x=>x.split('='));const timestamp=parts.find(x=>x[0]==='t')?.[1];
 if(!/^\d+$/.test(timestamp||'')||Math.abs(now-Number(timestamp))>300)appFail('INVALID_SIGNATURE',400);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);let valid=false;
 for(const [type,value]of parts){if(type==='v1'&&/^[a-f0-9]{64}$/i.test(value)){const bytes=Uint8Array.from(value.match(/../g),x=>parseInt(x,16));valid=(await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+raw)))||valid;}}
 if(!valid)appFail('INVALID_SIGNATURE',400);
 let event;try{event=JSON.parse(raw);}catch{appFail('INVALID_JSON');}
 if(!event||!/^evt_[A-Za-z0-9]+$/.test(event.id)||event.livemode!==true||!Number.isSafeInteger(event.created)||!event.data?.object)appFail('INVALID_EVENT');
 if(event.account&&event.account!=='acct_1UEEPnQdJat0efmT')appFail('WRONG_STRIPE_ACCOUNT');
 return event;
}

function appResponse(value,status=200,headers={}){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Cookie','X-Numina-App-Version':APP_VERSION,...headers}});}
async function appReadRaw(req,max=16384){
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||req.headers.has('content-encoding'))appFail('JSON_REQUIRED',415);
 if(Number(req.headers.get('content-length'))>max)appFail('BODY_TOO_LARGE',413);
 const reader=req.body?.getReader();if(!reader)appFail('EMPTY_BODY');const chunks=[];let size=0;const deadline=Date.now()+5000;
 try{for(;;){let timer;const chunk=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('BODY_TIMEOUT'),{code:'BODY_TIMEOUT',status:408})),Math.max(1,deadline-Date.now()));})]).finally(()=>clearTimeout(timer));if(chunk.done)break;size+=chunk.value.length;if(size>max)appFail('BODY_TOO_LARGE',413);chunks.push(chunk.value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(e){void reader.cancel().catch(()=>{});throw e;}
}
async function appBody(req){try{return JSON.parse(await appReadRaw(req));}catch(e){if(e.code)throw e;appFail('INVALID_JSON');}}
async function appActor(req,env){
 const id=req.headers.get('oai-authenticated-user-id'),email=req.headers.get('oai-authenticated-user-email');
 if(!id||!email||id.length>250||email.length>320)appFail('SIGN_IN_REQUIRED',401);
 return {id,email:email.trim().toLowerCase(),operator:env.NUMINA_CONTROL_OWNER==='email:'+email.trim().toLowerCase()};
}
async function appRate(db,key,max,now){await db.prepare('DELETE FROM numina_app_rate WHERE window<?').bind(Math.floor(now/60)-2).run();const row=await db.prepare('INSERT INTO numina_app_rate (bucket,window,count) VALUES (?,?,1) ON CONFLICT(bucket,window) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(key,Math.floor(now/60),max).first();if(!row)appFail('RATE_LIMITED',429);}
async function appOrder(db,id,actor){const row=await db.prepare('SELECT * FROM numina_service_orders WHERE id=?').bind(id).first();if(!row||(!actor.operator&&row.owner_subject!==actor.id))appFail('NOT_FOUND',404);return row;}
async function appOrderPayment(db,id){const payments=(await db.prepare('SELECT * FROM numina_app_payments WHERE order_id=? ORDER BY session_id').bind(id).all()).results;const facts=(await db.prepare('SELECT f.* FROM numina_app_payment_facts f JOIN numina_app_payments p ON p.payment_intent=f.payment_intent WHERE p.order_id=?').bind(id).all()).results;return appPaymentSummary(payments,facts);}
async function appOrderView(db,row,actor){return {isOwner:row.owner_subject===actor.id,id:row.id,title:row.title,service:row.service,requestOnly:!!APP_OFFERS[row.service]?.requestOnly,brief:row.brief,successCriteria:row.success_criteria,country:row.country,status:row.status,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,customerEmail:row.owner_email,payment:APP_OFFERS[row.service]?.requestOnly?{status:'not_available',gross:null,refunded:null,netBeforeFees:null,currency:'nusd',duplicatePayment:false,disputed:false,confirmedBy:null}:await appOrderPayment(db,row.id)};}
async function appWebhook(req,env){
 const raw=await appReadRaw(req,262144),event=await appVerifyStripe(raw,req.headers.get('stripe-signature'),env.NUMINA_STRIPE_WEBHOOK_SECRET);const obj=event.data.object,hash=await appDigest(raw),now=Math.floor(Date.now()/1000);
 const existing=await env.DB.prepare('SELECT body_hash FROM numina_app_webhook_events WHERE id=?').bind(event.id).first();if(existing){if(existing.body_hash!==hash)appFail('EVENT_ID_CONFLICT',409);return appResponse({received:true,replayed:true});}
 const statements=[];let matched=false;
 if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type)){
  const order=typeof obj.client_reference_id==='string'?await env.DB.prepare('SELECT * FROM numina_service_orders WHERE id=?').bind(obj.client_reference_id).first():null;
  if(!order)return appResponse({received:true,ignored:true});
  const offer=APP_OFFERS[order.service];if(!offer||offer.requestOnly||obj.object!=='checkout.session'||obj.mode!=='payment'||obj.currency!=='usd'||obj.amount_total!==offer.amount||obj.payment_link!==offer.paymentLink||obj.livemode!==true||!/^cs_live_[A-Za-z0-9]+$/.test(obj.id))appFail('PAYMENT_DETAILS_MISMATCH',422);
  const pi=typeof obj.payment_intent==='string'?obj.payment_intent:obj.payment_intent?.id;
  const paid=['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&obj.payment_status==='paid';
  if(paid&&!/^pi_[A-Za-z0-9]+$/.test(pi||''))appFail('PAYMENT_INTENT_REQUIRED',422);
  const status=paid?'paid':event.type==='checkout.session.completed'?'pending':event.type==='checkout.session.expired'?'expired':'failed';
  const previous=await env.DB.prepare('SELECT order_id,payment_intent FROM numina_app_payments WHERE session_id=?').bind(obj.id).first();if(previous&&(previous.order_id!==order.id||(previous.payment_intent&&pi&&previous.payment_intent!==pi)))appFail('SESSION_CONFLICT',409);
  statements.push(env.DB.prepare("INSERT INTO numina_app_payments (session_id,order_id,payment_intent,amount,status,event_created,event_id) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM numina_app_webhook_events WHERE id=?) ON CONFLICT(session_id) DO UPDATE SET payment_intent=COALESCE(excluded.payment_intent,numina_app_payments.payment_intent), status=CASE WHEN excluded.status='paid' THEN 'paid' WHEN numina_app_payments.status='paid' THEN 'paid' WHEN excluded.event_created>=numina_app_payments.event_created THEN excluded.status ELSE numina_app_payments.status END,event_created=MAX(excluded.event_created,numina_app_payments.event_created),event_id=excluded.event_id").bind(obj.id,order.id,pi||null,offer.amount,status,event.created,event.id,event.id));
  statements.push(env.DB.prepare('UPDATE numina_service_orders SET payment_revision=payment_revision+1 WHERE id=? AND NOT EXISTS (SELECT 1 FROM numina_app_webhook_events WHERE id=?)').bind(order.id,event.id));matched=true;
 }else if(event.type==='charge.refunded'||['charge.dispute.created','charge.dispute.updated','charge.dispute.closed'].includes(event.type)){
  const pi=typeof obj.payment_intent==='string'?obj.payment_intent:obj.payment_intent?.id;if(!/^pi_[A-Za-z0-9]+$/.test(pi||'')||obj.currency!=='usd')return appResponse({received:true,ignored:true});
  const kind=event.type==='charge.refunded'?'refund':'dispute',amount=kind==='refund'?obj.amount_refunded:obj.amount;
  if(!Number.isSafeInteger(amount)||amount<0||!/^((ch)|(dp))_[A-Za-z0-9]+$/.test(obj.id))appFail('INVALID_PAYMENT_FACT');
  // Retain minimal signed facts so a refund arriving before checkout confirmation is not lost.
  statements.push(env.DB.prepare('INSERT INTO numina_app_payment_facts (event_id,payment_intent,object_id,kind,amount,status,event_created) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM numina_app_webhook_events WHERE id=?) ON CONFLICT(event_id) DO NOTHING').bind(event.id,pi,obj.id,kind,amount,kind==='refund'?'refunded':String(obj.status||'unknown').slice(0,40),event.created,event.id));
  statements.push(env.DB.prepare('UPDATE numina_service_orders SET payment_revision=payment_revision+1 WHERE id IN (SELECT order_id FROM numina_app_payments WHERE payment_intent=?) AND NOT EXISTS (SELECT 1 FROM numina_app_webhook_events WHERE id=?)').bind(pi,event.id));matched=true;
 }else return appResponse({received:true,ignored:true});
 // The event guard and every effect share one atomic transaction; concurrent replays are no-ops.
 statements.push(env.DB.prepare('INSERT INTO numina_app_webhook_events (id,body_hash,type,received_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id').bind(event.id,hash,event.type,now));
 statements.push(env.DB.prepare('SELECT body_hash FROM numina_app_webhook_events WHERE id=?').bind(event.id));
 const results=await env.DB.batch(statements);
 if(results.at(-1).results[0]?.body_hash!==hash)appFail('EVENT_ID_CONFLICT',409);
 return appResponse(results.at(-2).results.length?{received:true,matched}:{received:true,replayed:true});
}
async function appHttp(req,env){
 const url=new URL(req.url),path=url.pathname,now=Math.floor(Date.now()/1000);
 try{
  if(path==='/api/app/v1/stripe-webhook'){if(req.method!=='POST')return appResponse({error:'METHOD_NOT_ALLOWED'},405,{Allow:'POST'});return await appWebhook(req,env);}
  if(!['GET','POST'].includes(req.method))return appResponse({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET, POST'});
  if(path==='/api/app/v1/health'&&req.method==='GET'){const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_service_orders WHERE id=?').bind('__readiness__').first();return appResponse({status:row?'ready':'unavailable',storage:'D1',version:APP_VERSION,paymentConfirmation:env.NUMINA_STRIPE_WEBHOOK_SECRET?'configured':'not_configured',stablecoinExecution:false});}
  if(path==='/api/app/v1/catalog'&&req.method==='GET')return appResponse({offers:APP_OFFERS,operator:'SK Consulting LLC',initialCheckoutCountry:'US',internationalRequests:'review_before_checkout',scopeTerms:'Payment reserves the service. Scope, scheduling, authorized access and confidentiality must be confirmed before work begins. Production implementation and third-party costs are excluded unless separately agreed. If Numina cannot accept the engagement, payment will be refunded.'});
  const actor=await appActor(req,env);
  if(path==='/api/app/v1/session'&&req.method==='GET')return appResponse({email:actor.email,operator:actor.operator});
  await appRate(env.DB,await appDigest(actor.id+':'+req.method),req.method==='POST'?40:120,now);
  if(req.method==='POST'&&req.headers.get('origin')!==url.origin)appFail('ORIGIN_REQUIRED',403);
  if(path==='/api/app/v1/orders'&&req.method==='POST'){
   const body=appIntake(await appBody(req)),payloadHash=await appDigest(JSON.stringify(body));
   const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM numina_service_orders WHERE owner_subject=? AND status NOT IN ('complete','cancelled','declined')").bind(actor.id).first();
   const old=await env.DB.prepare('SELECT * FROM numina_service_orders WHERE owner_subject=? AND mutation_id=?').bind(actor.id,body.idempotencyKey).first();if(old){if(old.payload_hash!==payloadHash)appFail('IDEMPOTENCY_CONFLICT',409);return appResponse({order:await appOrderView(env.DB,old,actor),replayed:true});}
   if(count.n>=50)appFail('OPEN_REQUEST_LIMIT',429);
   const id='n_'+crypto.randomUUID();await env.DB.batch([
    env.DB.prepare("INSERT INTO numina_service_orders (id,owner_subject,owner_email,service,title,brief,success_criteria,country,status,revision,created_at,updated_at,mutation_id,payload_hash,consent_version) SELECT ?,?,?,?,?,?,?,?,'submitted',0,?,?,?,?,? WHERE (SELECT COUNT(*) FROM numina_service_orders WHERE owner_subject=? AND status NOT IN ('complete','cancelled','declined'))<50 ON CONFLICT(owner_subject,mutation_id) DO NOTHING").bind(id,actor.id,actor.email,body.service,body.title,body.brief,body.successCriteria,body.country,now,now,body.idempotencyKey,payloadHash,APP_VERSION,actor.id),
    env.DB.prepare("INSERT INTO numina_service_order_events (id,order_id,actor,action,note,revision,created_at,mutation_id,command_hash) SELECT ?,id,?,'submitted','Request submitted for scope review.',0,?,?,? FROM numina_service_orders WHERE id=? ON CONFLICT(order_id,revision) DO NOTHING").bind(crypto.randomUUID(),actor.id,now,body.idempotencyKey,payloadHash,id)
   ]);const row=await env.DB.prepare('SELECT * FROM numina_service_orders WHERE owner_subject=? AND mutation_id=?').bind(actor.id,body.idempotencyKey).first();if(!row)appFail('OPEN_REQUEST_LIMIT',429);if(row.payload_hash!==payloadHash)appFail('IDEMPOTENCY_CONFLICT',409);return appResponse({order:await appOrderView(env.DB,row,actor)},201);
  }
  if(path==='/api/app/v1/orders'&&req.method==='GET'){
   const after=url.searchParams.get('after')||'';if(after.length>100)appFail('INVALID_CURSOR');
   const all=actor.operator&&url.searchParams.get('scope')==='team';const rows=(await env.DB.prepare(all?'SELECT * FROM numina_service_orders WHERE id>? ORDER BY id LIMIT 26':'SELECT * FROM numina_service_orders WHERE owner_subject=? AND id>? ORDER BY id LIMIT 26').bind(...(all?[after]:[actor.id,after])).all()).results;
   return appResponse({orders:await Promise.all(rows.slice(0,25).map(r=>appOrderView(env.DB,r,actor))),next:rows.length>25?rows[24].id:null,scope:all?'team':'mine'});
  }
  const match=path.match(/^\/api\/app\/v1\/orders\/(n_[a-f0-9-]{36})(?:\/(events|actions|checkout))?$/);if(!match)appFail('NOT_FOUND',404);
  const row=await appOrder(env.DB,match[1],actor),operation=match[2];
  if(!operation&&req.method==='GET')return appResponse({order:await appOrderView(env.DB,row,actor)});
  if(operation==='events'&&req.method==='GET'){const events=(await env.DB.prepare('SELECT id,action,note,revision,created_at FROM numina_service_order_events WHERE order_id=? ORDER BY revision LIMIT 200').bind(row.id).all()).results;return appResponse({events});}
  if(operation==='checkout'&&req.method==='POST'){
   if(actor.id!==row.owner_subject)appFail('CUSTOMER_CHECKOUT_ONLY',403);
   if(APP_OFFERS[row.service]?.requestOnly)appFail('NUSD_NOT_ACTIVATED',409);
   if(!env.NUMINA_STRIPE_WEBHOOK_SECRET)appFail('PAYMENT_CONFIRMATION_UNAVAILABLE',503);
   const payment=await appOrderPayment(env.DB,row.id);if(!['submitted','scoped'].includes(row.status)||payment.status!=='unconfirmed')appFail('CHECKOUT_REVIEW_REQUIRED',409);
   if(row.country!=='US'&&row.status!=='scoped')appFail('COUNTRY_REVIEW_REQUIRED',409);
   const target=new URL(APP_OFFERS[row.service].url);target.searchParams.set('client_reference_id',row.id);return appResponse({url:target.href,orderId:row.id});
  }
  if(operation==='actions'&&req.method==='POST'){
   const body=await appBody(req),hash=await appDigest(JSON.stringify(body));const old=await env.DB.prepare('SELECT command_hash FROM numina_service_order_events WHERE order_id=? AND actor=? AND mutation_id=?').bind(row.id,actor.id,body?.idempotencyKey||'').first();if(old){if(old.command_hash!==hash)appFail('IDEMPOTENCY_CONFLICT',409);return appResponse({order:await appOrderView(env.DB,row,actor),replayed:true});}
   // Operators can administer their own requests; customer acceptance always belongs to the requester.
   const customerAction=['accept','request_changes','cancel'].includes(body.action);if(customerAction&&actor.id!==row.owner_subject)appFail('CUSTOMER_ACTION_ONLY',403);
   if(!customerAction&&!actor.operator)appFail('OPERATOR_REQUIRED',403);
   const change=appTransition(row,body,!customerAction,await appOrderPayment(env.DB,row.id));if(row.revision>=199)appFail('HISTORY_REVIEW_REQUIRED',409);
   const mutation=crypto.randomUUID();await env.DB.batch([
    env.DB.prepare('UPDATE numina_service_orders SET status=?,revision=revision+1,updated_at=?,last_mutation=? WHERE id=? AND revision=? AND payment_revision=?').bind(change.status,now,mutation,row.id,row.revision,row.payment_revision),
    env.DB.prepare('INSERT INTO numina_service_order_events (id,order_id,actor,action,note,revision,created_at,mutation_id,command_hash) SELECT ?,id,?,?,?,?,?,?,? FROM numina_service_orders WHERE id=? AND last_mutation=?').bind(crypto.randomUUID(),actor.id,change.action,change.note,row.revision+1,now,body.idempotencyKey,hash,row.id,mutation)
   ]);const updated=await appOrder(env.DB,row.id,actor);if(updated.last_mutation!==mutation)appFail('REVISION_CONFLICT',409);return appResponse({order:await appOrderView(env.DB,updated,actor)});
  }
  return appResponse({error:'METHOD_NOT_ALLOWED'},405);
 }catch(error){const code=error.code||'SERVICE_UNAVAILABLE';console.log(JSON.stringify({event:'app_error',route:path.slice(0,100),code}));return appResponse({error:code},error.status||503,code==='RATE_LIMITED'?{'Retry-After':'60'}:{});}
}

const NUSD_REDEMPTION_POLICY={"schema":"numina.nusd.redemption_policy.v1","policy_id":"nusd-redemption-proposal-1","status":"proposed_not_effective","effective_at":null,"redemption_available":false,"proposed_obligor":{"legal_name":"SK Consulting LLC","jurisdiction":"Iowa, USA","issuer_eligibility":"unverified"},"rate":{"base":"NUSD","quote":"USD","numerator":"1","denominator":"1","basis":"declared_issuer_conversion_policy","executable":false,"market_rate":null,"scope":"gross_issuance_and_redemption_after_activation"},"rights":{"beneficiary":"Any lawful holder, including a secondary holder, who satisfies objective onboarding and required screening for verified issued NUSD","payout_currency":"USD","treasury_ownership":false,"equity_or_yield":false,"terms_effective":false,"cash_claim_survives_delay":true},"timing":{"payout_initiation_banking_days":2,"starts":"Receipt of complete valid request; no discretionary acceptance delay","cutoff_local":"17:00","timezone":"America/New_York","banking_calendar":"Monday-Friday excluding US Federal Reserve banking holidays","after_cutoff":"Next US banking day","missing_information_notice_banking_days":1,"bank_receipt":"Receiving-bank posting time varies and must be disclosed separately","hold_review_banking_days":5},"fees":{"numina_redemption_fee_usd":"0","numina_fx_spread_bps":0,"standard_payout_fee_paid_by":"Numina","holder_network_fees":"Separately disclosed before authorization; no token transaction is presently available","receiving_bank_fees":"May be charged independently by the holder bank; not a Numina deduction"},"limits":{"minimum_nusd":"0.01","increment_nusd":"0.01","maximum":"Available verified holder balance; no routine monetary daily/monthly cap proposed","fractional_remainder":"Retained without expiry; final account closure remainder rounded up to one USD cent at Numina expense after identity verification","eligibility":["Verified legal holder and token/network identity","Required identity, sanctions and source-of-funds checks","Eligible jurisdiction and same-name supported USD bank account","No duplicate, encumbered or already-redeemed balance"],"permitted_holds":["Applicable law or court order","Unresolved identity, fraud, sanctions or ownership dispute"],"liquidity_shortfall_cancels_claim":false,"forced_service_credit":false},"reserves":{"source":"Numina Treasury","status":"unverified","custodian":null,"verified_usd_value":null,"holder_allocation":null,"minimum_coverage":"Segregated eligible external USD reserves cover outstanding NUSD including redemption-locked tokens, plus unpaid USD claims for burned tokens not otherwise counted; no claim counted twice","excluded":["Uncollected compute value","Projected revenue","Internally assigned treasury entries without external asset evidence","Numina-issued NUSD as its own backing","IP or enterprise valuation","Receivables and general Treasury claims"],"reporting_proposal":"Daily reconciliation; public monthly supply, reserve composition, custodian and independent assurance disclosures; no reports verified","permitted_assets_proposal":["US dollar cash","Eligible USD demand deposits with an insured depository institution","US Treasury obligations with remaining maturity of no more than 93 days; subject to applicable issuer and custody rules"],"owner_attestation":{"status":"received","evidence_type":"owner_statement","bank_evidence_received":false,"independent_verification":"not_completed","qualified_as_verified_reserves":false}},"activation_requirements":["Eligible identified issuer and applicable authorizations","Documented Treasury asset ownership, segregation, custody, liquidity and reconciliation","Effective signed holder terms and supported jurisdictions/banking rails","Verified Numina chain and deployed token identity with security review","Independently tested redemption funding, failure recovery and payout controls","Verified token precision and bank settlement rules supporting USD-cent amounts"],"contact":"mailto:skott34@gmail.com","terms_url":"/redemption","change_policy":{"ordinary_notice_calendar_days":30,"existing_usd_claim_may_be_reduced":false,"legal_changes":"As required by applicable law"},"complaints":{"acknowledgement_banking_days":2,"substantive_response_calendar_days":15}};
const NUSD_POLICY={
 schema:'numina.nusd.status.v1',
 asset:{name:'Numina USD',symbol:'NUSD',asset_id:null,chain:null,contract:null},
 network_policy:{name:'Numina',status:'provider_reported_live',chain_id:'962421430',rpc_url:'https://u0yth28mgh-u0re35asde-rpc.us0-aws.kaleido.io/',explorer_url:null,genesis_hash:null,provider:'Kaleido',network_type:'permissioned',environment_id:'u0yth28mgh',protocol:'Hyperledger Besu / IBFT',runtime_version:'23.10.2',evm_fork:'London',region:'AWS us-east-2 (Ohio)',validator_count:3,system_monitor_count:1,observed_at:'2026-09-12T16:07:17Z',observed_block_height:'99',evidence_type:'authenticated_provider_dashboard_observation',continuous_monitoring:false,authenticated_rpc_verified:false,rpc_authentication_required:true,independently_verified:false},
 asset_verification:{status:'unconfigured',evidence:[]},
 treasury_backing:{source:'Numina Treasury',status:'unverified',owner_attestation:NUSD_REDEMPTION_POLICY.reserves.owner_attestation,evidence:[],valuation:null,redemption:null},
 peg:{currency:'USD',target:'1',basis:'declared_policy',status:'target_not_verified',verified_redemption:false},
 conversion_policy:NUSD_REDEMPTION_POLICY.rate,
 redemption_policy:NUSD_REDEMPTION_POLICY,
 payment_policy:{scope:'all_compute_to_value_services',accepted_assets:['NUSD'],usd_conversion:null,usdc_fallback:false},
 capabilities:{quote:false,request:false,status:true,settlement:false,mint:false,transfer:false,redemption:false,exchange:false},
 service_pricing:{status:'not_available_for_purchase',unit:'NUSD',services:[
  {service_id:'authorization_check',name:'Authorization check',basis:'per accepted verification result'},
  {service_id:'result_access',name:'Numina Result Access',basis:'per accepted API result; scope and value agreed before execution'},
  {service_id:'workflow_delivery',name:'Verified workflow delivery',basis:'per accepted workflow outcome; scope and value agreed before execution'}
 ]},
 integration:{interfaces:['HTTP JSON','JSON Schema tool calling','MCP stdio adapter'],provider_coverage:'provider adapters and account connections require individual verification'},
 activation_requirements:['Deployed token identity and security review','Verified treasury assets, control, valuation and encumbrances','Issuer eligibility and service-country review','Effective holder redemption terms and verified funded payout operations','Order-bound payment verification and result entitlements'],
 operator:'SK Consulting LLC',terms:'/redemption'
};
async function nusdHttp(req){
 const path=new URL(req.url).pathname;
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(path==='/api/nusd/v1/redemption-policy'&&req.method==='GET')return new Response(JSON.stringify(NUSD_REDEMPTION_POLICY),{headers});
 if(path==='/api/nusd/v1/status'&&req.method==='GET')return new Response(JSON.stringify(NUSD_POLICY),{headers});
 if((path==='/api/nusd/v1/quotes'||path==='/api/nusd/v1/requests'||path==='/api/nusd/v1/redemptions'||path==='/api/nusd/v1/exchange')&&req.method==='POST'||/^\/api\/nusd\/v1\/requests\/[^/]+$/.test(path)&&req.method==='GET')return new Response(JSON.stringify({error:'NUSD_NOT_ACTIVATED',message:'NUSD issuance, treasury backing, redemption and payment verification are not activated.',status_url:'/api/nusd/v1/status'}),{status:503,headers});
 return new Response(JSON.stringify({error:'NOT_FOUND'}),{status:404,headers});
}

const security={"X-Numina-Version":"1.0.0","X-Numina-Profile":"numina-production","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()","Strict-Transport-Security":"max-age=31536000","Content-Security-Policy":"default-src 'self'; script-src 'self' 'sha256-aYEMNzcsae3bOvwUaJFZmEVp6/1k57R95RqDhWRBin4='; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests"};

function response(body,status=200,extra={}){return new Response(JSON.stringify(body),{status,headers:{...security,'Content-Type':'application/json','Cache-Control':'no-store',...extra}});}
export default {
 async fetch(req,env){
  const requestId=crypto.randomUUID(),start=Date.now(),url=new URL(req.url),path=url.pathname;let status=200;
  const finish=r=>{status=r.status;const headers=new Headers(r.headers);for(const [k,v]of Object.entries(security))headers.set(k,k==='Content-Security-Policy'&&path.startsWith('/api/control/v1/treasury-documents/')?"sandbox; default-src 'none'":v);headers.set('X-Request-Id',requestId);return new Response(r.body,{status:r.status,headers});};
  if(['numinalabs.xyz','www.numinalabs.xyz'].includes(url.hostname)&&url.protocol==='http:'){const target=new URL('https://'+url.hostname);target.pathname=path;target.search=url.search;return finish(new Response(null,{status:['GET','HEAD'].includes(req.method)?301:308,headers:{Location:target.href}}));}
  try{
   // Retired public test surfaces stay closed even if an environment is misconfigured.
   if(path.startsWith('/api/v0.1/')||['/api/core/v1.8/eac/verify','/api/core/v1.8/stability/assess'].includes(path))return finish(response({error:'REFERENCE_RUNTIME_RETIRED',message:'Use the production workspace, internal authority controls or release documentation.',workspace:'/app',documentation:'/core'},410));
   if(path.startsWith('/api/nusd/v1/'))return finish(await nusdHttp(req));
   if(path.startsWith('/api/app/v1/'))return finish(await appHttp(req,env));
   if(['/platform','/platform/','/platform.html'].includes(path))return finish(new Response(null,{status:308,headers:{Location:'/app'}}));
   const rc20=await routeRc20(req,env);if(rc20)return finish(rc20);
   if(path.startsWith('/api/control/'))return finish(await controlHttp(req,env));
   if(path==='/api/core/v1.8/manifest'&&req.method==='GET')return finish(response(CORE_MANIFEST));
   if(path==='/api/core/v1.8/context'&&req.method==='GET')return finish(response(CORE_CONTEXT));
   if(path.startsWith('/api/'))return finish(response({error:'NOT_FOUND'},404));
   return finish(await env.ASSETS.fetch(req));
  }catch{return finish(response({error:'SERVICE_UNAVAILABLE',requestId},503));}
  finally{if(path.startsWith('/api/'))console.log(JSON.stringify({event:'http_request',requestId,route:path.replace(/\/orders\/[^/]+/,'/orders/:id').replace(/\/treasury-documents\/[^/]+/,'/treasury-documents/:id').slice(0,120),method:req.method,status,durationMs:Date.now()-start}));}
 }
};
