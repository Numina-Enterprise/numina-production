import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {CHECKOUT_ROUTE,WEBHOOK_ROUTE,STRIPE_API_VERSION,createStripeClient,paymentsHttp,verifyStripeWebhook} from '../src/stripe-checkout.js';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const env={
  STRIPE_SECRET_KEY:'rk_test_examplekey123',
  STRIPE_PUBLISHABLE_KEY:'pk_test_examplekey123',
  STRIPE_WEBHOOK_SECRET:'whsec_example_secret',
  STRIPE_PRICE_DIAGNOSTIC:'price_diagnostic123',
  STRIPE_PRICE_AUDIT:'price_audit123'
};
function sessionClient(capture){
  return {checkout:{sessions:{async create(params,options){capture.params=params;capture.options=options;return {id:'cs_test_123',url:'https://checkout.stripe.com/c/pay/cs_test_123'};}}},webhooks:{constructEventAsync:async()=>{throw new Error('not used');}}};
}
async function post(path,body,headers={},host='https://www.numinalabs.xyz'){
  return paymentsHttp(new Request(host+path,{method:'POST',headers:{origin:host,'content-type':'application/json',...headers},body}),env,{client:sessionClient({})});
}

test('checkout page copy points the two fixed prices at Checkout and leaves proposals as a quote',()=>{
  const services=read('public/services.html'),home=read('public/index.html'),headers=read('public/_headers'),build=read('scripts/build.mjs');
  assert.match(services,/id="diagnostic"/);assert.match(services,/id="audit"/);
  assert.match(services,/action="\/api\/payments\/v1\/checkout"/);assert.match(services,/name="offering" value="diagnostic"/);assert.match(services,/name="offering" value="audit"/);
  assert.ok(services.includes('href="/contact">Start a diagnostic')&&services.includes('href="/contact">Start an audit'));
  assert.match(services,/Request a proposal quote/);
  assert.match(home,/href="\/services#diagnostic"/);assert.match(home,/href="\/services#audit"/);assert.match(home,/SBIR and STTR proposal preparation/);
  assert.match(read('public/checkout-success.html'),/does not itself prove/);assert.match(read('public/checkout-cancel.html'),/No payment was taken/);
  assert.match(headers,/form-action 'self'/);assert.doesNotMatch(headers,/form-action 'none'/);
  assert.match(build,/['"]stripe-checkout['"],['"]worker['"]/);
  assert.doesNotMatch(read('package.json'),/"stripe"/);
  assert.match(read('.cursor/mcp.json'),/https:\/\/mcp\.stripe\.com/);
  assert.doesNotMatch(read('.cursor/mcp.json'),/sk_|rk_|whsec_|apiKey/i);
});

test('the fetch client creates a test-mode Checkout Session and never calls Stripe for a live key',async()=>{
  let calls=0;
  const fetchImpl=async(url,init)=>{calls++;assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');assert.equal(init.method,'POST');assert.equal(init.headers.authorization,'Bearer '+env.STRIPE_SECRET_KEY);assert.equal(init.headers['stripe-version'],STRIPE_API_VERSION);assert.equal(init.headers['idempotency-key'],'idem_key_123');const body=new URLSearchParams(init.body);assert.equal(body.get('mode'),'payment');assert.equal(body.get('line_items[0][price]'),env.STRIPE_PRICE_DIAGNOSTIC);assert.equal(body.get('line_items[0][quantity]'),'1');assert.match(body.get('integration_identifier'),/^numina_labs_checkout_[a-z]{8}$/);assert.equal(body.get('metadata[offering]'),'diagnostic');assert.match(body.get('success_url'),/\/checkout-success\?session_id=\{CHECKOUT_SESSION_ID\}$/);assert.doesNotMatch(init.body,/payment_method_types/);return new Response(JSON.stringify({id:'cs_test_fetched',url:'https://checkout.stripe.com/c/pay/cs_test_fetched'}),{status:200});};
  const client=createStripeClient(env,{fetchImpl});
  const session=await client.checkout.sessions.create({mode:'payment',line_items:[{price:env.STRIPE_PRICE_DIAGNOSTIC,quantity:1}],success_url:'https://www.numinalabs.xyz/checkout-success?session_id={CHECKOUT_SESSION_ID}',cancel_url:'https://www.numinalabs.xyz/checkout-cancel',integration_identifier:'numina_labs_checkout_abcdefgh',metadata:{offering:'diagnostic'}},{idempotencyKey:'idem_key_123'});
  assert.equal(session.id,'cs_test_fetched');assert.equal(calls,1);
  let liveCalls=0;const boom=()=>{liveCalls++;throw new Error('network');};
  await assert.rejects(async()=>createStripeClient({STRIPE_SECRET_KEY:'sk_live_nope'},{fetchImpl:boom}),/LIVE_MODE_DISABLED/);
  await assert.rejects(async()=>createStripeClient({STRIPE_SECRET_KEY:'rk_live_nope'},{fetchImpl:boom}),/LIVE_MODE_DISABLED/);
  await assert.rejects(async()=>createStripeClient({...env,STRIPE_PUBLISHABLE_KEY:'pk_live_nope'},{fetchImpl:boom}),/LIVE_MODE_DISABLED/);
  await assert.rejects(async()=>createStripeClient({STRIPE_SECRET_KEY:''},{fetchImpl:boom}),/STRIPE_NOT_CONFIGURED/);
  assert.equal(liveCalls,0);
});

test('checkout accepts the diagnostic and audit, redirects forms, and rejects bad input',async()=>{
  const capture={};
  const form=await paymentsHttp(new Request('https://numinalabs.xyz/api/payments/v1/checkout',{method:'POST',headers:{origin:'https://numinalabs.xyz','content-type':'application/x-www-form-urlencoded'},body:'offering=audit&email=ada%40example.com'}),env,{client:sessionClient(capture)});
  assert.equal(form.status,303);assert.equal(form.headers.get('location'),'https://checkout.stripe.com/c/pay/cs_test_123');
  assert.equal(capture.params.line_items[0].price,env.STRIPE_PRICE_AUDIT);assert.equal(capture.params.customer_email,'ada@example.com');assert.equal(capture.params.metadata.offering,'audit');assert.equal(capture.params.mode,'payment');
  const json=await post(CHECKOUT_ROUTE,JSON.stringify({offering:'diagnostic'}));assert.equal(json.status,200);assert.deepEqual(await json.json(),{id:'cs_test_123',url:'https://checkout.stripe.com/c/pay/cs_test_123'});
  const cross=await paymentsHttp(new Request('https://www.numinalabs.xyz'+CHECKOUT_ROUTE,{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{"offering":"diagnostic"}'}),env,{client:sessionClient({})});
  assert.equal(cross.status,403);assert.equal((await cross.json()).error,'ORIGIN_REJECTED');
  for(const [body,code] of [['{"offering":"sbir"}','INVALID_OFFERING'],['not-json','INVALID_JSON'],['{"offering":"diagnostic","email":"nope"}','INVALID_EMAIL']]){
    const response=await post(CHECKOUT_ROUTE,body);assert.equal((await response.json()).error,code,body);
  }
  const missing=await paymentsHttp(new Request('https://www.numinalabs.xyz'+CHECKOUT_ROUTE,{method:'POST',headers:{origin:'https://www.numinalabs.xyz','content-type':'application/json'},body:'{"offering":"diagnostic"}'}),{...env,STRIPE_PRICE_DIAGNOSTIC:''},{client:sessionClient({})});
  assert.equal(missing.status,503);assert.equal((await missing.json()).error,'PRICE_NOT_CONFIGURED');
  const get=await paymentsHttp(new Request('https://www.numinalabs.xyz'+CHECKOUT_ROUTE),env,{client:sessionClient({})});
  assert.equal(get.status,405);assert.equal(get.headers.get('allow'),'POST');
});

test('the webhook verifies the Stripe signature and only acknowledges',async()=>{
  const payload=JSON.stringify({id:'evt_test_1',type:'checkout.session.completed',data:{object:{payment_status:'paid',metadata:{offering:'diagnostic'}}}});
  const receivedAt=1_700_000_000_000,timestamp=1_700_000_000;
  const header=await sign(env.STRIPE_WEBHOOK_SECRET,payload,timestamp);
  const event=await verifyStripeWebhook(payload,header,env.STRIPE_WEBHOOK_SECRET,{receivedAt});
  assert.equal(event.id,'evt_test_1');
  await assert.rejects(()=>verifyStripeWebhook(payload,header,env.STRIPE_WEBHOOK_SECRET,{receivedAt:receivedAt+301_000}),/INVALID_SIGNATURE/);
  await assert.rejects(()=>verifyStripeWebhook(payload,'t='+timestamp+',v1='+'ab'.repeat(32),env.STRIPE_WEBHOOK_SECRET,{receivedAt}),/INVALID_SIGNATURE/);
  const logs=[];const original=console.log;console.log=line=>logs.push(line);
  try{
    const ok=await paymentsHttp(new Request('https://www.numinalabs.xyz'+WEBHOOK_ROUTE,{method:'POST',headers:{'stripe-signature':header,'content-type':'application/json'},body:payload}),env,{receivedAt});
    assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{received:true});
    assert.match(logs[0],/"fulfillment":"acknowledged"/);assert.doesNotMatch(logs[0],/whsec|rk_test|ada@/);
  }finally{console.log=original;}
  const unpaidPayload=JSON.stringify({id:'evt_test_2',type:'checkout.session.completed',data:{object:{payment_status:'unpaid',metadata:{offering:'audit'}}}});
  const unpaidHeader=await sign(env.STRIPE_WEBHOOK_SECRET,unpaidPayload,timestamp);
  const unpaidLogs=[];console.log=line=>unpaidLogs.push(line);
  try{const unpaid=await paymentsHttp(new Request('https://numinalabs.xyz'+WEBHOOK_ROUTE,{method:'POST',headers:{'stripe-signature':unpaidHeader},body:unpaidPayload}),env,{receivedAt});assert.equal(unpaid.status,200);assert.match(unpaidLogs[0],/"fulfillment":"skipped_unpaid"/);}finally{console.log=original;}
  const bad=await paymentsHttp(new Request('https://www.numinalabs.xyz'+WEBHOOK_ROUTE,{method:'POST',headers:{'stripe-signature':'t=1,v1=abcd'},body:'{}'}),env,{receivedAt});
  assert.equal(bad.status,400);assert.equal((await bad.json()).error,'INVALID_SIGNATURE');
  const bare=await paymentsHttp(new Request('https://www.numinalabs.xyz'+WEBHOOK_ROUTE,{method:'POST',body:'{}'}),{...env,STRIPE_WEBHOOK_SECRET:''},{receivedAt});
  assert.equal(bare.status,503);
});

test('public hosts reach checkout and the webhook, and still hide other API routes',async()=>{
  for(const host of ['numinalabs.xyz','www.numinalabs.xyz']){
    const checkout=await worker.fetch(new Request('https://'+host+CHECKOUT_ROUTE,{method:'POST',headers:{origin:'https://'+host,'content-type':'application/json'},body:'{"offering":"diagnostic"}'}),{NUMINA_TELEMETRY_LOGS:'false'});
    assert.equal(checkout.status,503,(await checkout.json()).error);
    const webhook=await worker.fetch(new Request('https://'+host+WEBHOOK_ROUTE,{method:'POST',body:'{}'}),{NUMINA_TELEMETRY_LOGS:'false'});
    assert.equal(webhook.status,503);
    const hidden=await worker.fetch(new Request('https://'+host+'/api/payments/v1/other'),{NUMINA_TELEMETRY_LOGS:'false'});
    assert.equal(hidden.status,403);
  }
});

async function sign(secret,payload,timestamp){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+payload));
  const hex=[...new Uint8Array(mac)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return 't='+timestamp+',v1='+hex;
}
