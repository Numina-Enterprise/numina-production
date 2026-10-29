import crypto from 'node:crypto';
import { StripeTreasuryBridge } from './stripe-treasury-bridge.mjs';
import { NuminaTreasuryEngine } from './treasury-engine.mjs';

console.log('================================================================================');
console.log('STRIPE ENTERPRISE TREASURY BRIDGE: LIVE SIMULATION RUNNER');
console.log('================================================================================');

const CLUSTER_ROOT = '726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd';
const clusterState = {
  root: CLUSTER_ROOT,
  payload: {
    authorizedSupplyUnits: '1500000000000000000000',
    signers: {
      authorityKeypin: '46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce',
      guardianKeypin: '465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c'
    }
  }
};

const treasury = new NuminaTreasuryEngine({
  clusterState,
  now: () => Date.now()
});

// Seed accounts
treasury.accounts.set('STRIPE_CLEARING_ACCOUNT', 500_000_000_000n); // $500,000.00 USD
treasury.accounts.set('TREASURY_RESERVE_CUSTODY', 0n);

const webhookSecret = 'whsec_prod_live_secret_726e35da14739512f2ce45e03e394e81';
const bridge = new StripeTreasuryBridge(treasury, webhookSecret);

console.log('[*] Stripe Treasury App Context:');
console.log(`    App ID:             com.numinalabs.treasury v0.1.0`);
console.log(`    Clearing Account:   STRIPE_CLEARING_ACCOUNT ($500,000.00 USD)`);
console.log(`    Webhook Gateway:    HMAC-SHA256 Timing-Safe Active`);
console.log('--------------------------------------------------------------------------------');

// Construct a simulated Stripe payment_intent.succeeded webhook payload
const eventId = 'evt_3Mvw072eZvKYlo2C0V8B0V5m';
const paymentIntentId = 'pi_3Mvw072eZvKYlo2C0V8B0V5m';
const amountCents = 10000000; // $100,000.00 USD in cents

const rawPayload = JSON.stringify({
  id: eventId,
  object: 'event',
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: paymentIntentId,
      object: 'payment_intent',
      amount_received: amountCents,
      currency: 'usd',
      customer: 'cus_NuminaInstitutionalClient01',
      status: 'succeeded'
    }
  }
});

// Generate valid Stripe signature header: t=timestamp,v1=signature
const timestamp = Math.floor(Date.now() / 1000);
const signedPayload = `${timestamp}.${rawPayload}`;
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(signedPayload)
  .digest('hex');

const signatureHeader = `t=${timestamp},v1=${signature}`;

console.log('[*] Simulating Inbound Webhook Event: payment_intent.succeeded');
console.log(`    Event ID:           ${eventId}`);
console.log(`    Payment Intent ID:  ${paymentIntentId}`);
console.log(`    Gross Inflow:       $100,000.00 USD (10,000,000 cents)`);
console.log(`    Signature Header:   ${signatureHeader.slice(0, 32)}...`);
console.log('--------------------------------------------------------------------------------');

console.log('[*] Ingesting Payment Event via bridge.processPaymentEvent()...');
const result = bridge.processPaymentEvent({
  eventId,
  eventType: 'payment_intent.succeeded',
  rawPayload,
  signatureHeader
});

console.log('================================================================================');
console.log('STRIPE PAYMENT PROCESSED & INGESTED INTO SETTLEMENT PIPELINE:');
console.log('================================================================================');
console.log('Status:                ', result.status);
console.log('Payment Intent:        ', result.paymentIntentId);
console.log('Inbound Amount (USD):  ', `$${(Number(result.amountUnits) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`);
console.log('Micro-Units Units:     ', result.amountUnits.toString(), 'n');
console.log('Proof Hash:            ', result.proofHash);
console.log('Settlement Stage:      ', result.settlement?.stage || 'INITIATED_PENDING_SETTLEMENT');
console.log('--------------------------------------------------------------------------------');

// Test Idempotency Replay Protection
console.log('[*] Testing Anti-Replay Protection on Duplicate Webhook:');
const duplicateResult = bridge.processPaymentEvent({
  eventId,
  eventType: 'payment_intent.succeeded',
  rawPayload,
  signatureHeader
});
console.log('    ✓ Duplicate Rejection: ', duplicateResult.status === 'EVENT_ALREADY_PROCESSED' ? 'PASS (REPLAY PREVENTED)' : 'FAILED');

console.log('================================================================================');
