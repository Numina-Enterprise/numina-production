# NUMINA transfer receipt import and verification

This feature records evidence for the existing 500T USD ACH and 500T USDC requests. It cannot send payments, sign transactions, broadcast transactions, mint funds, or rewrite treasury balances. No real transfer is implied by this documentation or by the test fixtures.

Open `/transfer-receipts` and sign in as the existing owner. Import an actual bank document, Stripe outbound reference, or Base USDC transaction hash. Use the separate read-only verification button after importing.

## Evidence boundaries

- Import IDs are SHA-256 content identifiers, not blockchain transaction hashes or bank confirmations. Imports remain `owner_submitted_unverified`.
- PDF/PNG/JPEG documents are private, content-addressed files. Their integrity is checked; their bank issuer and settlement are not verified. Direct Bank of America issuer verification is not configured.
- Stripe checks use only the existing server-held restricted read credential and the pinned financial account. A `VERIFIED_PROVIDER_REPORT` means a matching live posted USD provider report, not irrevocable bank settlement or an ACH-specific confirmation. Automatic/wire delivery and unmatched amounts/accounts/destinations fail closed. The payout-method reference is supplied by the owner; its link to a particular bank account is not established by this feature.
- USDC verification currently supports **Base mainnet only**, chain 8453. It pins Circle's native token, validates six token decimals, the successful receipt, exact Transfer event/from/to/amount/log index, canonical block inclusion, and finalized head. `VERIFIED_ONCHAIN_TRANSFER` is a public-RPC observation, not a locally validated light-client proof. It does not prove wallet ownership, NUSD conversion, USD reserves, or Stripe deposit credit. NUSD's existing 18-decimal contract is unchanged.
- Pending, absent, reverted, returned, mismatched, unsupported, malformed or unavailable evidence cannot become verified settlement. All responses have `financialExecution:false`; no imported or verified record changes the existing request's execution fields.
- Observations are immutable timestamped snapshots and can become stale. Reverify to obtain a new observation; previous observations are retained, not overwritten.

## Private API

Base: `/api/financial/v1/receipts`. Existing owner authentication, reviewer denial, root binding, CSRF controls, rate limits and private/no-store responses apply. POST bodies must be canonical JSON (recursively sorted keys, compact encoding) and at most 16 KiB.

- `POST /receipts`: import strict evidence fields; retries return the original immutable import.
- `GET /receipts?cursor=…`: list up to 25 private imports per page.
- `GET /receipts/{id}`: read a single import with integrity verification.
- `POST /receipts/{id}/verify`: body `{}`; run read-only verification and persist a separate observation.
- `GET /receipts/{id}/verifications?cursor=…`: list stored observations, verifying their hashes on read.

Common import fields: `rail` (`ACH` or `USDC`), matching `requestId` (`numina-ach-500t-20260918` or `numina-usdc-500t-20260918`), and the exact string `amount:"500000000000000"`. Other requests/amounts require an explicit future extension.

ACH Stripe fields: `provider:"stripe"`, actual `providerReference` (`obt_…` or `obp_…`), actual `destinationReference`, optional `documentId` from `/api/control/v1/treasury-documents`. ACH bank document fields: `provider:"bank_document"`, required stored `documentId`, optional bank `providerReference`. Never supply account numbers, API keys or passwords.

USDC fields: `network:"base"`, actual `transactionHash`, expected token `from` and `to` addresses, and numeric event `logIndex`. No defaults are invented for missing hashes or addresses. URLs, client-supplied verification flags and settlement claims are rejected.

## Primary references

- [Stripe outbound transfer states](https://docs.stripe.com/api/v2/money-management/outbound-transfers/list?api-version=2025-12-15.preview): posted transfers can later be returned.
- [Stripe outbound payment retrieval](https://docs.stripe.com/api/v2/money-management/outbound-payments/retrieve?api-version=2025-06-30.preview): provider amount/source/destination fields. Runtime preserves the existing connected `2026-08-26.preview` API version and fails closed on schema mismatch.
- [Base network configuration](https://docs.base.org/get-started/connect-to-base), [Circle USDC contracts](https://developers.circle.com/stablecoins/usdc-contract-addresses), [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/), [ERC-20 event specification](https://eips.ethereum.org/EIPS/eip-20).
