import {stable,controlHash,controlError,authorizeControl,normalizeRecord} from './control.js';
import {NUMINA_TREASURY_POLICIES} from './treasury-policy.js';

export const FRONTIER_VERSION='2.2.0';
export const FRONTIER_PROVIDERS=[
  {id:'internal.record.v1',kind:'internal',submission:true},
  ...['circle','arc','ripple','fireblocks','anchorage','bitgo','copper','stripe','bank-of-america','trm','chainalysis','elliptic','government'].map(id=>({id,kind:['trm','chainalysis','elliptic'].includes(id)?'intelligence':'external',submission:false}))
];
export function frontierAssert(ok,code,status=422){if(!ok)controlError(code,status);}
export function frontierExact(value,keys){frontierAssert(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(value,k)),'INVALID_FRONTIER_FIELDS',400);}
function frontierText(value,max=160){return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);}
function frontierId(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);}
function frontierAmount(value){frontierAssert(typeof value==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(value),'INVALID_AMOUNT',400);return BigInt(value);}
export function frontierState(state){return state.frontier||{principals:[],policies:[],requests:[],approvals:[],accounts:[]};}
export function frontierRequest(state,id,actor){const r=frontierState(state).requests.find(r=>r.id===id);frontierAssert(r,'REQUEST_NOT_FOUND',404);frontierAssert(actor===state.root||r.Principal===actor,'AUTHORITY_DENIED',403);return r;}
export function frontierValidateRequest(data){
  frontierExact(data,['id','Principal','Authority','Objective','Intent','policyId']);
  frontierAssert(frontierId(data.id)&&frontierText(data.Principal,254)&&frontierText(data.Authority,100)&&frontierText(data.Objective,160)&&frontierId(data.policyId),'INVALID_REQUEST',400);
  frontierExact(data.Intent,['action','provider','resource','amountMinor','currency','payload']);
  const i=data.Intent;frontierAssert(frontierText(i.action,60)&&frontierText(i.provider,80)&&frontierText(i.resource,160)&&frontierText(i.payload,4000)&&/^[A-Z]{3,6}$/.test(i.currency),'INVALID_INTENT',400);frontierAmount(i.amountMinor);
  return data;
}
export async function frontierDecision(state,request,now){
  const f=frontierState(state),policy=f.policies.find(p=>p.id===request.policyId),i=request.Intent;
  const base={schema:'numina.policy-decision.v2',requestId:request.id,principal:request.Principal,authority:request.Authority,policyVersion:policy?.version??null,policyHash:policy?.hash??null,requestHash:await controlHash({id:request.id,Principal:request.Principal,Authority:request.Authority,Objective:request.Objective,Intent:request.Intent,policyId:request.policyId}),evaluatedAt:now,executionPermitted:false,externalExecution:false};
  const answer=(decision,reason,executionPermitted=false)=>({...base,decision,reason,executionPermitted,approvalHook:decision==='ESCALATE'&&reason==='HUMAN_APPROVAL_REQUIRED'?'/api/control/v2/approvals':null});
  if(request.Principal!==state.root&&!f.principals.some(p=>p.id===request.Principal&&!p.revoked))return answer('DENY','PRINCIPAL_UNAVAILABLE');
  if(!authorizeControl(state,request.Principal,'request.create',i.resource,now,request.Authority)||!authorizeControl(state,request.Principal,'record.write',i.resource,now,request.Authority))return answer('DENY','AUTHORITY_UNAVAILABLE');
  if(!policy||policy.expiresAt<=now||request.policyHash&&policy.hash!==request.policyHash)return answer('DENY','POLICY_UNAVAILABLE');
  if(!policy.actions.includes(i.action)||!policy.providers.includes(i.provider)||!i.resource.startsWith(policy.resourcePrefix)||i.currency!==policy.currency)return answer('DENY','POLICY_SCOPE_DENIED');
  const spent=f.requests.filter(r=>r.policyId===policy.id&&r.execution?.status==='FINAL'&&r.id!==request.id).reduce((n,r)=>n+frontierAmount(r.Intent.amountMinor),0n);
  if(frontierAmount(i.amountMinor)>frontierAmount(policy.maxAmountMinor)||spent+frontierAmount(i.amountMinor)>frontierAmount(policy.totalAmountMinor))return answer('DENY','SPEND_LIMIT_EXCEEDED');
  if(policy.requireHumanApproval){
    const approval=f.approvals.find(a=>a.requestId===request.id);
    if(approval?.decision==='DENY')return answer('DENY','HUMAN_DENIED');
    if(!approval||approval.expiresAt<=now||approval.requestHash!==base.requestHash||approval.policyHash!==policy.hash)return answer('ESCALATE','HUMAN_APPROVAL_REQUIRED');
  }
  const provider=FRONTIER_PROVIDERS.find(p=>p.id===i.provider);
  if(!provider?.submission)return answer('ESCALATE','PROVIDER_NOT_CONNECTED');
  if(i.provider!=='internal.record.v1'||i.action!=='record.write'||i.amountMinor!=='0')return answer('DENY','UNSUPPORTED_EXECUTION');
  return answer('ALLOW','AUTHORITY_AND_POLICY_VERIFIED',true);
}

export async function reduceFrontier(state,command,actor,now){
  const data=command.data,f=state.frontier??=frontierState(state);let result;
  const owner=()=>frontierAssert(actor===state.root,'OWNER_REQUIRED',403);
  if(command.type==='frontier.principal'){
    owner();frontierExact(data,['id','name','credentialSha256']);
    frontierAssert(/^agent:[A-Za-z0-9_-]{1,80}$/.test(data.id)&&frontierText(data.name)&&/^[a-f0-9]{64}$/.test(data.credentialSha256),'INVALID_PRINCIPAL',400);
    frontierAssert(!f.principals.some(p=>p.id===data.id||p.credentialSha256===data.credentialSha256),'PRINCIPAL_CONFLICT',409);
    f.principals.push({...data,issuer:actor,createdAt:now,revoked:false});result={principal:data.id,status:'REGISTERED',authorityGranted:false};
  }else if(command.type==='frontier.revoke'){
    owner();frontierExact(data,['principal']);const p=f.principals.find(p=>p.id===data.principal);frontierAssert(p,'PRINCIPAL_NOT_FOUND',404);p.revoked=true;result={principal:p.id,status:'REVOKED'};
  }else if(command.type==='frontier.policy'){
    owner();frontierExact(data,['id','version','actions','providers','resourcePrefix','currency','maxAmountMinor','totalAmountMinor','requireHumanApproval','expiresAt']);
    frontierAssert(frontierId(data.id)&&frontierText(data.version,80)&&!f.policies.some(p=>p.id===data.id),'POLICY_CONFLICT',409);
    for(const field of ['actions','providers'])frontierAssert(Array.isArray(data[field])&&data[field].length>0&&data[field].length<=20&&new Set(data[field]).size===data[field].length&&data[field].every(v=>frontierText(v,80)),'INVALID_POLICY',400);
    frontierAssert(data.providers.every(id=>FRONTIER_PROVIDERS.some(p=>p.id===id))&&frontierText(data.resourcePrefix)&&/^[A-Z]{3,6}$/.test(data.currency)&&typeof data.requireHumanApproval==='boolean'&&Number.isSafeInteger(data.expiresAt)&&data.expiresAt>now,'INVALID_POLICY',400);
    frontierAssert(frontierAmount(data.maxAmountMinor)<=frontierAmount(data.totalAmountMinor),'INVALID_POLICY_LIMIT',400);
    const policy={...data,hash:await controlHash(data),issuer:actor};f.policies.push(policy);result={policyId:policy.id,policyHash:policy.hash,status:'REGISTERED'};
  }else if(command.type==='frontier.request'){
    frontierValidateRequest(data);frontierAssert(data.Principal===actor,'PRINCIPAL_MISMATCH',403);frontierAssert(!f.requests.some(r=>r.id===data.id),'REQUEST_CONFLICT',409);
    const decision=await frontierDecision(state,data,now);frontierAssert(decision.decision!=='DENY',decision.reason,403);
    const r={...data,policyHash:decision.policyHash,createdAt:now,execution:null,handoff:null};f.requests.push(r);result={requestId:r.id,decision};
  }else if(command.type==='frontier.approval'){
    owner();frontierExact(data,['requestId','decision','expiresAt','reason']);const r=frontierRequest(state,data.requestId,actor);
    frontierAssert(!r.execution&&!f.approvals.some(a=>a.requestId===r.id),'APPROVAL_ALREADY_FINAL',409);
    frontierAssert(['ALLOW','DENY'].includes(data.decision)&&frontierText(data.reason,1000)&&Number.isSafeInteger(data.expiresAt)&&data.expiresAt>now&&data.expiresAt<=now+3600,'INVALID_APPROVAL',400);
    const d=await frontierDecision(state,r,now);f.approvals.push({...data,actor,requestHash:d.requestHash,policyHash:r.policyHash,at:now});result={requestId:r.id,approval:data.decision,requestHash:d.requestHash,policyHash:r.policyHash};
  }else if(command.type==='frontier.prepare'||command.type==='frontier.execute'){
    frontierExact(data,['requestId']);const r=frontierRequest(state,data.requestId,actor);frontierAssert(actor===r.Principal,'PRINCIPAL_MISMATCH',403);frontierAssert(!r.execution,'REQUEST_FINAL',409);
    const decision=await frontierDecision(state,r,now);frontierAssert(decision.decision!=='DENY',decision.reason,403);
    const binding={principalHash:await controlHash(r.Principal===state.root?{id:state.root}:f.principals.find(p=>p.id===r.Principal)),authorityHash:await controlHash(state.grants.find(g=>g.id===r.Authority)),policyHash:r.policyHash,requestHash:decision.requestHash,decisionHash:await controlHash(decision)};
    if(command.type==='frontier.prepare'){
      frontierAssert(!r.handoff,'HANDOFF_ALREADY_PREPARED',409);
      r.handoff={schema:'numina.provider-handoff.v2',provider:r.Intent.provider,intent:r.Intent,status:'PREPARED',submissionPerformed:false,externalReceipt:null,...binding};
      result={requestId:r.id,decision,handoff:r.handoff,status:'PREPARED'};
    }else{
      frontierAssert(decision.decision==='ALLOW'&&decision.executionPermitted,'EXECUTION_NOT_ALLOWED',409);
      const record=normalizeRecord({resource:r.Intent.resource,payload:r.Intent.payload});
      frontierAssert(!state.records.some(x=>x.requestId===r.id),'RECORD_CONFLICT',409);
      state.records.push({...record,requestId:r.id,evidenceId:command.id,at:now});
      r.execution={status:'FINAL',eventId:command.id,at:now,scope:'internal.record.v1'};
      result={requestId:r.id,status:'FINAL',decision,...binding,handoffHash:r.handoff?await controlHash(r.handoff):null,recordHash:await controlHash(record),externalReceipt:null,externalExecution:false};
    }
  }else if(command.type==='frontier.treasury_policy'){
    owner();frontierExact(data,['policyId','policyHash']);
    const policy=Object.hasOwn(NUMINA_TREASURY_POLICIES,data.policyId)?NUMINA_TREASURY_POLICIES[data.policyId]:null;
    frontierAssert(policy,'UNKNOWN_TREASURY_POLICY',400);
    const hash=await controlHash(policy);frontierAssert(data.policyHash===hash,'TREASURY_POLICY_HASH_MISMATCH',409);
    const policies=f.treasuryPolicies??=[];
    frontierAssert(!policies.some(p=>p.id===policy.id),'TREASURY_POLICY_ALREADY_RECORDED',409);
    frontierAssert(!policies.length||policy.version>policies.at(-1).version,'TREASURY_POLICY_VERSION_CONFLICT',409);
    policies.push({...structuredClone(policy),hash,issuer:actor,recordedAt:now,eventId:command.id});
    result={status:'OWNER_POLICY_RECORDED',policyId:policy.id,policyHash:hash,treasuryRoute:'/api/control/v1/treasury',projectionChanged:false,externalAccountsChanged:false,reservesVerified:false,redemptionActivated:false};
  }else if(command.type==='frontier.consolidate'){
    owner();frontierExact(data,[]);const retained=new Map(),superseded=[];
    for(const account of f.accounts){if(account.supersededBy)continue;const identity=stable({provider:account.provider,legalEntity:account.legalEntity,accountLabel:account.accountLabel,providerAccountReference:account.providerAccountReference});const previous=retained.get(identity);if(previous){account.supersededBy=previous.id;superseded.push({id:account.id,retainedId:previous.id});}else retained.set(identity,account);}
    result={status:'REFERENCES_CONSOLIDATED',superseded,treasuryRoute:'/api/control/v1/treasury',externalAccountsChanged:false};
  }else if(command.type==='frontier.account'){
    owner();frontierExact(data,['id','provider','legalEntity','accountLabel','providerAccountReference']);
    frontierAssert(frontierId(data.id)&&['bank-of-america','stripe'].includes(data.provider)&&frontierText(data.legalEntity)&&frontierText(data.accountLabel)&&(data.providerAccountReference===null||frontierText(data.providerAccountReference))&&!f.accounts.some(a=>a.id===data.id),'INVALID_ACCOUNT_LINK',400);
    f.accounts.push({...data,source:'owner_designation',linkedAt:now,providerOwnershipVerified:false});result={id:data.id,status:'LINKED_REFERENCE',treasuryRoute:'/api/control/v1/treasury',providerOwnershipVerified:false};
  }else controlError('UNKNOWN_COMMAND');
  frontierAssert(f.principals.length<=100&&f.policies.length<=100&&f.requests.length<=100&&f.approvals.length<=100&&f.accounts.length<=20,'STATE_CAPACITY',409);
  return result;
}

export async function frontierSign(payload,env){
  try{
    const privateJwk=JSON.parse(env.NUMINA_RECEIPT_PRIVATE_JWK),publicJwk=JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK);
    frontierAssert(privateJwk.kty==='OKP'&&privateJwk.crv==='Ed25519'&&privateJwk.d&&privateJwk.x===publicJwk.x&&!publicJwk.d,'SIGNING_KEY_INVALID',503);
    const keyId=await controlHash({crv:publicJwk.crv,kty:publicJwk.kty,x:publicJwk.x});
    const key=await crypto.subtle.importKey('jwk',privateJwk,{name:'Ed25519'},false,['sign']);
    const signed={schema:'numina.provenance-receipt.v2',keyId,payload};
    const signature=new Uint8Array(await crypto.subtle.sign('Ed25519',key,new TextEncoder().encode(stable(signed))));
    return {...signed,algorithm:'Ed25519',signature:btoa(String.fromCharCode(...signature)),publicKey:{kty:'OKP',crv:'Ed25519',x:publicJwk.x}};
  }catch{controlError('SIGNING_UNAVAILABLE',503);}
}
export async function frontierVerify(receipt,trustedPublicJwk){
  try{
    if(receipt.schema!=='numina.provenance-receipt.v2'||receipt.algorithm!=='Ed25519'||receipt.keyId!==await controlHash({crv:trustedPublicJwk.crv,kty:trustedPublicJwk.kty,x:trustedPublicJwk.x}))return false;
    const key=await crypto.subtle.importKey('jwk',trustedPublicJwk,{name:'Ed25519'},false,['verify']);
    return await crypto.subtle.verify('Ed25519',key,Uint8Array.from(atob(receipt.signature),c=>c.charCodeAt(0)),new TextEncoder().encode(stable({schema:receipt.schema,keyId:receipt.keyId,payload:receipt.payload})));
  }catch{return false;}
}
