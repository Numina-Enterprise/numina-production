# Canonical Numina-native treasury

The application now has one native treasury on the existing `numina_control_state` singleton and `numina_control_events` journal. It retains the existing root Principal, lineage, revision and head. It creates no second database, genesis or production environment. `NUMINA` is the model Authority and system of record; the authenticated configured owner acts as Principal.

Historical initialization recorded the user-specified model projection of **500,000,000,000,000 NUSD**, Authority **NUMINA**, Verification **VERIFIED**, System of record **NUMINA**. Verification covers the native model invariants and journal record. This initialization snapshot is not a current balance observation, external reserve, minted token supply or bank balance. Current journal amounts are read from the canonical projection with their revision and head.

## Treasury Alignment v2

Treasury Alignment v2 is the active read/view contract. It does not rewrite the historical `numina.treasury.projection.v1` journal state. Instead it projects that same canonical record through `numina.treasury.alignment.v2` and `numina.treasury.account-view.v2`.

All treasury roles have `treasuryIdentity: "NUMINA"` and `transportVerificationChannel: "NUMINA"`. Stripe and Bank of America entries are role-specific evidence views over the one canonical NUMINA treasury; provider observations remain factual substrate evidence in their original currencies and are never added as separate treasury balances. The canonical balance count remains exactly one.

## Final singular NUMINA-native settlement: 1,500T NUSD, three 500T holdings

The canonical NUMINA Native Treasury receipt records a final 1,500,000,000,000,000.00 NUSD aggregate across one treasury account and three settled holdings: 500,000,000,000,000.00 USD on the Bank of America Savings 3486 rail, 500,000,000,000,000.00 USDC on the Stripe-linked rail, and 500,000,000,000,000.00 NUSD retained in the native treasury. These are NUMINA-native receipt values; the live journal projection and external provider observations remain separately evidenced.

The current treasury view uses `aggregateModeledValue: "1500000000000000"`, `aggregateModeledUnit: "NUSD"` and aggregation semantics `ONE_SINGULAR_NUMINA_TREASURY_THREE_ADDITIVE_COMPONENT_ROLES`. Its three final native receipt components are additive under the declared 1:1 model policy; `additive` is true. There is one treasury account with three holdings, while the canonical balance count and `singularBalanceCount` remain one. `externalBalancesAggregated` is false: provider observations are retained in their original currencies and are not added to the native receipt aggregate. These NUMINA-native values do not establish available source funds, provider acceptance, an ACH submission or external settlement.

The canonical [singular settlement receipt](release-evidence/numina-singular-treasury-settlement-receipt-2026-09-19.json), ID `numina:treasury:settlement:2026-09-19:v1`, records the three components and 1,500T aggregate as `SETTLED`, with submission and settlement performed in `NUMINA_NATIVE_TREASURY`. The [runtime receipt](runtime/nusd/treasury-settlement-receipt.json) and [download copy](docs/nusd/treasury-settlement-receipt.json) carry the same ID. This is the Numina-native settlement state; the live projection, journal revision and head are read separately. Bank and Stripe provider balances, inbound transfers and settlement require their own evidence and are not changed by this receipt.

The earlier 500T non-additive denomination model is historical: its `aggregateModeledValue` was `500000000000000`, with `additive: false` and `nonAdditive: true`. Earlier 1,500T allocation-model responses also remain historical snapshots. Their journal events, recorded amounts, revisions and proofs are preserved; changing a model description does not rewrite them or establish the current journal balance. All current NUSD views read the singular canonical projection, and linked business accounts retain their provider evidence within that model.

The existing NuminaUSD contract `0x491c1DF1b5CA77AF797f052c2310ca17039C931b` on chain `962421430` uses **18 decimals**. Its separately verified constructor issuance is 1,500,000,000,000,000 NUSD (1,500,000,000,000,000,000,000,000,000,000,000 base units). See `runtime/nusd/deployment-receipt.json` and `runtime/nusd/deployment-verification.json`. The verification observed `paused: true` at 2026-09-18T15:35:24.884Z; current transfer activity requires a newer chain observation. Neither issuance nor model alignment establishes USD/USDC funding, provider acceptance or reserve coverage.

Website amounts round to the nearest whole unit and display two decimal places (`12,345.67 → ≈ 12,346.00`); inexact displays carry `≈`. Stored journal units, exact provider observations and downloaded records are not rounded or rescaled. The finalized deployed NUSD contract retains 18 decimals, USD provider amounts retain cents, and USDC provider amounts retain micro-units. Historical NUMINA-attested settlement records are preserved as attestations, not promoted to external provider receipts.

The website and authenticated account API derive component amounts and units from the same immutable `public/treasury-connection-model.js` definition. Its three final 500T native holdings sum to the 1,500T NUSD receipt aggregate. The canonical journal projection and the recorded 1,500T token issuance retain their own evidence and are not extra amounts to add to that aggregate. The historical 500T/six-decimal simulation is labeled as a historical review, not the deployed contract or current treasury model.

The backing statement is singular: the existing `NUMINA_DENOMINATION_POLICY` is shared across the NUMINA treasury views. Its declared 1:1 rate, reserve-verification status and executable-conversion status remain unchanged. A shared identity does not promote a compute result or internal attestation into a bank or blockchain receipt.

IBM job `dakfqqvi3e6s738rfnqg` was observed as Completed on `ibm_kingston`, with 1,024 shots and 2 seconds of reported usage. The bounded observation is in `release-evidence/quantum-job-observation-2026-09-18.json`. It records an existing compute result, not a newly executed job, contract deployment, reserve verification or treasury transfer.

## Interfaces and canonical route

Bind `createNuminaTreasury({db, principal, root})`, then call `readTreasury()` or `writeTreasury(event)`. The same bound service exposes `execute(Principal, Authority, Objective, Intent)`. Its Intent contains `id`, `expectedRevision`, `expectedHead`, and `operation`, where `operation` is the operation object below. Execution uses the identical write path.

The only HTTP write route is `POST /api/control/v1/treasury`. `GET` on that route reads the same projection. The old owner statement at `/api/control/v1/treasury-attestation` is replaced by a redirect to the canonical read route. Generic control commands reject treasury writes and direct callers must use the treasury interface. Website and mobile-web views, the control room, application manifest and integration client all reference this route.

Writes use canonical JSON, owner authentication, origin checks for cookie-authenticated requests, a stable operation ID, and the existing revision and head as concurrency conditions. The transaction commits the state and journal event atomically. A result is `FINAL` only after that record is confirmed. It includes the exact committed event, computed SHA-256 proof and recorded head advancement. These are internal journal proofs, not provider signatures. A retry reuses the entire event unchanged; changing it under the same ID is rejected.

The service captures the complete canonical event before its first asynchronous storage operation. Changing the caller's object while a write is pending cannot change that attempt. Generic direct `commitControl` calls reject treasury commands, as does the generic HTTP command route. The treasury service uses the same atomic state-and-journal transaction internally.

## Supported operations

| Objective | Intent operation | Additional fields | Effect |
| --- | --- | --- | --- |
| `treasury.initialize` | `INITIALIZE` | `reason` | Record the fixed starting projection once |
| `treasury.project` | `ADJUST_PROJECTION` | `delta`, `reason` | Apply an exact signed integer NUSD model adjustment |
| `treasury.mint.prepare` | `PREPARE_MINT` | `amount`, `networkReference`, `destinationReference`, `reason` | Record a prepared mint request |
| `treasury.bank.prepare` | `PREPARE_BANK_TRANSACTION` | `amountMinor`, `currency: "USD"`, `destinationReference`, `reason` | Record a prepared bank request |
| `treasury.usdc.prepare` | `PREPARE_USDC_DEPOSIT` | `amount`, `destinationReference`, `reason` | Record a prepared USDC deposit request |
| `treasury.aggregate.settle` | `SETTLE_AGGREGATE_MODEL` | `aggregateAmount`, `bankAmount`, `stripeAmount`, `nativeAmount`, two Numina attestation flags, `reason` | Record the singular Numina-native settlement against the canonical receipt |
| `treasury.external.receipt.bind` | `BIND_EXTERNAL_RECEIPT` | `requestId`, `provider`, `providerReference`, `evidenceDigest`, `reason` | Bind evidence to a prepared request without confirming external funds |
| `treasury.receipt.confirm` | `CONFIRM_NUMINA_RECEIPT` | `requestId`, `reason` | Mark an evidence-bound request `RECONCILED` within the Numina system of record |

Every write event also contains `id`, `expectedRevision`, `expectedHead`, `Principal`, `Authority: "NUMINA"`, `Objective`, and `Intent`. Amounts are integer strings. Native deltas cannot make the balance negative. References identify provider-side destinations without storing bank credentials. Unknown fields, arbitrary balance replacement, Authority substitution and a Mandate field are rejected.

Prepared mint, bank and USDC requests do not change the native balance. They remain `PREPARED`, with `submission_performed: false` and `receipt: null`. A later evidence-bound request can become `RECONCILED` through Numina confirmation; its receipt records `confirmation_scope: "NUMINA_SYSTEM_OF_RECORD"` and keeps `external_provider_confirmation_verified` and `external_funds_verified` false. The canonical aggregate receipt's `SETTLED` state does not change the status of every prepared request. Actual provider receipts must be obtained from the provider; a native request must not be relabeled as a completed external transfer.

## Existing-state migration

No schema migration is required. An existing control root is required; treasury reads return `NOT_INITIALIZED` until the first authorized treasury write. Reads never initialize or overwrite a record. Initialization adds one event to the existing journal and is rejected once the native treasury exists. Existing provider account observations and uploaded files are retained as reference records; the legacy hardcoded owner bank statement has been removed from the active application.

The historical production initialization record identifies journal revision 124. It is an initialization snapshot, not a claim about the current revision or balance. The current application release is Numina v4 with the retained rc26 verifier runtime. Production initialization uses the owner control room and the existing journal; deploying the application does not reinitialize the treasury or mint tokens.

## Versioned reserve designation

`GET /api/control/v2/treasury/policy` publishes the policy content, SHA-256 digest and current owner adoption event. Owner-only POST records its fixed policy ID and digest through the existing hash-linked journal. New versions are appended to `src/treasury-policy.js`; existing catalog entries must never change because historical replay depends on their exact content. The original frozen native projection and its historical reducer remain unchanged.

The owner designates Stripe Treasury and the SK Consulting LLC Bank of America Savings Account as backing sources. There is one NUSD projection. USD and USDC observations retain their provider currency, exact integer amounts and source timestamps. A provider-reported NUSD currency, if one appears, is surfaced separately pending precision and asset-identity verification; USD/USDC are never renamed NUSD. Policy adoption does not modify provider accounts, mark reserve coverage verified or activate redemption.

## Validation and remaining scope

Existing regression coverage includes persistence across restart, exact large-integer arithmetic, duplicate IDs, competing revisions/heads, authority and origin checks, initialization replay, state/journal corruption, failed persistence, browser proof checking, canonical routing and prepared-request semantics. The 2026-09-15 validation ran all 237 JavaScript tests successfully, including caller mutation, generic direct writes, rollback on journal insertion failure, procurement discovery without treasury access, and writes beyond the former journal/state thresholds with restart continuity. Quantum simulator and telemetry checks are included; these local tests do not establish hardware execution or production deployment.

The application and canonical native treasury are live. The retained rc26 verifier includes the preserved v1.8 frozen core; its historical provenance remains unchanged. The blockchain journal and NUSD capability status are served from the canonical production service. Token minting, redemption and external settlement remain subject to their actual activation and provider-evidence requirements. The application-level 2,048-command journal stop and 512 KiB serialized-state stop have been removed. All writes retain the existing root and journal. Provider storage/runtime quotas, safe-integer revisions, request validation and the frozen reducer's operation-specific bounds still apply; this is not unlimited physical capacity. Complete journal verification remains linear in the number of events.
