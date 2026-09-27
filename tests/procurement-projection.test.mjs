import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createProcurementProjector,procurementBinding} from '../public/procurement-projection.js';
import {NUMINA_PROCUREMENT_POLICY as policy} from '../public/procurement-policy.js';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const pairs={},keys={};
for(const id of ['owner','delegate','provider','other']){pairs[id]=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);keys[id]=await crypto.subtle.exportKey('jwk',pairs[id].publicKey);}
const projectorAt=now=>createProcurementProjector({ownerKeyId:'owner',keys,providerKeyIds:{'["provider:1","account:1"]':'provider'},clock:()=>now});
const projector=projectorAt(200);
async function sign(keyId,payload){return {keyId,payload,signature:Buffer.from(await crypto.subtle.sign('Ed25519',pairs[keyId].privateKey,new TextEncoder().encode(canonical(payload)))).toString('base64url')};}
async function fixture({delegated=false,receipt=null}={}){
 const request={requestId:'request:1',requestVersion:1,workflowId:'workflow:1',providerId:'provider:1',providerAccountId:'account:1',category:'DIRECT_PARTNERSHIP',amountMinor:'1200',currency:'USD'};
 const bindingHash=await procurementBinding(request);
 const evidence=(type,extras={})=>({schema:'numina.procurement-evidence.v1',type,evidenceId:'evidence:'+type,bindingHash,issuedAt:100,expiresAt:300,...extras});
 return {request,approval:await sign(delegated?'delegate':'owner',evidence('approval')),delegation:delegated?await sign('owner',evidence('delegation',{delegateKeyId:'delegate'})):null,budget:await sign('owner',evidence('budget',{reservationId:'reservation:1',state:'RESERVED'})),providerAccess:await sign('provider',evidence('provider_access',{capability:'MANUAL_DIRECT_PARTNERSHIP'})),receipt:receipt?await sign('provider',evidence('provider_receipt',{providerReceiptId:'receipt:1',idempotencyKey:'request:1',status:receipt,occurredAt:150,issuedAt:160})):null,revokedEvidenceIds:[],receiptBindings:[]};
}
function invariant(out){if(out.status!=='READY_FOR_MANUAL_EXECUTION'){assert.equal(out.eligibility,false);assert.equal(out.permission,false);}if(out.completed)assert.equal(out.historicallyAuthorized,true);for(const k of ['procurement_usage','automaticPurchasing','executionPerformedByEvaluator','providerMutationPerformed'])assert.equal(out[k],false,k);assert.ok(!JSON.stringify(out).includes('signature'));}
test('default policy is immutable and no anchor configuration grants readiness',async()=>{
 assert.equal(policy.procurement_usage,false);assert.equal(policy.status,'DISABLED_BY_DEFAULT');assert.equal(policy.mode,'PROJECTION_ONLY');assert.ok(Object.isFrozen(policy.allowedCategories));
 const out=await createProcurementProjector()(await fixture(),200);invariant(out);assert.equal(out.status,'DISABLED_BY_DEFAULT');assert.equal(out.permission,false);
});
for(const delegated of [false,true])test('exact signed '+(delegated?'delegated':'owner')+' request projects manual readiness only',async()=>{
 const data=await fixture({delegated}),before=structuredClone(data),out=await projector(data,200);invariant(out);assert.equal(out.status,'READY_FOR_MANUAL_EXECUTION');assert.equal(out.permission,true);assert.equal(out.completed,false);assert.equal(out.validUntil,300);assert.deepEqual(data,before);
});
test('signed completion is distinct from current permission and remains historical after expiry',async()=>{
 for(const now of [200,400]){const out=await projectorAt(now)(await fixture({receipt:'SETTLED'}));invariant(out);assert.equal(out.status,'COMPLETED_PROVIDER_CONFIRMED');assert.equal(out.completed,true);assert.equal(out.permission,false);assert.equal(out.validUntil,null);}
});
for(const [field,status] of [['approval','AWAITING_APPROVAL'],['budget','AWAITING_BUDGET'],['providerAccess','AWAITING_PROVIDER_ACCESS']])test('missing '+field,async()=>{
 const data=await fixture();data[field]=null;const out=await projector(data,200);invariant(out);assert.equal(out.status,status);assert.equal(out.permission,false);
 data.receipt=(await fixture({receipt:'SETTLED'})).receipt;assert.equal((await projector(data,200)).status,'UNAUTHORIZED_PROVIDER_ACTIVITY_OBSERVED');
});
const attacks={
 'caller booleans':d=>{d.authorized=true;d.completed=true;},
 'nested boolean':d=>{d.request.approved=true;},
 'envelope label':d=>{d.approval.source='trusted';},
 'payload boolean':d=>{d.approval.payload.approved=true;},
 'category alias':d=>{d.request.category='direct_partnership';},
 'zero amount':d=>{d.request.amountMinor='0';},
 'negative amount':d=>{d.request.amountMinor='-1';},
 'fraction amount':d=>{d.request.amountMinor='1.2';},
 'scientific amount':d=>{d.request.amountMinor='1e3';},
 'numeric amount':d=>{d.request.amountMinor=1200;},
 'newline amount':d=>{d.request.amountMinor='1200\n';},
 'newline identity':d=>{d.request.providerId='provider:1\n';},
 'ambiguous provider tuple':d=>{d.request.providerId='provider:1|account:1';d.request.providerAccountId='other';},
 'oversize amount':d=>{d.request.amountMinor='1'.repeat(31);},
 'currency case':d=>{d.request.currency='usd';},
 'wrong workflow':d=>{d.request.workflowId='workflow:2';},
 'wrong provider':d=>{d.request.providerId='provider:2';},
 'wrong account':d=>{d.request.providerAccountId='account:2';},
 'wrong amount':d=>{d.request.amountMinor='1201';},
 'wrong request':d=>{d.request.requestId='request:2';},
 'wrong version':d=>{d.request.requestVersion=2;},
 'unsigned approval':d=>{d.approval.signature='a'.repeat(86);},
 'fallback actor':d=>{d.approval.keyId='other';},
 'inherited actor':d=>{d.approval.keyId='constructor';},
 'expired approval':async d=>{d.approval=await sign('owner',{...d.approval.payload,expiresAt:199});},
 'future approval':async d=>{d.approval=await sign('owner',{...d.approval.payload,issuedAt:201});},
 'revoked evidence':d=>{d.revokedEvidenceIds=['evidence:approval'];},
 'consumed budget':async d=>{d.budget=await sign('owner',{...d.budget.payload,state:'CONSUMED'});},
 'provider read only':async d=>{d.providerAccess=await sign('provider',{...d.providerAccess.payload,capability:'READ_ONLY'});},
 'bad provider signature':async d=>{d.providerAccess=await sign('other',d.providerAccess.payload);},
 'duplicate evidence IDs':async d=>{d.budget=await sign('owner',{...d.budget.payload,evidenceId:'evidence:approval'});},
 'unsafe schema':async d=>{d.approval=await sign('owner',{...d.approval.payload,schema:'numina.procurement-evidence.v2'});},
 'wrong policy binding':async d=>{d.approval=await sign('owner',{...d.approval.payload,bindingHash:'0'.repeat(64)});},
 'delegate without grant':async d=>{d.approval=await sign('delegate',d.approval.payload);},
 'grant signed by delegate':async d=>{d.delegation=await sign('delegate',(await fixture({delegated:true})).delegation.payload);},
 'partial receipt binding':async d=>{d.receipt=(await fixture({receipt:'SETTLED'})).receipt;d.receipt.payload.bindingHash='0'.repeat(64);},
 'receipt reused':async d=>{d.receipt=(await fixture({receipt:'SETTLED'})).receipt;d.receiptBindings=[{providerId:'provider:1',providerAccountId:'account:1',providerReceiptId:'receipt:1',idempotencyKey:'request:1',bindingHash:'0'.repeat(64)}];},
 'invalid occurrence':async d=>{d.receipt=await sign('provider',{...(await fixture({receipt:'SETTLED'})).receipt.payload,occurredAt:170});},
 'null revocation view':d=>{d.revokedEvidenceIds=null;}
};
for(const [name,mutate] of Object.entries(attacks))test(name+' never grants permission or completion',async()=>{
 const data=await fixture();await mutate(data);const out=await projector(data,200);invariant(out);assert.equal(out.permission,false,name);assert.equal(out.completed,false,name);assert.ok(['EVIDENCE_INVALID','CATEGORY_NOT_ALLOWED'].includes(out.status),JSON.stringify(out));
});
test('receipt before approval is observed activity, never retroactive permission',async()=>{
 const data=await fixture({receipt:'SETTLED'});data.approval=await sign('owner',{...data.approval.payload,issuedAt:151});const out=await projector(data,200);invariant(out);assert.equal(out.status,'UNAUTHORIZED_PROVIDER_ACTIVITY_OBSERVED');assert.equal(out.completed,false);
});
for(const status of ['PENDING','FAILED','REVERSED'])test(status+' receipt never completes',async()=>{
 const out=await projector(await fixture({receipt:status}),200);invariant(out);assert.equal(out.completed,false);assert.equal(out.permission,false);assert.equal(out.status,status==='REVERSED'?'REVERSED':'PROVIDER_RECEIPT_PENDING');
});
test('binding is canonical and projector deterministic',async()=>{
 const d=await fixture();assert.equal(await procurementBinding(d.request),await procurementBinding(Object.fromEntries(Object.entries(d.request).reverse())));assert.deepEqual(await projector(d,200),await projector(d,200));
});
test('distinct role IDs cannot reuse owner public key material as provider evidence',async()=>{
 const bad=createProcurementProjector({ownerKeyId:'owner',keys:{...keys,provider:keys.owner},providerKeyIds:{'["provider:1","account:1"]':'provider'},clock:()=>200});const out=await bad(await fixture());invariant(out);assert.equal(out.status,'DISABLED_BY_DEFAULT');assert.equal(out.reasonCodes[0],'INVALID_TRUST_CONFIGURATION');
});
test('caller observation time cannot override the server clock',async()=>{
 const out=await projectorAt(400)(await fixture(),200);invariant(out);assert.equal(out.permission,false);assert.equal(out.reasonCodes[0],'EVIDENCE_EXPIRED_OR_FUTURE');
});
test('owner key ID cannot also be the configured provider key ID',async()=>{
 const bad=createProcurementProjector({ownerKeyId:'owner',keys,providerKeyIds:{'["provider:1","account:1"]':'owner'},clock:()=>200});const out=await bad(await fixture());invariant(out);assert.equal(out.reasonCodes[0],'INVALID_TRUST_CONFIGURATION');
});
test('provider key ID cannot approve as an owner delegate',async()=>{
 const d=await fixture({delegated:true});d.delegation=await sign('owner',{...d.delegation.payload,delegateKeyId:'provider'});d.approval=await sign('provider',d.approval.payload);const out=await projector(d);invariant(out);assert.equal(out.reasonCodes[0],'INVALID_DELEGATION');assert.equal(out.permission,false);
});
test('projector performs zero network/provider mutations on success and every failure',async()=>{
 const prior=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('NO_PROVIDER_CALL');};
 try {for(const change of [()=>{},...Object.values(attacks)]){const d=await fixture();await change(d);invariant(await projector(d,200));}assert.equal(calls,0);}finally{globalThis.fetch=prior;}
 const source=fs.readFileSync(new URL('../public/procurement-projection.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|indexedDB)\s*[.(]|subtle\.sign|node:(?:fs|http|child_process)/);
});
