import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {APP_VERSION,APP_OFFERS,appFail,appDigest,appText,appIntake,appPaymentSummary,appTransition,appVerifyStripe} from './app-core.js';
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
export async function appHttp(req,env){
 const url=new URL(req.url),path=url.pathname,now=Math.floor(Date.now()/1000);
 try{
  if(path==='/api/app/v1/stripe-webhook'){if(req.method!=='POST')return appResponse({error:'METHOD_NOT_ALLOWED'},405,{Allow:'POST'});return await appWebhook(req,env);}
  if(!['GET','POST'].includes(req.method))return appResponse({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET, POST'});
  if(path==='/api/app/v1/health'&&req.method==='GET'){const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM numina_service_orders WHERE id=?').bind('__readiness__').first();return appResponse({status:row?'ready':'unavailable',storage:'D1',version:APP_VERSION,paymentConfirmation:env.NUMINA_STRIPE_WEBHOOK_SECRET?'configured':'not_configured',stablecoinExecution:false});}
  if(path==='/api/app/v1/catalog'&&req.method==='GET')return appResponse({denomination_policy:NUMINA_LAYERS.denomination_policy,procurement_usage:NUMINA_LAYERS.procurement_usage,procurement:NUMINA_LAYERS.procurement,offers:Object.fromEntries(Object.entries(APP_OFFERS).filter(([,offer])=>!offer.retired)),operator:'SK Consulting LLC',initialCheckoutCountry:'US',internationalRequests:'review_before_checkout',scopeTerms:'Payment reserves the service. Scope, scheduling, authorized access and confidentiality must be confirmed before work begins. Production implementation and third-party costs are excluded unless separately agreed. If Numina cannot accept the engagement, payment will be refunded.'});
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
 }catch(error){const code=error.code||'SERVICE_UNAVAILABLE';return appResponse({error:code},error.status||503,code==='RATE_LIMITED'?{'Retry-After':'60'}:{});}
}
