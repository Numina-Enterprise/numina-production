# NUSD provider routing

The owner can select **Check deposit routes** in the Stripe panel in the application or control room. This reads `GET /api/control/v2/treasury/provider-routes`. The public descriptor at `/api/nusd/v1/provider-routing` also appears in NUSD status and the application manifest. The integration client exposes the same owner-only read as `readProviderRoutes()` / `numina_provider_routes`.

## What the route checks

The server uses its restricted live Stripe credential to read the configured Financial Account, then its existing Financial Addresses. It returns crypto destinations with their exact provider currency, settlement currency, network, address, memo and active status. Bank credentials and unrelated provider fields are excluded. The account must be open for a destination to be reported active.

The reader uses the pinned Stripe API version `2026-08-26.preview`, a bounded response and deadline, and a maximum of 50 address records. It never follows redirects or provider pagination URLs. If more records exist or a credential type cannot be classified, `complete` is false and absence is inconclusive. Requests cannot substitute an account, endpoint, network or currency. Owner authentication, origin checks, private no-store responses and GET-only access apply.

## Acceptance scope

An active USDC destination reports a USDC route on its listed network. It does not accept NUSD merely because the application declares 1 NUSD = 1 USD = 1 USDC. A matching address on another network is a different destination.

NUSD is `NOT_REPORTED` when a complete response contains no NUSD crypto route, `OBSERVATION_INCOMPLETE` when the list is incomplete without a matching label, or `ASSET_IDENTITY_NOT_VERIFIED` when a provider reports the NUSD label. A label alone does not bind the provider's asset to the Numina token contract, chain and precision. This implementation therefore keeps `provider_acceptance_verified: false`; token-specific acceptance needs its own provider evidence and verification implementation.

The response is a server observation, not a provider signature or deposit receipt. Reading it does not create destinations, mint, convert, transfer funds, change balances or commit a journal event. Source funds, reserve allocation and settlement remain separately verified. `POST /api/control/v1/treasury` remains the canonical native treasury write path.

## Provider reference

[Stripe Financial Addresses API](https://docs.stripe.com/api/v2/money-management/financial-addresses) describes the provider resource. The exact preview request schema and credential fields were checked against the connected provider API before implementation. Live observations are retrieved when the owner requests them; they are not embedded as permanent acceptance claims in the build.
