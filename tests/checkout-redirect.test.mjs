import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkoutRedirect, CHECKOUT_PATH } from '../src/checkout-redirect.js';

test('public purchase pages do not send customers to retired Stripe URLs', () => {
  for (const page of ['index.html','services.html','checkout.html','checkout-success.html','checkout-cancel.html']) {
    const html=readFileSync(new URL('../public/'+page, import.meta.url),'utf8');
    assert.doesNotMatch(html,/https?:\\/\\/(?:book|buy|checkout)\\.stripe\\.com/i,page);
  }
  const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const services=readFileSync(new URL('../public/services.html',import.meta.url),'utf8');
  assert.match(index,/href="\\/checkout\\?offering=diagnostic"/);
  assert.match(services,/href="\\/checkout\\?offering=audit"/);
  assert.doesNotMatch(services,/action="\\/api\\/payments\\/v1\\/checkout"/);
});

test('retired checkout handler cannot contact a payment provider', async () => {
  const previous=globalThis.fetch;
  let called=0;
  globalThis.fetch=async()=>{called++;throw new Error('payment network must not be contacted');};
  try {
    const response=await checkoutRedirect(new Request('https://numinalabs.xyz'+CHECKOUT_PATH,{method:'POST',body:'offering=diagnostic'}),{STRIPE_SECRET_KEY:'sk_test_never_use'});
    assert.equal(response.status,503);
    assert.equal(response.headers.get('location'),null);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const body=await response.json();
    assert.equal(body.error,'PAYMENT_PROVIDER_UNAVAILABLE');
    assert.equal(body.checkout_path,'/checkout');
    assert.equal(called,0);
  } finally {globalThis.fetch=previous;}
});

test('invoice request page explicitly does not claim to process USD',()=>{
  const html=readFileSync(new URL('../public/checkout.html',import.meta.url),'utf8');
  assert.match(html,/Payment processing is not active/);
  assert.match(html,/No payment is taken|no payment is taken/);
  assert.doesNotMatch(html,/<input[^>]+(?:card|cvc|account-number)/i);
});
