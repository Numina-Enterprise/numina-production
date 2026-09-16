# Stripe provider route setup

The owner-only route reader needs two independent Stripe read permissions. A successful balance read does not demonstrate access to Financial Addresses.

## Production settings

Use the existing Numina Stripe account `acct_1UEEPnQdJat0efmT` and Financial Account `fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu`. The API version is pinned to `2026-08-26.preview`.

Set these variables in the existing Sites production environment:

| Variable | Value |
| --- | --- |
| `NUMINA_STRIPE_TREASURY_READ_KEY` | Existing live restricted key, stored only as a server secret |
| `NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT` | Financial Account ID above |

The key needs **Money Management Financial Accounts: Read** and **Money Management Financial Address: Read**. Stripe's confirmed permission identifier for the latter is `money_management_financial_address_read`. No money-movement or write permission is required. Preserve unrelated settings on an existing key. Never commit a key, place it in client code, or paste it into a diagnostic record.

The source template is `.env.example`; the machine-readable requirements are `config/stripe-provider-routes.json`. These files describe configuration, not a claim that the deployed credential has those permissions. Changing source files alone does not change Stripe key permissions.

## Inspect and repair the deployed connection

1. Sign in to the Numina Stripe account and open Workbench request logs. Find the latest `GET /v2/money_management/financial_addresses` request caused by **Check deposit routes** in the Numina owner control room.
2. Inspect its HTTP status, request ID and error. Use the masked key identity in that request to locate the exact deployed restricted key. Do not reveal or copy its secret.
3. In the restricted key's permissions, inspect Money Management Financial Address. If Read is missing, obtain authorization and enable that specific read permission. Retain Financial Accounts Read and other existing settings. Save and confirm the visible saved setting.
4. If permissions were updated on the existing key, retry without replacing the credential. If the configured key was rotated, have the owner update the server secret through the existing production environment's secure workflow and deploy that environment change.
5. In Numina's owner control room, select **Check deposit routes** again. Confirm the browser request returns HTTP 200 and Stripe Workbench records the matching successful address read. Record the observation time, request ID, exact currencies and `complete` value.

Do not use a broader secret key, grant write access, substitute a different account, or create a new treasury root to bypass a denied read.

## Browser and server diagnostics

| Browser result | Meaning and next action |
| --- | --- |
| `503 STRIPE_PROVIDER_ROUTES_ACCESS_DENIED` | Stripe returned 403. Inspect the matching Stripe request and Financial Address Read permission. A 403 alone does not identify every possible restriction. |
| `503 STRIPE_TREASURY_NOT_CONNECTED` | Required restricted-key format or pinned Financial Account configuration is missing or invalid. Inspect server settings. |
| `503 STRIPE_PROVIDER_ROUTES_UNAVAILABLE` | Another upstream HTTP failure, rejected redirect or connection failure. Inspect safe server diagnostics and the provider request. |
| `503 STRIPE_TREASURY_UNAVAILABLE` | The preliminary Financial Account read failed. Inspect its separate diagnostic event. |
| `502 STRIPE_PROVIDER_ROUTES_INVALID_RESPONSE` or `STRIPE_TREASURY_INVALID_RESPONSE` | The returned account, address data or response format could not be validated. |
| `504 STRIPE_TREASURY_TIMEOUT` | The shared account/address deadline expired. Retry after checking provider availability. |
| Numina HTTP 401/403 | Owner authentication or origin check failed; restore authorized access to Numina. |

The address reader logs `stripe_provider_routes_provider_error` with upstream `http_status` and a sanitized `request_id`. Unexpected runtime errors log `stripe_provider_routes_runtime_error` with a fixed stage, category and allowlisted error name. Logs exclude keys, authorization headers, raw error messages, response bodies and bank details. Provider 403 stays HTTP 503 at Numina so it cannot be confused with an expired owner session.

## Successful read scope

An HTTP 200 confirms a validated route observation. Keep provider currencies, networks, addresses and memos exactly as returned. An active USDC destination does not establish acceptance of the NUSD token, source funds, conversion or a completed deposit. The reader does not submit transactions or change the journal. See [NUSD provider routing](NUSD-Provider-Routing.md) for acceptance semantics and [Stripe Financial Addresses](https://docs.stripe.com/api/v2/money-management/financial-addresses) for the provider resource.
