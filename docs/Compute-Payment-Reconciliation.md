# Compute payment reconciliation

## Scope

Reuse the existing live Stripe endpoint at `POST /api/app/v1/stripe-webhook`. Its existing event subscriptions are sufficient. No Stripe configuration, secret, price, migration or public checkout changes are required.

Previously, a checkout without a matching Numina service request was acknowledged and discarded. The handler now retains verified events for these existing USD compute packs:

| Credit pack size | USD price | Payment Link |
| --- | ---: | --- |
| 10,000 | 10 | plink_1UEKGpQdJat0efmTcDcvJf0A |
| 100,000 | 100 | plink_1UEKCFQdJat0efmTvmaqJNcj |
| 1,000,000 | 1,000 | plink_1UEJfdQdJat0efmTXjcDwi3H |

## Durable evidence

Signature, live mode, session, currency, amount and paid payment-intent validation remain required. Existing atomic batches, event guards and unique session/payment-intent constraints protect against retries. The existing payment table stores unbound records under reserved `compute_unbound:<pack-size>` order IDs. These cannot collide with customer request IDs (`n_<uuid>`).

No customer identity is inferred from checkout email, metadata or arbitrary references. A compute link cannot pay an existing consulting request. Refund/dispute facts stay linked by payment intent, including facts received before checkout confirmation.

## Operator review

`GET /api/app/v1/compute-payments` requires the existing authenticated operator identity. Customers and review-only sessions cannot access it. The existing rate limit applies.

The response returns up to 25 records and a `next` cursor for `?after=<cursor>`. Each record includes session/event references, `creditPackSize`, current payment summary, `fulfillment: "review_required"` and `creditsGranted: 0`. Pack size describes the offer; it is not an available balance, even when payment is paid.

## Delivery remains gated

This change preserves payment evidence. It does not deliver compute, grant spendable credits, mint NUSD, infer token backing or move assets.

Before automatic delivery:
1. Bind checkout to a verified customer identity before payment.
2. Implement durable atomic credit allocation/consumption and reversal policy with unique purchase references.
3. Exercise delivery, delayed payments, retries, refunds, disputes and recovery in a separate Stripe sandbox.
4. Deploy through the reviewed release process and verify deployed revision and delivery logs.

Previously discarded events are not recovered automatically. Review retained Stripe events before any authorized replay. No historical event replay or live test charge was performed.

## Validation

24 payment tests pass on Node 24.22.1, including seven compute reconciliation regressions:

`TMPDIR=<writable-directory> node --test tests/app.test.mjs`

Full repository CI/build, deployment and real customer delivery remain unverified.
