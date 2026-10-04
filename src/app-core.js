export const APP_VERSION='4.0.0';
export const APP_CONSENT_VERSION='numina-workspace-2026-10-04';
export const APP_LEGAL_POLICY={revision:APP_CONSENT_VERSION,terms:'/terms',privacy:'/privacy',scope:'workspace-request',marketingConsentIncluded:false,optionalAiProcessingConsentIncluded:false,paidSowAccepted:false,financialExecutionAuthorized:false,providerAccessGranted:false};
export const APP_OFFERS={
 diagnostic_enterprise:{name:'Operational Agent Diagnostic',amount:500000,currency:'usd',paymentLink:'plink_1UFKjOQdJat0efmTjZUbX8v7',url:'https://book.stripe.com/28E6oJgte52Q5YC31HcbC09',description:'60–90 minutes focused on one authorized workflow, an opportunity map, dependencies, risks and a recommended next step.'},
 audit_enterprise:{name:'Agentic Systems & Operations Audit',amount:2500000,currency:'usd',paymentLink:'plink_1UFKjlQdJat0efmTGO6ppg0d',url:'https://book.stripe.com/cNi8wRfpadzm1Im9q5cbC0a',description:'A fixed-scope assessment, prioritized opportunities, control requirements and implementation roadmap.'},
 diagnostic:{retired:true,name:'Operational Agent Diagnostic',amount:150000,currency:'usd',paymentLink:'plink_1UEZzUQdJat0efmTmZFJ5X6b',url:'https://book.stripe.com/fZu8wRb8UfHubiWgSxcbC07',description:'60–90 minutes focused on one authorized workflow, an opportunity map, dependencies, risks and a recommended next step.'},
 audit:{retired:true,name:'Agentic Systems & Operations Audit',amount:750000,currency:'usd',paymentLink:'plink_1UEZzoQdJat0efmTN8cI8Xat',url:'https://book.stripe.com/3cI9AV7WIfHu5YC9q5cbC08',description:'A fixed-scope assessment, prioritized opportunities, control requirements and implementation roadmap.'},
 authorization_check:{name:'Authorization check',amount:null,currency:'nusd',requestOnly:true,description:'Submit the proposed agent action, authorized systems and acceptance criteria for scope review. Intended pricing: NUSD per accepted verification result; price and payment are not activated.'},
 result_access:{name:'Numina Result Access',amount:null,currency:'nusd',requestOnly:true,description:'Describe the API result, its intended use and the access you need. Scope and intended NUSD pricing are reviewed before any paid entitlement. Payment and result unlocking are not activated.'},
 workflow_delivery:{name:'Verified workflow delivery',amount:null,currency:'nusd',requestOnly:true,description:'Define the workflow, measurable outcome and delivery evidence for scope review. Intended pricing: NUSD per accepted outcome; payment and execution are not activated.'}
};
export function appFail(code,status=400){throw Object.assign(new Error(code),{code,status});}
export async function appDigest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function appText(value,min,max){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))appFail('INVALID_INPUT');return value.trim();}
export function appIntake(input){
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['idempotencyKey','service','title','brief','successCriteria','country','consent','consentVersion'].includes(k)))appFail('INVALID_INPUT');
 if(!/^[a-f0-9-]{36}$/.test(input.idempotencyKey)||(!Object.hasOwn(APP_OFFERS,input.service)||APP_OFFERS[input.service].retired)||!/^[A-Z]{2}$/.test(input.country)||input.consent!==true)appFail('INVALID_INPUT');
 if(input.consentVersion!==APP_CONSENT_VERSION)appFail('LEGAL_POLICY_REVIEW_REQUIRED',409);
 return {idempotencyKey:input.idempotencyKey,service:input.service,title:appText(input.title,3,120),brief:appText(input.brief,20,4000),successCriteria:appText(input.successCriteria,10,1500),country:input.country,consent:true,consentVersion:APP_CONSENT_VERSION};
}
export function appPaymentSummary(payments,facts){
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
export function appTransition(order,input,isOperator,payment){
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
export async function appVerifyStripe(raw,signature,secret,now=Math.floor(Date.now()/1000)){
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
