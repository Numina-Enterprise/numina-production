# Numina Native Treasury to Stripe: USD funding workflow

The intended source is NUSD and the requested settlement currency is USD. The destination is the existing Stripe Money Management financial account `fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu`, Numina Treasury — SK Consulting LLC, under `acct_1UEEPnQdJat0efmT`.

## Verified capability and limitation

As checked October 1, 2026, the live connector exposes financial-account, financial-address, received-credit, inbound-transfer and transaction reads. No applicable funding write operation is exposed to this session. Production's existing adapter uses a restricted read key and has no configured verified NUSD redemption source. NUSD is not a reported supported currency of this financial account. This is a scoped capability result, not a claim that Stripe has no funding APIs globally.

Stripe documents fiat funding APIs for verified bank sources and settled Stripe payments balances. Those APIs do not redeem NUSD. This implementation therefore uses the supported [external USD bank-funding workflow](https://docs.stripe.com/treasury/add-funds). Its provider adapter contains only GET requests; environment flags and user-supplied funding assertions cannot enable writes.

## Owner workflow

1. Specify the NUSD source amount and USD settlement amount separately. A denomination policy is not a conversion quote or proof of available USD.
2. Explicitly authorize preparation for this exact destination, amounts and idempotency key. Numina durably records the intent before reading Stripe instructions.
3. Separately obtain and verify USD proceeds through an authorized NUSD redemption/conversion. Verify available USD at the external bank. Numina cannot establish these prerequisites from a mint, journal entry, signature, target allocation or Stripe destination balance.
4. In the authenticated Stripe Dashboard, open the exact financial account, choose **Add funds**, then **Manually transfer from your bank**, and retrieve its current USD bank details. Use your bank's supported rail and authorize the exact USD transfer there. Bank credentials remain in Stripe and are not copied into Numina records.
5. When Stripe reports the incoming funding attempt, select its received-credit or inbound-transfer ID and explicitly authorize readback. Poll until its lifecycle resolves, with increasing intervals after errors. Status GETs read the durable record; POST `reconcile` performs fresh provider GETs. No background transfer or polling job starts automatically.

## API contract

Canonical endpoint: `/api/treasury/v1/submissions`. All records require the current owner, with reviewer and manifest-root checks. Browser POSTs require same origin. JSON must use Numina's canonical serialization (sorted object keys, no extra whitespace). Bearer authority and Sites owner identity follow the existing control authentication.

GET without query preserves historical request records and includes `depositWorkflow`. GET `?idempotencyKey=YOUR_KEY` reads an existing deposit intent and its current observation.

POST `prepare_external_funding` body (the following is readable formatting; send canonical JSON):

```json
{
  "action": "prepare_external_funding",
  "idempotencyKey": "your-deposit-key-001",
  "intent": {
    "source": {"currency": "NUSD", "amount": "10"},
    "settlement": {"currency": "USD", "amount": "10.00"},
    "financialAccount": "fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu"
  },
  "authorization": {
    "action": "prepare_external_funding",
    "idempotencyKey": "your-deposit-key-001",
    "intent": {
      "source": {"currency": "NUSD", "amount": "10"},
      "settlement": {"currency": "USD", "amount": "10.00"},
      "financialAccount": "fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu"
    },
    "confirmed": true
  }
}
```

USD uses cents, with at most two decimal places; NUSD uses 18 decimal places. Amounts must be positive decimal strings, never floating-point numbers or exponent notation. Requested USD minor units are capped at signed 64-bit range. The NUSD amount is not automatically converted into USD. The server stores exact units, authenticated principal, authorization and a SHA-256 intent commitment.

Concurrent same-key retries reuse one durable intent. Changed amounts/destination return a conflict. After a provider instruction read fails, POST `refresh_instructions` with the identical key/intent and authorization action changed to `refresh_instructions`. A bound receipt cannot be replaced by refreshing instructions.

POST `reconcile`:

```json
{
  "action": "reconcile",
  "idempotencyKey": "your-deposit-key-001",
  "providerReceiptId": "ACTUAL_PROVIDER_RETURNED_ID",
  "receiptKind": "received_credit",
  "authorization": {
    "action": "reconcile",
    "idempotencyKey": "your-deposit-key-001",
    "providerReceiptId": "ACTUAL_PROVIDER_RETURNED_ID",
    "receiptKind": "received_credit",
    "confirmed": true
  }
}
```

Use `receiptKind: inbound_transfer` for an existing USD bank pull initiated separately in Stripe. IDs are lookup hints, never receipt evidence. A receipt must match the pinned live account, exact positive USD amount and creation after intent creation. A bank push must also match an observed active USD financial-address ID and supported bank rail. Inbound transfers use their canonical bank-debit history and exact credited USD amount, not a fabricated top-level status. A correlated receipt is reserved globally to one intent; retries of a failed transfer with a new provider flow require a new intent/key.

The adapter queries transactions with the flat `flow=PROVIDER_ID` filter and verifies exactly one corresponding posted transaction, exact amount/currency/account, available balance impact, permitted release from inbound pending, and zero outbound pending impact. It also records current financial-account balances. Balance increases alone do not prove a deposit. Incomplete pagination, malformed responses, unknown modes and uncorrelated transactions cannot confirm USD receipt.

## State and evidence

- `intendedState`: requested NUSD source and USD destination, independent of balances.
- `softwareState`: durable instruction/readback status; no native journal balance is debited or credited.
- `providerConfirmedState`: sanitized live GET evidence, provider request IDs, receipt ID, transaction ID, lifecycle and exact USD balance snapshots.
- `sourceEvidence`: NUSD redemption and source USD funds remain unverified by this adapter.

`USD_RECEIPT_RECONCILED` confirms only an owner-selected incoming USD receipt and its posted transaction. It does not establish that those dollars originated from NUSD, reserve backing or completed NUSD redemption. `submissionPerformed`, `settled` and `nusdSettlementVerified` remain false. Canonical NUSD mint/deployment receipts retain their original distinct scope.

Provider responses are persisted as bounded allowlisted bodies and HTTP metadata in append-only D1 observations. Bank account/routing numbers, API keys, free-form provider messages and receipt URLs are excluded; optional receipt-URL presence is recorded. Known correlated returned/failed states revoke verification even if supplementary reads fail or another concurrent poll finishes later. Generation ordering prevents ordinary stale results overwriting later polls; terminal rejection takes precedence.

## Deployment and testing

Migration `0006_treasury_deposit_instructions` adds separate intent, observation and unique receipt-claim tables. Existing treasury records are retained. Worker packaging includes all new modules; the legacy Node route validates requests then forwards to the existing canonical Worker origin, avoiding its own rewrite.

Use the existing server-side `NUMINA_STRIPE_TREASURY_READ_KEY` and pinned `NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT`; no write key is needed. Do not place credentials in source. Treasury read permission alone may not cover received credits, inbound transfers or transactions: a provider denial is persisted and blocks confirmation.

The regression tests use offline responses and synthetic credentials. They cover authorization, exact amounts, provider failure, missing funds, disabled writes, duplicates, receipt reuse, pending/succeeded/returned lifecycle, malformed/incomplete readback and concurrent polling. No test submits a live transfer, redeems NUSD or uses the historical 500T/1.5 quadrillion targets as a transfer amount.
