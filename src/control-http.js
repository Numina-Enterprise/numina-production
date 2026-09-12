import {CONTROL_VERSION,CONTROL_ADAPTER,stable,controlHash,controlError} from './control.js';
import {readControl,bootstrapControl,controlSnapshot,commitControl} from './control-store.js';
import {rateLimit} from './store.js';
const OWNER_TREASURY_STATEMENT={"schema":"numina.treasury.owner_statement.v1","classification":"owner_reported_not_independently_verified","source":"User statements in the Numina build conversation; not a bank feed or signed reserve report","reported_owner":"SK Consulting LLC","reported_institution":"Bank of America","reported_account_type":"Savings","reported_as_of":"2026-09-11","reported_currency":"USD","reported_amount_usd":"500000000000000","reported_custodian":"Numina","owner_reports_funding_authorized":true,"bank_evidence_received":false,"independent_verification":"not_completed","verified_reserve_amount_usd":null,"verified_allocation_usd":null,"funds_moved_by_this_record":false,"financial_capabilities_activated":false};
function controlResponse(body,status=200,extraHeaders={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Numina-Control-Version':CONTROL_VERSION,...extraHeaders}});}
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
export async function controlHttp(req,env){
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
  }catch(error){const code=error.code||'DEPENDENCY_UNAVAILABLE',status=error.status||503;console.log(JSON.stringify({event:'control_error',route:path,code,status}));return controlResponse({status:'unavailable',error:code},status);}
}
