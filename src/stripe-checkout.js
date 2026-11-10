// Website Checkout for numinalabs.xyz.
// Workers bundle (scripts/build.mjs) concatenates this file and strips imports, and
// package.json / package-lock.json sit inside the attested git source-tree digest, so
// this file does not depend on the stripe npm package. The client matches the server
// SDK call shape: checkout.sessions.create and webhooks.constructEventAsync, using fetch
// and SubtleCrypto the same way Stripe.createFetchHttpClient and
// Stripe.createSubtleCryptoProvider do. Test-mode keys only. No live-mode calls.
export const STRIPE_API_VERSION='2026-10-28.endive';
export const CHECKOUT_ROUTE='/api/payments/v1/checkout';
export const WEBHOOK_ROUTE='/api/payments/v1/webhook';
export const CHECKOUT_OFFERINGS=Object.freeze({
  diagnostic:{env:'STRIPE_PRICE_DIAGNOSTIC',name:'Operational Agent Diagnostic',amountCents:150000},
  audit:{env:'STRIPE_PRICE_AUDIT',name:'Agentic Systems and Operations Audit',amountCents:750000}
});
const TEST_SECRET=/^(?:sk|rk)_test_[A-Za-z0-9]+$/;
const LIVE_SECRET=/^(?:sk|rk)_live_/;
const TEST_PUBLISHABLE=/^pk_test_[A-Za-z0-9]+$/;
const LIVE_PUBLISHABLE=/^pk_live_/;
const PRICE_ID=/^price_[A-Za-z0-9]+$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(code,status,stripeCode){const error=new Error(code);error.code=code;error.status=status;if(stripeCode)error.stripeCode=stripeCode;return error;}
function json(body,status=200,extra={}){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});}
function formEncode(fields){return Object.entries(fields).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(String(value)).replace(/%5B/gi,'[').replace(/%5D/gi,']').replace(/%7B/gi,'{').replace(/%7D/gi,'}')).join('&');}
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function integrationIdentifier(){const letters='abcdefghijklmnopqrstuvwxyz',bytes=crypto.getRandomValues(new Uint8Array(8));return 'numina_labs_checkout_'+[...bytes].map(byte=>letters[byte%26]).join('');}
function seconds(receivedAt){const value=Number(receivedAt);return value>10_000_000_000?Math.floor(value/1000):Math.floor(value);}

export function assertTestMode(env){
  const secret=typeof env?.STRIPE_SECRET_KEY==='string'?env.STRIPE_SECRET_KEY.trim():'';
  const publishable=typeof env?.STRIPE_PUBLISHABLE_KEY==='string'?env.STRIPE_PUBLISHABLE_KEY.trim():'';
  if(!secret)throw fail('STRIPE_NOT_CONFIGURED',503);
  if(LIVE_SECRET.test(secret)||LIVE_PUBLISHABLE.test(publishable))throw fail('LIVE_MODE_DISABLED',403);
  if(!TEST_SECRET.test(secret))throw fail('TEST_MODE_KEY_REQUIRED',503);
  if(publishable&&!TEST_PUBLISHABLE.test(publishable))throw fail('TEST_MODE_KEY_REQUIRED',503);
  return {secret,publishable};
}

export function priceFor(env,offering){
  const spec=CHECKOUT_OFFERINGS[offering];
  if(!spec)throw fail('INVALID_OFFERING',400);
  const price=typeof env?.[spec.env]==='string'?env[spec.env].trim():'';
  if(!PRICE_ID.test(price))throw fail('PRICE_NOT_CONFIGURED',503);
  return {spec,price};
}

export async function verifyStripeWebhook(payload,header,secret,{tolerance=300,receivedAt=Date.now()}={}){
  if(typeof payload!=='string'||typeof header!=='string'||typeof secret!=='string'||!secret)throw fail('INVALID_SIGNATURE',400);
  const parts=Object.create(null);const signatures=[];
  for(const piece of header.split(',')){const trimmed=piece.trim();const eq=trimmed.indexOf('=');if(eq<1)continue;const key=trimmed.slice(0,eq),value=trimmed.slice(eq+1);if(key==='t')parts.t=value;else if(key==='v1'&&/^[a-f0-9]{64}$/.test(value))signatures.push(value);}
  const timestamp=Number(parts.t);
  if(!Number.isInteger(timestamp)||timestamp<=0||!signatures.length)throw fail('INVALID_SIGNATURE',400);
  if(Math.abs(seconds(receivedAt)-timestamp)>tolerance)throw fail('INVALID_SIGNATURE',400);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+payload));
  const expected=[...new Uint8Array(mac)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  if(!signatures.some(signature=>safeEqual(signature,expected)))throw fail('INVALID_SIGNATURE',400);
  let event;try{event=JSON.parse(payload);}catch{throw fail('INVALID_SIGNATURE',400);}
  if(!event||typeof event!=='object'||Array.isArray(event)||typeof event.id!=='string'||typeof event.type!=='string')throw fail('INVALID_SIGNATURE',400);
  return event;
}

export function createStripeClient(env,{fetchImpl=globalThis.fetch}={}){
  const {secret}=assertTestMode(env);
  return {
    checkout:{sessions:{async create(params,options={}){
      const fields={mode:params.mode,success_url:params.success_url,cancel_url:params.cancel_url,'line_items[0][price]':params.line_items[0].price,'line_items[0][quantity]':String(params.line_items[0].quantity)};
      if(params.integration_identifier)fields.integration_identifier=params.integration_identifier;
      if(params.customer_email)fields.customer_email=params.customer_email;
      if(params.metadata)for(const [key,value] of Object.entries(params.metadata))fields['metadata['+key+']']=value;
      const headers={'authorization':'Bearer '+secret,'content-type':'application/x-www-form-urlencoded','stripe-version':STRIPE_API_VERSION};
      if(options.idempotencyKey)headers['idempotency-key']=options.idempotencyKey;
      const response=await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers,body:formEncode(fields)});
      const text=await response.text();
      let body={};try{body=text?JSON.parse(text):{};}catch{body={};}
      if(!response.ok)throw fail('CHECKOUT_FAILED',502,body?.error?.code||'stripe_error');
      return body;
    }}},
    webhooks:{constructEventAsync:(payload,header,webhookSecret,tolerance,cryptoProvider,receivedAt)=>verifyStripeWebhook(payload,header,webhookSecret,{tolerance:tolerance??300,receivedAt:receivedAt??Date.now(),cryptoProvider})}
  };
}

function checkoutUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='checkout.stripe.com';}catch{return false;}}
function sameSite(req){
  const url=new URL(req.url),origin=req.headers.get('origin');
  if(origin)return origin===url.origin;
  const site=req.headers.get('sec-fetch-site');
  return !site||site==='same-origin'||site==='none';
}
async function readBody(req,limit){
  if(req.headers.has('content-encoding'))throw fail('UNSUPPORTED_MEDIA',415);
  const reader=req.body?.getReader();if(!reader)throw fail('EMPTY_BODY',400);
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw fail('BODY_TOO_LARGE',413);chunks.push(value);}}
  finally{void reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
async function offeringFrom(req){
  const type=(req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const raw=await readBody(req,8192);
  if(type==='application/json'){let body;try{body=JSON.parse(raw);}catch{throw fail('INVALID_JSON',400);}if(!body||typeof body!=='object'||Array.isArray(body))throw fail('INVALID_JSON',400);return {offering:body.offering,email:body.email,json:true};}
  if(type==='application/x-www-form-urlencoded'){const params=new URLSearchParams(raw);return {offering:params.get('offering'),email:params.get('email'),json:false};}
  throw fail('UNSUPPORTED_MEDIA',415);
}

export async function paymentsHttp(req,env,{client,fetchImpl,receivedAt=Date.now()}={}){
  const url=new URL(req.url),path=url.pathname;
  try{
    if(path!==CHECKOUT_ROUTE&&path!==WEBHOOK_ROUTE)return json({error:'NOT_FOUND'},404);
    if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405,{allow:'POST'});
    const stripe=client||createStripeClient(env,{fetchImpl});
    if(path===WEBHOOK_ROUTE){
      const webhookSecret=typeof env?.STRIPE_WEBHOOK_SECRET==='string'?env.STRIPE_WEBHOOK_SECRET.trim():'';
      if(!webhookSecret)throw fail('WEBHOOK_NOT_CONFIGURED',503);
      const payload=await readBody(req,1_000_000);
      const event=await stripe.webhooks.constructEventAsync(payload,req.headers.get('stripe-signature')||'',webhookSecret,300,undefined,receivedAt);
      const object=event.data&&event.data.object||{};
      const paymentStatus=typeof object.payment_status==='string'?object.payment_status:null;
      const offering=object.metadata&&typeof object.metadata.offering==='string'?object.metadata.offering:null;
      const unpaid=event.type==='checkout.session.completed'&&paymentStatus==='unpaid';
      console.log(JSON.stringify({event:'stripe_webhook',id:event.id,type:event.type,payment_status:paymentStatus,offering,fulfillment:unpaid?'skipped_unpaid':'acknowledged'}));
      return json({received:true});
    }
    if(!sameSite(req))throw fail('ORIGIN_REJECTED',403);
    const input=await offeringFrom(req);
    const {spec,price}=priceFor(env,input.offering);
    const email=typeof input.email==='string'&&input.email?input.email.trim():'';
    if(email&&(email.length>200||!EMAIL.test(email)))throw fail('INVALID_EMAIL',400);
    const idempotency=req.headers.get('idempotency-key')||'';
    const options=/^[A-Za-z0-9_-]{8,255}$/.test(idempotency)?{idempotencyKey:idempotency}:{};
    const origin=url.origin;
    const session=await stripe.checkout.sessions.create({
      mode:'payment',
      line_items:[{price,quantity:1}],
      success_url:origin+'/checkout-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:origin+'/checkout-cancel',
      integration_identifier:integrationIdentifier(),
      metadata:{offering:input.offering,service:spec.name},
      ...(email?{customer_email:email}:{})
    },options);
    if(!checkoutUrl(session?.url)||typeof session.id!=='string'||!session.id.startsWith('cs_'))throw fail('CHECKOUT_FAILED',502,'invalid_session');
    if(input.json)return json({id:session.id,url:session.url});
    return new Response(null,{status:303,headers:{location:session.url,'cache-control':'no-store'}});
  }catch(error){
    if(error instanceof SyntaxError||error?.name==='TypeError'&&/utf-8/i.test(error.message||''))return json({error:'INVALID_JSON'},400);
    const code=error?.code||'CHECKOUT_FAILED';
    if(code==='CHECKOUT_FAILED')console.error(JSON.stringify({event:'stripe_checkout_failed',code:error?.stripeCode||code}));
    return json({error:code},error?.status||502);
  }
}
