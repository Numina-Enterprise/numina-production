import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {CHECKOUT_PATH} from '../src/checkout-redirect.js';

const env={
  NUMINA_TELEMETRY_LOGS:'false',
  STRIPE_SECRET_KEY:'sk_test_examplekey123',
  STRIPE_PRICE_DIAGNOSTIC:'price_diagnostic123',
  STRIPE_PRICE_AUDIT:'price_audit123'
};
const hosted='https://checkout.stripe.com/c/pay/cs_test_123';
function post(host,headers,body='offering=diagnostic'){
  return new Request('https://'+host+CHECKOUT_PATH,{method:'POST',headers:{Origin:'https://'+host,'content-type':'application/x-www-form-urlencoded',...headers},body});
}
function stripeFetch(sessionUrl){
  const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,init});
    return new Response(JSON.stringify({id:'cs_test_123',url:sessionUrl}),{status:200,headers:{'content-type':'application/json'}});
  };
  return {calls,fetchImpl};
}

test('the services page posts diagnostic and audit to the same-origin checkout endpoint',()=>{
  const html=readFileSync(new URL('../public/services.html',import.meta.url),'utf8');
  const forms=[...html.matchAll(/<form\b[^>]*>/gi)].map(form=>form[0]);
  assert.deepEqual(forms,[
    '<form class="pay-form" method="post" action="/api/payments/v1/checkout">',
    '<form class="pay-form" method="post" action="/api/payments/v1/checkout">'
  ]);
  assert.match(html,/name="offering" value="diagnostic"/);
  assert.match(html,/name="offering" value="audit"/);
  assert.equal(forms.some(form=>/https?:\/\//.test(form)),false);
  for(const page of ['checkout-success.html','checkout-cancel.html']){
    const body=readFileSync(new URL('../public/'+page,import.meta.url),'utf8');
    assert.match(body,/href="\/services"/);
    assert.doesNotMatch(body,/checkout\.stripe\.com|book\.stripe\.com/);
  }
});

test('a same-origin checkout post redirects only to hosted Checkout',async()=>{
  const previous=globalThis.fetch;
  const stripe=stripeFetch(hosted);
  globalThis.fetch=stripe.fetchImpl;
  try{
    const response=await worker.fetch(post('numinalabs.xyz'),env);
    assert.equal(response.status,303);
    assert.equal(response.headers.get('location'),hosted);
    assert.equal(new URL(response.headers.get('location')).origin,'https://checkout.stripe.com');
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(await response.text(),'');
    assert.equal(stripe.calls.length,1);
    assert.equal(stripe.calls[0].url,'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(stripe.calls[0].init.method,'POST');
    assert.equal(stripe.calls[0].init.headers.authorization,'Bearer '+env.STRIPE_SECRET_KEY);
    const body=new URLSearchParams(stripe.calls[0].init.body);
    assert.equal(body.get('mode'),'payment');
    assert.equal(body.get('line_items[0][price]'),env.STRIPE_PRICE_DIAGNOSTIC);
    assert.equal(body.get('line_items[0][quantity]'),'1');
    assert.match(body.get('success_url'),/^https:\/\/numinalabs\.xyz\/checkout-success\?session_id=\{CHECKOUT_SESSION_ID\}$/);
    assert.equal(body.get('cancel_url'),'https://numinalabs.xyz/checkout-cancel');
  }finally{globalThis.fetch=previous;}
});

test('a foreign or missing Origin cannot start checkout',async()=>{
  const previous=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('stripe must not be called');};
  try{
    const foreign=await worker.fetch(post('numinalabs.xyz',{Origin:'https://evil.example'}),env);
    assert.equal(foreign.status,405);
    assert.equal(foreign.headers.get('Allow'),'GET, HEAD');
    const missing=await worker.fetch(new Request('https://www.numinalabs.xyz'+CHECKOUT_PATH,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'offering=diagnostic'}),env);
    assert.equal(missing.status,405);
    assert.equal(calls,0);
  }finally{globalThis.fetch=previous;}
});

test('a non-Stripe session URL is refused without echoing it',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({url:'https://evil.example/phish',error:{message:'secret sk_test_examplekey123'}}),{status:200});
  try{
    const response=await worker.fetch(post('numina.test'),{...env,ASSETS:{fetch(){throw new Error('assets');}}});
    const text=await response.text();
    assert.equal(response.status,502);
    assert.equal(response.headers.get('location'),null);
    assert.equal(JSON.parse(text).error,'CHECKOUT_UNAVAILABLE');
    assert.equal(text.includes('evil.example'),false);
    assert.equal(text.includes('sk_test'),false);
  }finally{globalThis.fetch=previous;}
});

test('missing Stripe secret or price configuration fails closed',async()=>{
  const previous=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('stripe must not be called');};
  try{
    for(const partial of [{}, {STRIPE_SECRET_KEY:env.STRIPE_SECRET_KEY}, {STRIPE_SECRET_KEY:env.STRIPE_SECRET_KEY,STRIPE_PRICE_DIAGNOSTIC:'not-a-price'}]){
      const response=await worker.fetch(post('numina.test'),{NUMINA_TELEMETRY_LOGS:'false',...partial});
      assert.equal(response.status,503);
      assert.deepEqual(await response.json(),{error:'SERVICE_UNAVAILABLE'});
    }
    const unknown=await worker.fetch(post('numina.test',{},'offering=unknown'),env);
    assert.equal(unknown.status,503);
    assert.equal(calls,0);
  }finally{globalThis.fetch=previous;}
});
