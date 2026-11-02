import crypto from 'node:crypto';
import { parseMinorUnits } from './money.mjs';
import { canonicalizeJson, sha256Hex } from './security-utils.mjs';

/**
 * Stripe Enterprise Treasury Bridge
 * Ingests Stripe payment webhooks with HMAC-SHA256 verification and
 * maps into the 3-stage BigInt atomic settlement pipeline.
 */
export class StripeTreasuryBridge {
  constructor(treasuryEngine, webhookSecret) {
    if (!treasuryEngine?.clusterRoot) throw new Error('CLUSTER_STATE_CONTEXT_REQUIRED');
    if (typeof webhookSecret !== 'string' || !webhookSecret || webhookSecret.includes('mock')) throw new Error('STRIPE_WEBHOOK_SECRET_REQUIRED');
    this.treasury = treasuryEngine;
    this.webhookSecret = webhookSecret;
    this.processedEvents = new Set();
  }

  /**
   * Verify Stripe HMAC-SHA256 signature header:
   * Header format: t=1614... ,v1=5257...
   */
  verifyWebhookSignature({ payload, signatureHeader, toleranceSeconds = 300 }) {
    if (!signatureHeader || !payload) {
      throw new Error('STRIPE_SIGNATURE_MISSING');
    }

    const parts = signatureHeader.split(',').reduce((acc, part) => {
      const [key, val] = part.split('=');
      acc[key.trim()] = val.trim();
      return acc;
    }, {});

    if (!parts.t || !/^\d+$/.test(parts.t)) {
      throw new Error('STRIPE_HEADER_MALFORMED');
    }

    const timestamp = parseInt(parts.t, 10);
    const signatures = Object.entries(parts).filter(([key]) => key === 'v1').map(([, value]) => value);

    if (!timestamp || !signatures.length) {
      throw new Error('STRIPE_HEADER_MALFORMED');
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > toleranceSeconds) {
      throw new Error(`STRIPE_TIMESTAMP_OUT_OF_TOLERANCE: Skew ${Math.abs(now - timestamp)}s > ${toleranceSeconds}s`);
    }

    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(signedPayload)
      .digest('hex');

    const valid = signatures.some((signature) => /^[a-f0-9]{64}$/.test(signature) && crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex')));
    if (!valid) {
      throw new Error('STRIPE_SIGNATURE_MISMATCH');
    }

    return true;
  }

  /**
   * Process payment intent / charge event and initiate atomic settlement
   */
  processPaymentEvent({ eventId, eventType, rawPayload, signatureHeader }) {
    this.verifyWebhookSignature({ payload: rawPayload, signatureHeader });
    let event;
    try { event = JSON.parse(rawPayload); } catch { throw new Error('STRIPE_PAYLOAD_INVALID'); }
    if (event.id !== eventId || event.type !== eventType) throw new Error('STRIPE_EVENT_IDENTITY_MISMATCH');

    if (this.processedEvents.has(eventId)) {
      return { status: 'EVENT_ALREADY_PROCESSED', eventId };
    }

    if (eventType !== 'payment_intent.succeeded' && eventType !== 'charge.succeeded') {
      return { status: 'EVENT_IGNORED', eventType };
    }

    const object = event.data?.object;
    if (!object || typeof object !== 'object') throw new Error('STRIPE_EVENT_DATA_REQUIRED');
    const amountCents = object.amount_received ?? object.amount;
    const currency = object.currency;
    const customerId = object.customer;
    const paymentIntentId = eventType === 'payment_intent.succeeded' ? object.id : object.payment_intent;
    if (typeof currency !== 'string' || typeof paymentIntentId !== 'string' || typeof customerId !== 'string') throw new Error('STRIPE_PAYMENT_FIELDS_REQUIRED');
    if (currency.toLowerCase() !== 'usd') {
      throw new Error(`UNSUPPORTED_CURRENCY: ${currency} (Only USD 1:1 supported)`);
    }
    const amountCentsUnits = parseMinorUnits(amountCents);
    if (amountCentsUnits <= 0n) throw new Error('STRIPE_AMOUNT_INVALID');

    // Stripe amounts are in cents (1/100). Convert to Numina micro-units (1/1,000,000)
    // 100 cents = $1.00 = 1,000,000 micro-units -> Multiply cents by 10,000n
    const amountUnits = amountCentsUnits * 10_000n;
    const idempotencyKey = `nusd:stripe:${paymentIntentId}`;

    const proofHash = sha256Hex(canonicalizeJson({ schema: 'numina.stripe-payment-proof.v1', eventId, paymentIntentId, amountCents: amountCentsUnits.toString(), currency: currency.toLowerCase(), customerId, rawPayloadHash: sha256Hex(rawPayload) }));

    // Stage 1: Initiate settlement into customer holding account
    const tx = this.treasury.initiateSettlement({
      idempotencyKey,
      fromAccount: 'TREASURY_VAULT',
      toAccount: `CUSTOMER:${customerId}`,
      amountUnits,
      proofHash,
    });

    this.processedEvents.add(eventId);

    return {
      status: 'SETTLEMENT_INITIATED',
      eventId,
      txHash: tx.txHash,
      amountUnits,
      idempotencyKey,
    };
  }
}
