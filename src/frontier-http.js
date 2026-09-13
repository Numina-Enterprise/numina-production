import {stable,controlHash,controlError,grantValid} from './control.js';
import {readControl,commitControl} from './control-store.js';
import {controlActor,controlBody} from './control-http.js';
import {createNuminaTreasury} from './native-treasury.js';
import {FRONTIER_VERSION,FRONTIER_PROVIDERS,frontierState,frontierRequest,frontierDecision,frontierAssert,frontierExact,frontierSign} from './frontier.js';
import {rateLimit} from './store.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {NUMINA_TREASURY_POLICY_V2} from './treasury-policy.js';

const frontierRoutes={principals:'principal',policies:'policy',requests:'request',approvals:'approval',prepare:'prepare',execute:'execute',revoke:'revoke','treasury/accounts':'account','treasury/consolidate':'consolidate','treasury/policy':'treasury_policy'};
const frontierToolNames={numina_request:'requests',numina_prepare:'prepare',numina_execute:'execute'};
const frontierTools=[{name:'numina_policy_decision',description:'Read a current policy decision for your registered request. This does not execute it.',inputSchema:{type:'object',properties:{requestId:{type:'string'}},required:['requestId'],additionalProperties:false}},...Object.keys(frontierToolNames).map(name=>({name,description:name==='numina_execute'?'Commit a permitted internal record through the canonical journal. External execution is unavailable.':name==='numina_prepare'?'Prepare a provider handoff; no external submission.':'Register a request under existing delegated authority and a server policy.',inputSchema:{type:'object',properties:{id:{type:'string'},expectedRevision:{type:'integer'},data:{type:'object'}},required:['id','expectedRevision','data'],additionalProperties:false}}))];
function frontierResponse(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization, Cookie'}});}
async function frontierJson(req){
  // Bound transport input before parsing; JSON-RPC does not require canonical wire JSON.
  if(req.headers.get('content-type')?.split(';')[0]!=='application/json'||req.headers.has('content-encoding'))controlError('JSON_REQUIRED',415);
  const reader=req.body?.getReader();if(!reader)controlError('EMPTY_BODY',400);
  let length=0;const chunks=[],deadline=Date.now()+5000;
  for(;;){let timer,part;try{part=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('BODY_TIMEOUT'),{code:'BODY_TIMEOUT',status:408})),Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}if(part.done)break;length+=part.value.byteLength;if(length>16384){await reader.cancel();controlError('BODY_TOO_LARGE',413);}chunks.push(part.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{controlError('INVALID_JSON',400);}
}
async function frontierActor(req,env,row){
  const bearer=req.headers.get('authorization');
  if(bearer?.startsWith('Bearer ')){
    const hash=await controlHash(bearer.slice(7)),p=frontierState(row.state).principals.find(p=>!p.revoked&&p.credentialSha256===hash);
    if(p)return p.id;
  }
  return controlActor(req,env);
}
export async function frontierReceipt(db,eventId,actor,env){
  const row=await readControl(db),event=row.journalEvents.find(e=>e.id===eventId);
  frontierAssert(event&&event.type.startsWith('frontier.'),'RECEIPT_NOT_FOUND',404);
  frontierAssert(actor===row.state.root||event.actor===actor,'AUTHORITY_DENIED',403);
  // Commands can contain credential digests; export only hashes and the recorded result.
  return frontierSign({scope:'Numina internal journal',root:row.state.root,eventId:event.id,revision:event.revision,at:event.at,actor:event.actor,type:event.type,commandHash:event.commandHash,previousHead:event.previous,eventHash:await controlHash(event),stateHash:event.stateHash,result:event.result,externalReceipt:null},env);
}
async function frontierMutate(route,body,actor,env){
  frontierExact(body,['id','expectedRevision','data']);
  frontierAssert(env.NUMINA_LIVEMODE==='true','PRODUCTION_MODE_REQUIRED',503);
  if(route==='treasury/accounts'){
    frontierExact(body.data,['id','provider','legalEntity','accountLabel','providerAccountReference']);
    const current=await readControl(env.DB);frontierAssert(actor===current.state.root,'OWNER_REQUIRED',403);
    const existing=frontierState(current.state).accounts.find(a=>!a.supersededBy&&['provider','legalEntity','accountLabel','providerAccountReference'].every(k=>a[k]===body.data[k]));
    if(existing&&existing.id!==body.data.id)return {status:'REFERENCE_ALREADY_EXISTS',id:existing.id,journalCommit:false,receipt:null};
  }
  // Verify persistent signing configuration before committing any frontier operation.
  await frontierSign({scope:'configuration-check'},env);
  const result=await commitControl(env.DB,{...body,type:'frontier.'+frontierRoutes[route]},actor,Math.floor(Date.now()/1000));
  return {...result,receipt:await frontierReceipt(env.DB,body.id,actor,env)};
}
async function frontierCall(name,args,actor,env){
  if(name==='numina_policy_decision'){frontierExact(args,['requestId']);const row=await readControl(env.DB);return frontierDecision(row.state,frontierRequest(row.state,args.requestId,actor),Math.floor(Date.now()/1000));}
  frontierAssert(Object.hasOwn(frontierToolNames,name),'UNKNOWN_TOOL',400);return frontierMutate(frontierToolNames[name],args,actor,env);
}
async function frontierRpc(req,env,actor){
  const msg=await frontierJson(req),id=msg?.id??null;
  const error=(code,message)=>frontierResponse({jsonrpc:'2.0',id,error:{code,message}});
  if(!msg||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||(id!==null&&typeof id!=='string'&&!Number.isSafeInteger(id)))return error(-32600,'Invalid Request');
  if(!Object.hasOwn(msg,'id'))return new Response(null,{status:202});
  const result=value=>frontierResponse({jsonrpc:'2.0',id,result:value});
  if(new URL(req.url).pathname.endsWith('/a2a')){
    if(msg.method!=='message/send')return error(-32601,'Method not found');
    const message=msg.params?.message,part=message?.parts?.[0];
    if(message?.role!=='user'||typeof message.messageId!=='string'||message.parts.length!==1||part?.kind!=='data'||!part.data)return error(-32602,'Expected one data part with tool and arguments');
    try{const value=await frontierCall(part.data.tool,part.data.arguments,actor,env);return result({kind:'message',messageId:crypto.randomUUID(),role:'agent',parts:[{kind:'data',data:value}]});}catch(e){return error(-32000,e.code||'SERVICE_UNAVAILABLE');}
  }
  const version=req.headers.get('MCP-Protocol-Version');
  if(version&&version!=='2025-11-25')return error(-32602,'Supported MCP protocol version: 2025-11-25');
  if(msg.method==='initialize')return result({protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'numina-control',version:FRONTIER_VERSION}});
  if(msg.method==='ping')return result({});
  if(msg.method==='tools/list')return result({tools:frontierTools});
  if(msg.method!=='tools/call')return error(-32601,'Method not found');
  try{const value=await frontierCall(msg.params?.name,msg.params?.arguments,actor,env);return result({content:[{type:'text',text:JSON.stringify(value)}],isError:false});}catch(e){return result({content:[{type:'text',text:JSON.stringify({error:e.code||'SERVICE_UNAVAILABLE'})}],isError:true});}
}
async function frontierDiscovery(req,env){
  const msg=await frontierJson(req),id=msg?.id??null;
  const error=(code,message)=>frontierResponse({jsonrpc:'2.0',id,error:{code,message}});
  if(!msg||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||(id!==null&&typeof id!=='string'&&!Number.isSafeInteger(id)))return error(-32600,'Invalid Request');
  if(!Object.hasOwn(msg,'id'))return new Response(null,{status:202});
  const result=value=>frontierResponse({jsonrpc:'2.0',id,result:value});
  const version=req.headers.get('MCP-Protocol-Version');
  if(version&&version!=='2025-11-25')return error(-32602,'Supported MCP protocol version: 2025-11-25');
  if(msg.method==='initialize')return result({protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'numina-discovery',version:FRONTIER_VERSION}});
  if(msg.method==='ping')return result({});
  const names={numina_architecture:'Read Numina L1 through L5 architecture layers.',numina_capabilities:'Read current production capability flags and provider availability.',numina_head:'Read the current public journal head and revision; does not read private records.'};
  if(msg.method==='tools/list')return result({tools:Object.entries(names).map(([name,description])=>({name,description,inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}))});
  if(msg.method!=='tools/call')return error(-32601,'Method not found');
  if(!Object.hasOwn(names,msg.params?.name??'')||!msg.params.arguments||Array.isArray(msg.params.arguments)||typeof msg.params.arguments!=='object'||Object.keys(msg.params.arguments).length)return error(-32602,'Expected a listed tool and empty arguments');
  let data;
  if(msg.params.name==='numina_architecture')data=NUMINA_LAYERS;
  else if(msg.params.name==='numina_capabilities')data={version:FRONTIER_VERSION,livemode:env.NUMINA_LIVEMODE==='true',environment:'production',decisions:['ALLOW','DENY','ESCALATE'],providers:FRONTIER_PROVIDERS,externalExecution:false,privateControl:'/api/control/v2/mcp',treasury:'/api/control/v1/treasury'};
  else {const row=await readControl(env.DB);data={schema:'numina.public-head.v1',revision:row.revision,head:row.head_hash,stateHash:row.state_hash,journalContinuity:row.eventCount===row.revision+1,scope:'internal journal',financialVerification:false};}
  return result({content:[{type:'text',text:JSON.stringify(data)}],isError:false});
}
export async function frontierHttp(req,env){
  const path=new URL(req.url).pathname;
  try{
    if(path==='/api/control/v2/architecture'&&req.method==='GET')return frontierResponse(NUMINA_LAYERS);
    if(path==='/.well-known/agent-card.json')return frontierResponse({protocolVersion:'0.3.0',name:'Numina Control',description:'Delegated requests, policy decisions and internal records.',url:new URL('/api/control/v2/a2a',req.url).href,version:FRONTIER_VERSION,preferredTransport:'JSONRPC',capabilities:{streaming:false,pushNotifications:false},defaultInputModes:['application/json'],defaultOutputModes:['application/json'],skills:[{id:'governed-actions',name:'Governed actions',description:'Send one data part containing tool and arguments. Human approvals are recorded separately by the owner.',tags:['policy','provenance']}],securitySchemes:{bearer:{type:'http',scheme:'bearer'}},security:[{bearer:[]}]});
    if(path==='/api/control/v2/manifest'&&req.method==='GET')return frontierResponse({schema:'numina.frontier.v2',version:FRONTIER_VERSION,livemode:env.NUMINA_LIVEMODE==='true',environment:'production',architecture:'/api/control/v2/architecture',discoveryMcp:'/api/control/v2/discovery-mcp',decisions:['ALLOW','DENY','ESCALATE'],providers:FRONTIER_PROVIDERS,treasury:'/api/control/v1/treasury',treasuryPolicy:'/api/control/v2/treasury/policy',mcp:{url:'/api/control/v2/mcp',protocolVersion:'2025-11-25'},a2a:{url:'/api/control/v2/a2a',protocolVersion:'0.3.0'},externalExecution:false});
    if(path==='/api/control/v2/keys'&&req.method==='GET'){const jwk=JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK);return frontierResponse({keys:[{kty:'OKP',crv:'Ed25519',x:jwk.x,kid:await controlHash({crv:jwk.crv,kty:jwk.kty,x:jwk.x})}]});}
    if(!['GET','POST'].includes(req.method))return frontierResponse({error:'METHOD_NOT_ALLOWED'},405);
    const now=Math.floor(Date.now()/1000),bucket=await controlHash('frontier:'+Math.floor(now/86400)+':'+(req.headers.get('cf-connecting-ip')||'unknown'));
    if(!await rateLimit(env.DB,bucket,now))return frontierResponse({error:'RATE_LIMITED'},429);
    if(path==='/api/control/v2/head'&&req.method==='GET'){
      const row=await readControl(env.DB);
      return frontierResponse({schema:'numina.public-head.v1',rootHash:await controlHash(row.state.root),revision:row.revision,head:row.head_hash,stateHash:row.state_hash,eventCount:row.eventCount,journalContinuity:row.eventCount===row.revision+1,scope:'Numina canonical internal journal',blockchainConnection:'/v2/network/status',blockchainAnchorVerified:false});
    }
    if(path==='/api/control/v2/treasury/policy'&&req.method==='GET'){
      const row=await readControl(env.DB),record=frontierState(row.state).treasuryPolicies?.at(-1);
      return frontierResponse({policy:NUMINA_TREASURY_POLICY_V2,policyHash:await controlHash(NUMINA_TREASURY_POLICY_V2),activation:record?{status:'OWNER_POLICY_RECORDED',policyId:record.id,policyHash:record.hash,eventId:record.eventId,recordedAt:record.recordedAt}:{status:'AWAITING_OWNER_RECORD'},revision:row.revision});
    }
    if(path==='/api/control/v2/discovery-mcp'){
      if(req.headers.has('origin')&&req.headers.get('origin')!==new URL(req.url).origin)controlError('ORIGIN_DENIED',403);
      return req.method==='POST'?frontierDiscovery(req,env):frontierResponse({error:'METHOD_NOT_ALLOWED'},405);
    }
    if(path==='/api/control/v2/sandbox')return frontierResponse({error:'NOT_FOUND'},404);
    const row=await readControl(env.DB);frontierAssert(row.state.root===env.NUMINA_CONTROL_OWNER,'ROOT_CONFIGURATION_MISMATCH',503);
    const actor=await frontierActor(req,env,row);
    frontierAssert(actor===row.state.root||frontierState(row.state).principals.some(p=>p.id===actor&&!p.revoked),'AUTHORITY_DENIED',403);
    if(req.headers.has('origin')&&req.headers.get('origin')!==new URL(req.url).origin)controlError('ORIGIN_DENIED',403);
    if(req.method==='POST'&&!req.headers.has('authorization')&&req.headers.get('origin')!==new URL(req.url).origin)controlError('ORIGIN_REQUIRED',403);
    if(['/api/control/v2/mcp','/api/control/v2/a2a'].includes(path))return req.method==='POST'?frontierRpc(req,env,actor):frontierResponse({error:'METHOD_NOT_ALLOWED'},405);
    const route=path.slice('/api/control/v2/'.length);
    if(route==='decisions/batch'&&req.method==='POST'){
      const body=await controlBody(req);frontierExact(body,['requestIds']);
      frontierAssert(Array.isArray(body.requestIds)&&body.requestIds.length>0&&body.requestIds.length<=100&&body.requestIds.every(id=>typeof id==='string')&&new Set(body.requestIds).size===body.requestIds.length,'INVALID_DECISION_BATCH',400);
      const requests=body.requestIds.map(id=>frontierRequest(row.state,id,actor));
      const decisions=await Promise.all(requests.map(async request=>({requestId:request.id,...await frontierDecision(row.state,request,now)})));
      return frontierResponse({revision:row.revision,head:row.head_hash,observedAt:now,decisions});
    }
    if(route==='state'&&req.method==='GET'){
      const f=structuredClone(frontierState(row.state));for(const p of f.principals)delete p.credentialSha256;
      if(actor!==row.state.root){f.principals=f.principals.filter(p=>p.id===actor);f.requests=f.requests.filter(r=>r.Principal===actor);f.approvals=f.approvals.filter(a=>f.requests.some(r=>r.id===a.requestId));f.accounts=[];delete f.treasuryPolicies;const ids=new Set(f.requests.map(r=>r.policyId));f.policies=f.policies.filter(p=>ids.has(p.id));}
      return frontierResponse({revision:row.revision,head:row.head_hash,root:row.state.root,...f});
    }
    if(route==='decisions'&&req.method==='POST'){const body=await controlBody(req);frontierExact(body,['requestId']);const request=frontierRequest(row.state,body.requestId,actor);return frontierResponse(await frontierDecision(row.state,request,now));}
    if(route.startsWith('receipts/')&&req.method==='GET')return frontierResponse(await frontierReceipt(env.DB,route.slice(9),actor,env));
    if(route==='treasury/accounts'&&req.method==='GET'){
      frontierAssert(actor===row.state.root,'OWNER_REQUIRED',403);
      return frontierResponse({treasury:await createNuminaTreasury({db:env.DB,principal:actor,root:row.state.root}).readTreasury(),accounts:frontierState(row.state).accounts.filter(a=>!a.supersededBy),supersededReferences:frontierState(row.state).accounts.filter(a=>a.supersededBy),providerObservationRoute:'/api/control/v1/stripe-treasury',bankObservationStatus:'NOT_CONNECTED'});
    }
    if(Object.hasOwn(frontierRoutes,route)&&req.method==='POST')return frontierResponse(await frontierMutate(route,await controlBody(req),actor,env));
    return frontierResponse({error:'NOT_FOUND'},404);
  }catch(e){return frontierResponse({error:e.code||'DEPENDENCY_UNAVAILABLE'},e.status||503);}
}
