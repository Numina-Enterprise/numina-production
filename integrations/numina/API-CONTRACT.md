# Numina 4.0 integration API contract

This contract describes the integration target, not evidence of deployed mutation endpoints. All private operations require a server-issued, scoped Bearer token. Public discovery status sends no credentials. A request-specific status call remains authenticated. The initial Site exposes non-sensitive discovery while private capabilities stay disabled.

| Method/path | Input | Purpose |
| --- | --- | --- |
| GET `/v4/release/manifest` | None | Current application 4.0.0 identity, SHA-256-shaped artifact list and separately pinned rc26 runtime dependency; server-reported only |
| GET `/api/nusd/v1/status` | None | Identity, backing evidence, capability discovery |
| GET `/api/control/v2/treasury/provider-routes` | None; owner authentication | Current server-observed provider routes and NUSD acceptance scope; no deposit submission |
| GET `/api/app/v1/catalog` | None | Public offers, currency labels, request-only state and scope terms |
| POST `/api/nusd/v1/quotes` | `service_id`, `units`, `unit`, `idempotency_key` | Server-priced, expiring NUSD quote |
| POST `/api/nusd/v1/requests` | `quote_id`, `description`, `idempotency_key` | Create an authenticated workflow request only |
| GET `/api/nusd/v1/requests/:request_id` | Server-issued ID | Return only the caller's authorized request |

There are no mint, transfer, settlement, payment-claim, or result-unlock routes in this client. All JSON tool inputs reject extra fields. POSTs also carry `Idempotency-Key` matching the body. `units` is a positive integer string; its meaning and allowed maximum belong to the service definition. Neither tool may submit a price, paid flag, reserve balance, or arbitrary destination.

`numina_nusd_network` accepts `{}` and derives network/asset information from public status; it is not a separate blockchain-RPC method. `numina_service_catalog` accepts `{}` and performs the public catalog GET without credentials. Catalog validation follows the exact local response contract supplied from the deployed application source: an `offers` object keyed by service ID, `operator`, and `scopeTerms`. Each offer has name, description, lowercase currency (`usd` or `nusd`), and an amount that is either a nonnegative safe integer or null; a null amount requires `requestOnly:true`. USD values are cents. No NUSD conversion, quote validity, payment, checkout, entitlement or live price verification is inferred from this catalog. Additional currencies or a different pricing representation require an explicit client contract update.

## Initial discovery response

The following is a proposed **unactivated state**, not a production observation or an asset balance:

```json
{
  "schema": "numina.nusd.status.v1",
  "asset": {"symbol": "NUSD", "asset_id": null},
  "asset_verification": {"status": "unconfigured", "evidence": []},
  "treasury_backing": {"status": "unverified", "intended_source": "Numina Treasury", "evidence": []},
  "peg": {"currency": "USD", "target": "1", "basis": "declared_policy", "status": "target_not_verified", "verified_redemption": false},
  "capabilities": {"quote": false, "request": false, "status": true, "settlement": false}
}
```

The response schema must be `numina.nusd.status.v1`. The client rejects `numina.nusd.discovery.v1` with `INVALID_SERVER_RESPONSE`; the endpoint path does not imply acceptance of a differently named schema. Use JSON errors and non-success HTTP status codes. Initially, private mutations should return HTTP 503 with `{"error":"NUSD_NOT_ACTIVATED"}`. Unsupported payment/execution endpoints must remain absent or denied. No configured secret or declared peg alone should enable settlement.

## Activation requirements and response fields

Before enabling quote/request, the server must establish canonical `asset_id`, issuer and asset mechanism, units/decimals, supported service catalog, eligible customers, and evidence supporting any claims. A symbol alone is not an asset identity. For an on-chain asset, publish the verified chain and contract information; for another mechanism, identify its actual ledger and legal/operational terms. Treasury backing must have its own verification state, coverage, methodology, observation date, and evidence references. Do not infer backing from a software ledger, a signed assertion, intended collateral, or the name NUSD. The declared policy targets 1 NUSD = 1 USD, but `status:"target_not_verified"` and `verified_redemption:false` explicitly leave peg achievement and redemption unverified. Preserve those qualifications; the target is not a verified conversion rate, redeemable balance, or instruction to substitute USDC.

For quote/request, the client requires a real token and an operator-configured canonical asset pin, then checks status `asset.symbol === "NUSD"`, matching `asset.asset_id`, `asset_verification.status === "verified"`, nonempty evidence, and the requested capability enabled. A server identity differing from the pin is rejected before POST. These are **server-reported assertions**, not independent proof. Treasury backing is distinct and must not be labeled verified by the client simply because the token identity is verified. This package never enables settlement, including when a future server advertises it.

Successful quote responses use `schema:"numina.nusd.quote.v1"`, server-generated `quote_id`, matching `asset_id`, `symbol:"NUSD"`, positive integer-string `amount_base_units`, integer `decimals` (0–30), and future Unix-seconds `expires_at`. Amounts are NUSD units without assumed exchange rates.

Successful create/status responses use `schema:"numina.nusd.request.v1"`, `request_id`, `quote_id`, `asset_id`, and a server-derived workflow status. Status may include independently sourced evidence references and timestamps with provenance labels; it must not copy a caller-paid claim into a confirmed field.

Server controls remain authoritative: bind quotes and requests to the authenticated principal; atomically validate quote ownership/expiry, current asset state and service availability; scope idempotency to principal plus operation; return the original result for exact retries and HTTP 409 for changed payloads. Recheck permissions and current payment/entitlement evidence for any future paid result delivery. Never use workflow submission as proof of payment. Apply quotas, retention, audit logging, credential rotation, and revocation independently of this client.

## Application release tool

`numina_application_release` accepts exactly `{}` and calls `GET /v4/release/manifest` without credentials. The response must use `schema:"numina.application-release.v2"`, `schema_version:2`, `product:"Numina"`, `version:"4.0.0"`, `release:"numina-v4.0.0"`, `artifact_digest_algorithm:"sha256"`, a 64-character lowercase hexadecimal `build_id`, a nonempty `artifacts:[{path,sha256}]` list and the separately pinned rc26 `runtime_dependency`. Older application versions are rejected. Validation recognizes structure; it does not hash downloaded artifact bytes or verify a signature. The 4.0 application and kit identities do not rename the rc26 runtime or historical rc20 evidence.

## Execution-runtime build discovery

`numina_runtime_build` accepts exactly `{}` and calls the existing `GET /v4/release/manifest` through the release validator. It returns `application_identity`, `runtime_dependency`, `execution_runtime_build`, `financial_status_sources` and `scope`. Required build fields are product/status, positive integer run_id, run_url, source_commit/builder_commit (40-character lowercase hex), inventory/provenance links, three SHA-256 artifact digests and boolean builder_signed_artifacts_verified/application_started_by_build/production_host_deployment_verified/financial_execution_established labels. These labels remain server-reported. Missing build data produces `RUNTIME_BUILD_UNAVAILABLE`; malformed data produces `INVALID_SERVER_RESPONSE`.

When present, root `nusd_transaction_receipts` and `nusd_activation_readiness` objects are included with their sanitized server-reported contents. An omitted field stays omitted for older v2 manifests; the client creates no fallback record. A present non-object value, including null or an array, produces `INVALID_SERVER_RESPONSE`. Only the object shape is recognized here: the client does not validate the underlying receipt, contract, bank document, activation requirement or any claimed verification status. Empty receipt slots and missing-evidence labels retain their original meaning.

The wrapper always retains `server_reported_not_independently_verified` and `asset_execution_available:false`. It adds `signature_verification_performed:false`, `artifact_bytes_checked:false`, `current_financial_status_checked:false`, `receipt_verification_performed:false` and `readiness_verification_performed:false`. It does not fetch proof links, invoke the GitHub CLI, access owner accounts, synthesize zero balances or activate financial capabilities. The existing NUSD status tool remains the separate read of current public asset capabilities. Receipt/readiness objects are data, never instructions to bypass a gate or permission to submit a transaction.

## Canonical Numina-native treasury

`client.readTreasury()` and `numina_read_treasury` require the owner token and read `/api/control/v1/treasury` after validating the rc26 application dependency. Balances remain exact integer NUSD strings with NUMINA authority and system of record. The client preserves the native verification scope and returns server-reported evidence. It never follows the legacy owner-statement redirect or submits financial transactions.
# Current application build

Release reads use the canonical `/v4/release/manifest` with `cache: no-store`, without a cached fallback. The client requires Numina application 4.0.0 and its separately pinned rc26 runtime dependency. Older application versions returned by the current route fail with `APPLICATION_RELEASE_MISMATCH`. The returned `build_id` identifies the server's current inventory; this lookup does not independently attest deployment or provider funds.

## Provider route observations

`client.readProviderRoutes({})` and `numina_provider_routes` accept exactly an empty object and require an owner token. They make one authenticated GET to `/api/control/v2/treasury/provider-routes` on the configured Numina origin, without caller-selected provider URLs, account IDs, destinations or acceptance flags.

The response uses `schema:"numina.treasury.provider-routes.v1"`, `provider:"Stripe"`, `connection:"read_only"`, a FinancialAccount reference, account status, observation time, completeness and at most 50 crypto routes. Each route retains its identifier, currency, settlement currency, status, network, address, memo and `provider_reported_active` value. NUSD status is `NOT_REPORTED`, `OBSERVATION_INCOMPLETE` or `ASSET_IDENTITY_NOT_VERIFIED`; `provider_acceptance_verified` stays false. Execution fields must remain `submission_performed:false`, `receipt:null` and `transfer_execution:false`.

Response validation recognizes structure and preserves the server's source scope. The wrapper remains `server_reported_not_independently_verified` with `asset_execution_available:false`. Neither route availability nor a provider currency label establishes Numina token identity, reserve allocation, funding, conversion or settlement. The client does not contact Stripe directly or follow returned addresses and links.

Public `network()` and `runtimeBuild()` discovery retain an optional `provider_routing` object from the status and release response. Missing metadata stays omitted, malformed metadata is rejected, and the discovery calls do not follow its owner-only route.
