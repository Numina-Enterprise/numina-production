# Numina compute-to-value architecture: NUSD

Proposed integration specification, updated 11 September 2026. **NUSD is the intended pricing and payment unit across every Numina compute-to-value service. Numina treasury is the intended backing source. The user-declared stabilization target is 1 NUSD = 1 USD.** This is target architecture, not evidence that every provider is integrated, tokens are issued, treasury assets are funded or external payments are enabled.

## Service and unit model

Scope includes all LLM providers/models and other compute-to-value services: inference, training, data processing, rendering, simulations, automation, API-result unlocks and delivered applications/services. Each needs its own adapter, measurable unit, authority and acceptance criteria. Provider names alone are not integration evidence.

Quote accepted work in **NUSD per agreed unit**, with a maximum NUSD budget. Record the declared NUSD/USD target of 1 separately from observed prices and redeemable amounts. Any target-based USD illustration must say “at the declared target; not an exchange quote.” No USDC reserve or conversion is implied. Keep provider invoices in their original currency. External quotes must identify source, pair, timestamp, expiry, fees and execution evidence.

The current contract candidate uses six decimal places: 1 NUSD = 1,000,000 base units. This denomination is separate from the declared dollar target. Neither the token name nor decimals implement price stabilization, asset custody or a redemption right.

## Intended flow

1. Agree service, unit, NUSD price, maximum quantity/budget, acceptance authority, recipient, deadline and dispute/refund rules.
2. Establish an authorized, actually available NUSD balance in the selected ledger/payment system. Simulation balances remain assumptions. A compute receipt does not automatically mint spendable NUSD.
3. An authorized adapter performs bounded work and records order/job IDs, provider/model or compute type, units, output references, original-currency costs, timestamps and authenticated evidence.
4. Evaluate customer acceptance separately from consumption. Bind accepted quantity and output to the acceptance authority; resource usage alone does not establish customer value.
5. Authorize the accepted NUSD charge within funding and caps. Bind order, payer, recipient, unit/asset, ledger or network/contract, fee, nonce and expiry.
6. Independently confirm payment, then fulfill the agreed API unlock, result, application or service and record delivery evidence.
7. Reconcile charges, fees, recipient amounts, refunds, unused funding and issuance/burn liabilities separately. Define paths for expiry, rejection, overpayment and failed delivery.
8. External conversion or redemption is optional only when separately established by terms, eligibility, liquidity and execution evidence. No automatic bank payout, USDC reserve or dollar redemption is assumed.

## Treasury and execution boundary

Backing needs documented treasury composition, legal ownership, custodian, encumbrances, valuation method, holder claim, supply/obligation reconciliation and independent audited evidence. A ledger can record and help evidence existing assets and enforceable rights when tied to underlying contracts, control/custody and valuation. Completed accepted work may support an enforceable receivable; reconciled paid invoices evidence collections, while future projections remain forecasts. Do not count both a settled receivable and its collected funds as separate backing. [IFRS revenue principles](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/)

Mint authority follows the approved issuance policy. The declared 1:1 target requires a defined stabilization mechanism, liquidity, shortfall response and holder terms. No market price, maintained peg, reserve amount or redemption capability is verified. Payment-stablecoin classification and permitted reserve assets require review against the actual model and applicable effective dates. [GENIUS Act](https://www.govinfo.gov/content/pkg/PLAW-119publ27/html/PLAW-119publ27.htm)

Order states: proposed → authorized funding available → work submitted → accepted/disputed → release authorized → payment submitted → payment confirmed → fulfilled. Cancellation/refund and optional redemption have distinct records.

Controls include checked integer arithmetic, fee conservation, authenticated inputs, replay protection, exact asset/recipient binding, restricted keys, idempotent callbacks, recovery and defined upgrade/pause authority. Tokens sharing NUSD's symbol are not interchangeable.

Before enabling an adapter/payment route, verify implementation, security review, funding/authority, failure recovery, legal/provider eligibility and end-to-end reconciliation. Separating an API in code does not decide its legal relationship to the issuer.

## Commercial presentation

NUSD is the target unit throughout compute-to-value services. Existing professional-service prices and payment contracts require explicit changes through their own supported commercial flow; this specification does not claim existing USD/Stripe transactions were converted. Distinguish implemented integrations from intended universal coverage, and order volume from holdings, treasury value, revenue and profit.

The [NUSD status](https://numinalabs.xyz/api/nusd/v1/status) records unresolved backing and rights evidence. Software creation and value transmission require model-specific analysis; no exemption is claimed. [FinCEN guidance](https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-fincens-regulations-virtual)
