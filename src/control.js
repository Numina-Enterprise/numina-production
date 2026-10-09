// NUMINA manifest reducer mechanics. No separate state identity, network effects, or device-local authority.
import {reduceTreasuryProjection} from './native-treasury-model.js';
import {reduceFrontier,frontierManifestView} from './frontier.js';
export const CONTROL_VERSION = '1.0.0';
export const CONTROL_SCOPES = ['request.create','evidence.attest','evidence.resolve','record.write','authority.delegate'];
export const CONTROL_ADAPTER = {id:'internal.record.v1',version:1,action:'record.write',externalExecution:false};
export function stable(value) {
  if(value===null || typeof value==='boolean') return JSON.stringify(value);
  if(typeof value==='number' && Number.isSafeInteger(value) && !Object.is(value,-0)) return String(value);
  if(typeof value==='string') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value && Object.getPrototypeOf(value)===Object.prototype) return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  throw new Error('INVALID_CANONICAL_VALUE');
}
export async function controlHash(value) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:stable(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
export function controlError(code,status=422) {throw Object.assign(new Error(code),{status,code});}
function demand(ok,code,status=422){if(!ok)controlError(code,status);}
function textField(value,max=160){return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);}
function controlExact(obj,keys){demand(obj&&Object.getPrototypeOf(obj)===Object.prototype&&Object.keys(obj).every(k=>keys.includes(k)),'UNKNOWN_FIELDS');}
function resourceWithin(resource,prefix){return prefix==='*'||resource.startsWith(prefix);}
function prefixWithin(child,parent){return parent==='*'||(child!=='*'&&child.startsWith(parent));}
export function initialControlManifest(owner,now) {
  return {schema:1,root:owner,createdAt:now,grants:[{id:'root',parent:null,subject:owner,scopes:[...CONTROL_SCOPES],resourcePrefix:'*',expiresAt:253402300799,revoked:false}],requests:[],evidence:[],records:[]};
}
export function grantValid(manifest,grant,now,seen=new Set()) {
  if(!grant||seen.has(grant.id)||seen.size>=8||grant.revoked||grant.expiresAt<=now)return false;
  if(grant.id==='root')return grant.parent===null&&grant.subject===manifest.root;
  seen.add(grant.id);const parent=manifest.grants.find(g=>g.id===grant.parent);
  return !!parent&&grantValid(manifest,parent,now,seen)&&parent.scopes.includes('authority.delegate')&&grant.scopes.every(s=>parent.scopes.includes(s))&&prefixWithin(grant.resourcePrefix,parent.resourcePrefix)&&grant.expiresAt<=parent.expiresAt;
}
export function authorizeControl(manifest,actor,scope,resource,now,grantId) {
  return manifest.grants.find(g=>(!grantId||g.id===grantId)&&g.subject===actor&&g.scopes.includes(scope)&&resourceWithin(resource,g.resourcePrefix)&&grantValid(manifest,g,now))||null;
}
function authorized(manifest,actor,scope,resource,now,grantId){const grant=authorizeControl(manifest,actor,scope,resource,now,grantId);demand(grant,'AUTHORITY_DENIED',403);return grant;}
export function normalizeRecord(input) {
  controlExact(input,['resource','payload']);demand(textField(input.resource,160)&&/^record:[a-zA-Z0-9_.:/-]+$/.test(input.resource),'INVALID_RESOURCE');
  demand(textField(input.payload,4000),'INVALID_PAYLOAD');
  const canonical={resource:input.resource,payload:input.payload};
  demand(stable(JSON.parse(stable(canonical)))===stable(input),'ADAPTER_SEMANTIC_LOSS');return canonical;
}
function selectedEvidence(manifest,request,key,now,visiting=new Set(),memo=new Map()){
  if(memo.has(key))return memo.get(key);
  if(visiting.has(key))return {reason:'EVIDENCE_DEPENDENCY_CYCLE'};
  visiting=new Set(visiting);visiting.add(key);
  const nodes=manifest.evidence.filter(e=>e.kind==='attestation'&&e.requestId===request.id&&e.key===key);
  if(!nodes.length)return {reason:'MISSING_EVIDENCE'};
  const resolution=manifest.evidence.filter(e=>e.kind==='resolution'&&e.requestId===request.id&&e.key===key&&authorizeControl(manifest,e.actor,'evidence.resolve',request.wants.resource,now,e.grantId)).at(-1);
  let active=nodes;
  if(resolution){const selected=nodes.find(e=>e.id===resolution.selectedId);const later=nodes.filter(e=>e.sequence>resolution.sequence);active=[selected,...later].filter(Boolean);}
  if(new Set(active.map(e=>e.value)).size>1)return {reason:'CONTRADICTORY_EVIDENCE'};
  const valid=active.filter(e=>e.expiresAt>now&&authorizeControl(manifest,e.actor,'evidence.attest',request.wants.resource,now,e.grantId)&&e.parents.every(id=>{
    const parent=manifest.evidence.find(p=>p.id===id);if(!parent||parent.kind!=='attestation'||parent.key===key)return false;
    const selected=selectedEvidence(manifest,request,parent.key,now,visiting,memo);return !!selected.nodes?.some(p=>p.id===id);
  }));
  const result=valid.length?{nodes:valid}:{reason:'STALE_EVIDENCE'};memo.set(key,result);return result;
}
function executionStatus(request){return request.execution?.status??request.execution?.state;}
export function reconcileControl(manifest,now) {
  // One event-driven loop; all decision projections are derived from the NUMINA manifest.
  return manifest.requests.map(request=>{
    if(executionStatus(request)==='committed')return {requestId:request.id,outcome:'ALLOW',reason:'INTERNAL_RECORD_COMMITTED',action:null};
    if(!authorizeControl(manifest,request.who,'record.write',request.wants.resource,now,request.authority))return {requestId:request.id,outcome:'DENY',reason:'AUTHORITY_UNAVAILABLE',action:null};
    if(request.route!==CONTROL_ADAPTER.id)return {requestId:request.id,outcome:'ESCALATE',reason:'UNSUPPORTED_ADAPTER',action:null};
    for(const key of request.policy.requiredEvidence){const result=selectedEvidence(manifest,request,key,now);if(result.reason)return {requestId:request.id,outcome:'ESCALATE',reason:result.reason,action:null};}
    return {requestId:request.id,outcome:'ALLOW',reason:'BOUNDS_AND_EVIDENCE_VERIFIED',action:'record.write'};
  });
}
export async function verifiedActions(manifest,revision,now,actor) {
  const manifestHash=await controlHash(manifest);const decisions=reconcileControl(manifest,now);
  return Promise.all(decisions.map(async d=>{
    const request=manifest.requests.find(r=>r.id===d.requestId);
    const canAct=!!authorizeControl(manifest,actor,'record.write',request.wants.resource,now);
    const next=d.action&&canAct?{kind:d.action,requestId:request.id,expectedRevision:revision,adapter:CONTROL_ADAPTER.id,actionId:await controlHash({revision,manifestHash,requestId:request.id,actor,kind:d.action})}:null;
    return {...d,nextAction:next};
  }));
}
export async function reduceControl(current,command,actor,revision,now) {
  controlExact(command,['id','expectedRevision','type','data']);demand(textField(command.id,100)&&/^[a-zA-Z0-9_-]+$/.test(command.id),'INVALID_COMMAND_ID');
  demand(command.expectedRevision===revision,'STALE_REVISION',409);demand(Number.isSafeInteger(now)&&now>0,'INVALID_TIME');
  const manifest=structuredClone(current),data=command.data;let result={};let parentIds=[];
  demand(data&&Object.getPrototypeOf(data)===Object.prototype,'INVALID_COMMAND');
  if(command.type==='request'){
    controlExact(data,['id','route','wants','requiredEvidence','grantId']);const wants=normalizeRecord(data.wants);
    demand(textField(data.id,100)&&!manifest.requests.some(r=>r.id===data.id),'REQUEST_ID_CONFLICT');demand(textField(data.route,100),'INVALID_ROUTE');
    demand(Array.isArray(data.requiredEvidence)&&data.requiredEvidence.length<=10&&data.requiredEvidence.every(k=>textField(k,80))&&new Set(data.requiredEvidence).size===data.requiredEvidence.length,'INVALID_EVIDENCE_REQUIREMENTS');
    authorized(manifest,actor,'request.create',wants.resource,now,data.grantId);const grant=authorized(manifest,actor,'record.write',wants.resource,now,data.grantId);
    manifest.requests.push({id:data.id,who:actor,wants,authority:grant.id,policy:{requiredEvidence:data.requiredEvidence},route:data.route,evidence:[],execution:{status:'pending'},settlement:{status:'not_applicable'},verifiedOutcome:null,createdAt:now});result={requestId:data.id};
  }else if(command.type==='attest'){
    controlExact(data,['requestId','key','value','expiresAt','parents']);const request=manifest.requests.find(r=>r.id===data.requestId);demand(request,'REQUEST_NOT_FOUND',404);demand(executionStatus(request)==='pending','REQUEST_FINAL',409);
    const grant=authorized(manifest,actor,'evidence.attest',request.wants.resource,now);demand(request.policy.requiredEvidence.includes(data.key)&&textField(data.value,2000),'INVALID_ATTESTATION');
    demand(Number.isSafeInteger(data.expiresAt)&&data.expiresAt>now&&data.expiresAt<=Math.min(now+86400,grant.expiresAt),'INVALID_EVIDENCE_EXPIRY');
    demand(Array.isArray(data.parents)&&data.parents.length<=10&&new Set(data.parents).size===data.parents.length&&data.parents.every(id=>manifest.evidence.some(e=>e.id===id&&e.requestId===request.id&&e.kind==='attestation'&&e.key!==data.key)),'INVALID_EVIDENCE_PARENTS');
    const node={id:command.id,sequence:revision+1,kind:'attestation',actor,grantId:grant.id,requestId:request.id,key:data.key,value:data.value,expiresAt:data.expiresAt,parents:data.parents,at:now,provenance:{source:'authenticated-operator',externalVerification:false}};
    node.hash=await controlHash(node);manifest.evidence.push(node);request.evidence.push(node.id);parentIds=[node.id];result={evidenceId:node.id};
  }else if(command.type==='resolve'){
    controlExact(data,['requestId','key','selectedId','reason']);const request=manifest.requests.find(r=>r.id===data.requestId);demand(request,'REQUEST_NOT_FOUND',404);demand(executionStatus(request)==='pending','REQUEST_FINAL',409);
    const grant=authorized(manifest,actor,'evidence.resolve',request.wants.resource,now);demand(textField(data.reason,1000),'RESOLUTION_REASON_REQUIRED');
    const nodes=manifest.evidence.filter(e=>e.kind==='attestation'&&e.requestId===request.id&&e.key===data.key);demand(nodes.some(e=>e.id===data.selectedId),'EVIDENCE_NOT_FOUND');
    const node={id:command.id,sequence:revision+1,kind:'resolution',actor,grantId:grant.id,requestId:request.id,key:data.key,selectedId:data.selectedId,reason:data.reason,parents:nodes.map(e=>e.id),at:now};node.hash=await controlHash(node);manifest.evidence.push(node);request.evidence.push(node.id);parentIds=[node.id];result={evidenceId:node.id};
  }else if(command.type==='delegate'){
    controlExact(data,['id','parent','subject','scopes','resourcePrefix','expiresAt']);const parent=manifest.grants.find(g=>g.id===data.parent);
    demand(parent&&parent.subject===actor&&grantValid(manifest,parent,now)&&parent.scopes.includes('authority.delegate'),'AUTHORITY_DENIED',403);
    demand(textField(data.id,100)&&!manifest.grants.some(g=>g.id===data.id),'GRANT_ID_CONFLICT');demand(textField(data.subject,254)&&(/^email:[^\s@]+@[^\s@]+$/.test(data.subject)||frontierManifestView(manifest).principals.some(p=>p.id===data.subject&&!p.revoked)),'INVALID_SUBJECT');
    demand(Array.isArray(data.scopes)&&data.scopes.length>0&&new Set(data.scopes).size===data.scopes.length&&data.scopes.every(s=>parent.scopes.includes(s)),'AUTHORITY_BROADENING');
    demand(textField(data.resourcePrefix,160)&&prefixWithin(data.resourcePrefix,parent.resourcePrefix),'AUTHORITY_BROADENING');
    demand(Number.isSafeInteger(data.expiresAt)&&data.expiresAt>now&&data.expiresAt<=parent.expiresAt&&data.expiresAt<=now+2592000,'AUTHORITY_BROADENING');
    const grant={...data,revoked:false};manifest.grants.push(grant);demand(grantValid(manifest,grant,now),'INVALID_GRANT_CHAIN');result={grantId:grant.id};
  }else if(command.type==='revoke'){
    controlExact(data,['grantId']);const grant=manifest.grants.find(g=>g.id===data.grantId);demand(grant&&grant.id!=='root','INVALID_GRANT');
    const parent=manifest.grants.find(g=>g.id===grant.parent);demand(actor===manifest.root||(parent?.subject===actor&&grantValid(manifest,parent,now)),'AUTHORITY_DENIED',403);grant.revoked=true;result={grantId:grant.id};
  }else if(command.type==='execute'){
    controlExact(data,['requestId','actionId']);const request=manifest.requests.find(r=>r.id===data.requestId);demand(request,'REQUEST_NOT_FOUND',404);authorized(manifest,actor,'record.write',request.wants.resource,now);
    const projected=(await verifiedActions(manifest,revision,now,actor)).find(d=>d.requestId===request.id);demand(projected.nextAction&&projected.nextAction.actionId===data.actionId,'NEXT_ACTION_NOT_VERIFIED',409);
    const normalized=normalizeRecord(request.wants);demand(!manifest.records.some(r=>r.requestId===request.id),'ALREADY_COMMITTED',409);
    const node={id:command.id,sequence:revision+1,kind:'execution',requestId:request.id,actor,at:now,adapter:CONTROL_ADAPTER.id,adapterVersion:1,parents:[...request.evidence],inputHash:await controlHash(normalized),outcome:'INTERNAL_RECORD_COMMITTED'};
    node.hash=await controlHash(node);manifest.evidence.push(node);request.evidence.push(node.id);manifest.records.push({...normalized,requestId:request.id,evidenceId:node.id,at:now});
    request.execution={status:'committed',recordId:request.id};request.verifiedOutcome={scope:'internal.record.v1',evidenceId:node.id,externalExecution:false};parentIds=[node.id];result={requestId:request.id,recordId:request.id,evidenceId:node.id};
  }else if(command.type==='treasury'){
    demand(actor===manifest.root&&grantValid(manifest,manifest.grants.find(grant=>grant.id==='root'),now),'TREASURY_AUTHORITY_DENIED',403);
    const treasury=reduceTreasuryProjection(manifest.nativeTreasury,data,actor,command.id);
    manifest.nativeTreasury=treasury.projection;result=treasury.result;
  }else if(command.type.startsWith('frontier.')){
    result=await reduceFrontier(manifest,command,actor,now);
  }else if(command.type==='reconcile'){
    controlExact(data,[]);demand(manifest.grants.some(g=>g.subject===actor&&grantValid(manifest,g,now)),'AUTHORITY_DENIED',403);result={reconciled:true};
  }else controlError('UNKNOWN_COMMAND');
  demand(manifest.requests.length<=100&&manifest.grants.length<=100&&manifest.evidence.length<=400,'MANIFEST_CAPACITY',409);
  return {manifest,result,parents:parentIds,decisions:reconcileControl(manifest,now)};
}
