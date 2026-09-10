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

function controlResponse(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Numina-Control-Version':CONTROL_VERSION}});}
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
      return controlResponse({status:healthy?'ready':'degraded',version:CONTROL_VERSION,architecture:'singular',sharedState:'D1',authority:'root-traceable-attenuated-grants',interoperability:[CONTROL_ADAPTER],evidence:'versioned-causal-DAG-and-hash-linked-journal',reconciliation:'event-driven-single-reducer',nextAction:'revision-and-evidence-bound',checks:{storage:true,stateIntegrity:true,evidenceHead:true,journalContinuity:count.n===row.revision+1,authorityConfigured:configured},revision:row.revision,eventCount:count.n,stateHash:row.state_hash,evidenceHead:row.head_hash,externalExecution:false,fullCoreConstitutionCertification:false},healthy?200:503);
    }
    if(req.method==='GET'&&path==='/api/control/v1/manifest')return controlResponse({version:CONTROL_VERSION,architecture:'singular',lifecycle:['REQUEST','AUTHORITY','POLICY','ROUTE','EXECUTION','SETTLEMENT','EVIDENCE','RECONCILIATION','VERIFIED_NEXT_STATE'],adapters:[CONTROL_ADAPTER],unsupportedAdapters:'ESCALATE',publicDemoCredentials:'not recognized',limits:{requests:100,grants:100,evidenceNodes:400,journalEvents:2048,stateBytes:524288},externalExecution:false,constitution:'Core v1.8 source preserved; full C1-C14 hosted certification not claimed'});
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
    if(path==='/api/control/v1/state'&&req.method==='GET')return controlResponse(await controlSnapshot(env.DB,actor,now));
    if(path==='/api/control/v1/next-action'&&req.method==='GET'){const snapshot=await controlSnapshot(env.DB,actor,now);return controlResponse({revision:snapshot.revision,decisions:snapshot.decisions});}
    if(path==='/api/control/v1/commands'&&req.method==='POST'){const body=await controlBody(req);return controlResponse(await commitControl(env.DB,body,actor,Math.floor(Date.now()/1000)));}
    if(path==='/api/control/v1/journal'&&req.method==='GET'){
      if(actor!==current.state.root)controlError('OWNER_VIEW_REQUIRED',403);
      const after=Number(new URL(req.url).searchParams.get('after')??-1);if(!Number.isSafeInteger(after)||after< -1)controlError('INVALID_CURSOR',400);
      const rows=await env.DB.prepare('SELECT event_json,hash FROM numina_control_events WHERE revision>? ORDER BY revision LIMIT 100').bind(after).all();return controlResponse({events:rows.results.map(r=>({event:JSON.parse(r.event_json),hash:r.hash})),next:rows.results.length?JSON.parse(rows.results.at(-1).event_json).revision:null});
    }
    return controlResponse({error:'NOT_FOUND'},404);
  }catch(error){const code=error.code||'DEPENDENCY_UNAVAILABLE',status=error.status||503;console.log(JSON.stringify({event:'control_error',route:path,code,status}));return controlResponse({status:'unavailable',error:code},status);}
}

const LIMIT=8192;
const security={"X-Numina-Version":"1.0.0","X-Numina-Profile":"numina-demo-rp-0.1","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()","Strict-Transport-Security":"max-age=31536000","Content-Security-Policy":"default-src 'self'; script-src 'self' 'sha256-aYEMNzcsae3bOvwUaJFZmEVp6/1k57R95RqDhWRBin4='; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests"};
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
  // Only known public hosts redirect; the destination never trusts forwarded headers.
  if(url.hostname==='numinalabs.xyz'||(url.hostname==='www.numinalabs.xyz'&&url.protocol==='http:')) {
   const target=new URL('https://www.numinalabs.xyz');target.pathname=url.pathname;target.search=url.search;
   return new Response(null,{status:['GET','HEAD'].includes(req.method)?301:308,headers:{...security,Location:target.href}});
  }
  let status=200,outcome,reason;
  const finish=r=>{status=r.status;r.headers.set('X-Request-Id',requestId);return r;};
  try {
   if(path.startsWith('/api/control/')){const r=await controlHttp(req,env);for(const [k,v]of Object.entries(security))r.headers.set(k,v);return finish(r);}
   if(env.NUMINA_CONTROL_OWNER&&req.method==='POST'&&['/api/v0.1/commit','/api/v0.1/verify'].includes(path))return finish(response({error:'DEMO_MUTATIONS_RETIRED',next:'/api/control/v1/next-action'},410));
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
  finally {if(path.startsWith('/api/'))console.log(JSON.stringify({event:'http_request',requestId,version:path.startsWith('/api/control/')?'1.0.0':VERSION,route:path.replace(/\/receipts\/.*/, '/receipts/:id').slice(0,120),method:req.method,status,outcome,reason,durationMs:Date.now()-start}));}
 }
};
