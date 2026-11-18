// the Singularity Protocol — centralized command-center event log.
//
// A webhook receiver for the command center. It accepts verified events
// only — Stripe-signed events, and HMAC-signed events from the owner's own
// automation (treasury gap-change notices, quantum job status updates,
// Gmail triage alerts) — and appends them to an append-only D1 log.
// No unauthenticated writes: an event without a valid signature is
// rejected before anything is stored. Secrets are supplied at runtime
// through the environment and never appear in this codebase.
//
// Routes (wired in src/app-http.js):
//   POST /api/app/v1/command-center/webhook   receive a verified event
//   GET  /api/app/v1/command-center/events    operator-only JSON feed
//   GET  /api/app/v1/command-center           operator-only HTML view
//
// Deploy note: this is code in the working tree only. Serving it at
// numinalabs.xyz needs the next release cut and the serving-path decision;
// see docs/command-center-webhook.md.
import {APP_VERSION,appDigest,appFail,appVerifyStripe} from './app-core.js';

export const COMMAND_CENTER_EVENT_SOURCES=Object.freeze(['stripe','treasury','quantum','gmail']);
export const COMMAND_CENTER_MAX_EVENTS=1000;
export const COMMAND_CENTER_MAX_RAW_BYTES=262144;
export const COMMAND_CENTER_MAX_STORED_BYTES=16384;
export const COMMAND_CENTER_SIGNATURE_TOLERANCE_SECONDS=300;
export const COMMAND_CENTER_RATE_LIMIT_PER_MINUTE=120;

function commandCenterHtmlEscape(value){
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

// Raw-body reader: same limits as the app webhook (JSON only, no encoding,
// 5s deadline, fatal UTF-8). The signature is verified over these exact bytes.
async function commandCenterReadRaw(req,max=COMMAND_CENTER_MAX_RAW_BYTES){
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||req.headers.has('content-encoding'))appFail('JSON_REQUIRED',415);
  if(Number(req.headers.get('content-length'))>max)appFail('BODY_TOO_LARGE',413);
  const reader=req.body?.getReader();if(!reader)appFail('EMPTY_BODY');
  const chunks=[];let size=0;const deadline=Date.now()+5000;
  try{
    for(;;){
      let timer;
      const chunk=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('BODY_TIMEOUT'),{code:'BODY_TIMEOUT',status:408})),Math.max(1,deadline-Date.now()));})]).finally(()=>clearTimeout(timer));
      if(chunk.done)break;
      size+=chunk.value.length;if(size>max)appFail('BODY_TOO_LARGE',413);
      chunks.push(chunk.value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }catch(e){void reader.cancel().catch(()=>{});throw e;}
}

// Verify an internal sender: HMAC-SHA256 over `timestamp.raw-body`,
// header `X-Numina-Command-Center-Signature: t=<unix>,v1=<hex>`.
// Mirrors appVerifyStripe (same 300s tolerance, same signed payload).
// Fail closed: no secret configured means the endpoint is unavailable.
export async function commandCenterVerifyInternal(raw,signature,secret,now=Math.floor(Date.now()/1000)){
  if(!secret)appFail('COMMAND_CENTER_UNAVAILABLE',503);
  const parts=(signature||'').split(',').map(x=>x.split('='));
  const timestamp=parts.find(x=>x[0]==='t')?.[1];
  if(!/^\d+$/.test(timestamp||'')||Math.abs(now-Number(timestamp))>COMMAND_CENTER_SIGNATURE_TOLERANCE_SECONDS)appFail('INVALID_SIGNATURE',400);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  let valid=false;
  for(const [type,value]of parts){
    if(type==='v1'&&/^[a-f0-9]{64}$/i.test(value)){
      const bytes=Uint8Array.from(value.match(/../g),x=>parseInt(x,16));
      valid=(await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+raw)))||valid;
    }
  }
  if(!valid)appFail('INVALID_SIGNATURE',400);
}

async function commandCenterRateLimit(db,bucket,now){
  await db.prepare('DELETE FROM numina_app_rate WHERE window<?').bind(Math.floor(now/60)-2).run();
  const row=await db.prepare('INSERT INTO numina_app_rate (bucket,window,count) VALUES (?,?,1) ON CONFLICT(bucket,window) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(bucket,Math.floor(now/60),COMMAND_CENTER_RATE_LIMIT_PER_MINUTE).first();
  if(!row)appFail('RATE_LIMITED',429);
}

function commandCenterStripeSummary(event){
  const objectId=typeof event.data?.object?.id==='string'?event.data.object.id:'';
  return 'Stripe '+event.type+(objectId?' — '+objectId.slice(0,120):'');
}

// Validate an internal sender's envelope. Stripe events must arrive via the
// Stripe signature path, never via the internal HMAC path.
function commandCenterInternalEvent(value){
  if(!value||typeof value!=='object'||Array.isArray(value))appFail('INVALID_EVENT');
  const {source,type,event_id,summary,payload}=value;
  if(!COMMAND_CENTER_EVENT_SOURCES.includes(source)||source==='stripe')appFail('INVALID_EVENT');
  if(typeof type!=='string'||!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(type))appFail('INVALID_EVENT');
  if(typeof event_id!=='string'||event_id.length<1||event_id.length>200||/[\u0000-\u001f\u007f]/.test(event_id))appFail('INVALID_EVENT');
  if(summary!==undefined&&(typeof summary!=='string'||summary.length>500||/[\u0000-\u001f\u007f]/.test(summary)))appFail('INVALID_EVENT');
  if(payload===undefined||payload===null||typeof payload!=='object'||Array.isArray(payload))appFail('INVALID_EVENT');
  const payloadJson=JSON.stringify(payload);
  if(payloadJson.length>COMMAND_CENTER_MAX_STORED_BYTES)appFail('PAYLOAD_TOO_LARGE',413);
  return {source,type,event_id,summary:summary??(source+' '+type),payloadJson};
}

// Store one verified event. Idempotent on (source, event_id): a replay of
// the same bytes is a no-op, a conflicting body under the same id is a 409.
// The insert, the guard read and the retention prune share one transaction.
async function commandCenterStore(db,{eventKey,source,type,eventId,bodyHash,summary,payloadJson,receivedAt}){
  const results=await db.batch([
    db.prepare('INSERT INTO numina_command_center_events (event_key,source,type,event_id,body_hash,summary,payload,received_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING RETURNING id').bind(eventKey,source,type,eventId,bodyHash,summary,payloadJson,receivedAt),
    db.prepare('SELECT body_hash FROM numina_command_center_events WHERE event_key=?').bind(eventKey),
    db.prepare('DELETE FROM numina_command_center_events WHERE id NOT IN (SELECT id FROM numina_command_center_events ORDER BY id DESC LIMIT ?)').bind(COMMAND_CENTER_MAX_EVENTS)
  ]);
  if(results[1].results[0]?.body_hash!==bodyHash)appFail('EVENT_ID_CONFLICT',409);
  return {received:true,...(results[0].results.length?{matched:true}:{replayed:true})};
}

export async function commandCenterWebhook(req,env){
  const now=Math.floor(Date.now()/1000);
  const stripeSignature=req.headers.get('stripe-signature');
  const internalSignature=req.headers.get('x-numina-command-center-signature');
  if(stripeSignature&&internalSignature)appFail('AMBIGUOUS_SIGNATURE',400);
  if(!stripeSignature&&!internalSignature)appFail('UNAUTHENTICATED',401);
  await commandCenterRateLimit(env.DB,'command-center-webhook:'+(stripeSignature?'stripe':'internal'),now);
  const raw=await commandCenterReadRaw(req);
  const bodyHash=await appDigest(raw);
  if(stripeSignature){
    // A verified live Stripe event, any type. The payment webhook stays
    // the only route that moves money; this log only records what happened.
    const event=await appVerifyStripe(raw,stripeSignature,env.NUMINA_COMMAND_CENTER_STRIPE_SECRET,now);
    let payloadJson=JSON.stringify(event);
    let summary=commandCenterStripeSummary(event);
    if(payloadJson.length>COMMAND_CENTER_MAX_STORED_BYTES){
      // Oversized Stripe events are still recorded, with their identity
      // intact; the full body stays in the Stripe Dashboard.
      payloadJson=JSON.stringify({id:event.id,type:event.type,created:event.created,livemode:event.livemode,account:event.account??null,object_id:event.data?.object?.id??null,payload_truncated:true});
      summary+=' (payload truncated)';
    }
    return commandCenterStore(env.DB,{eventKey:'stripe:'+event.id,source:'stripe',type:event.type,eventId:event.id,bodyHash,summary,payloadJson,receivedAt:now});
  }
  await commandCenterVerifyInternal(raw,internalSignature,env.NUMINA_COMMAND_CENTER_SECRET,now);
  let value;
  try{value=JSON.parse(raw);}catch{appFail('INVALID_JSON');}
  const event=commandCenterInternalEvent(value);
  return commandCenterStore(env.DB,{eventKey:event.source+':'+event.event_id,source:event.source,type:event.type,eventId:event.event_id,bodyHash,summary:event.summary,payloadJson:event.payloadJson,receivedAt:now});
}

export async function commandCenterEvents(env,url){
  const afterRaw=url.searchParams.get('after')||'0';
  const limitRaw=url.searchParams.get('limit')||'50';
  if(!/^\d+$/.test(afterRaw)||!Number.isSafeInteger(Number(afterRaw)))appFail('INVALID_CURSOR',400);
  if(!/^\d+$/.test(limitRaw)||!Number.isSafeInteger(Number(limitRaw))||Number(limitRaw)<1||Number(limitRaw)>100)appFail('INVALID_LIMIT',400);
  const after=Number(afterRaw),limit=Number(limitRaw);
  const rows=(await env.DB.prepare('SELECT id,source,type,event_id,summary,payload,received_at FROM numina_command_center_events WHERE id>? ORDER BY id ASC LIMIT ?').bind(after,limit+1).all()).results;
  const page=rows.slice(0,limit);
  return {events:page.map(r=>({id:r.id,source:r.source,type:r.type,event_id:r.event_id,summary:r.summary,received_at:r.received_at,payload:JSON.parse(r.payload)})),next:rows.length>limit?page.at(-1).id:null};
}

export async function commandCenterView(env){
  const rows=(await env.DB.prepare('SELECT id,source,type,event_id,summary,received_at FROM numina_command_center_events ORDER BY id DESC LIMIT 100').bind().all()).results;
  const items=rows.map(r=>`<tr><td>${r.id}</td><td>${commandCenterHtmlEscape(new Date(r.received_at*1000).toISOString())}</td><td>${commandCenterHtmlEscape(r.source)}</td><td>${commandCenterHtmlEscape(r.type)}</td><td>${commandCenterHtmlEscape(r.summary)}</td></tr>`).join('');
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>the Singularity Protocol — Command Center</title></head><body><h1>the Singularity Protocol — Command Center</h1><p>Verified events only. Stripe events are signature-verified; treasury, quantum and Gmail events are HMAC-verified. No unauthenticated writes.</p><p>JSON feed: <a href="/api/app/v1/command-center/events">/api/app/v1/command-center/events</a></p><table><thead><tr><th>#</th><th>Received</th><th>Source</th><th>Type</th><th>Summary</th></tr></thead><tbody>'+(items||'<tr><td colspan="5">No events yet.</td></tr>')+'</tbody></table></body></html>';
  return new Response(html,{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Numina-App-Version':APP_VERSION}});
}
