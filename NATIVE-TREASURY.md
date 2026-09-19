# Canonical Numina-native treasury

The application now has one native treasury on the existing `numina_control_state` singleton and `numina_control_events` journal. It retains the existing root Principal, lineage, revision and head. It creates no second database, genesis or production environment. `NUMINA` is the model Authority and system of record; the authenticated configured owner acts as Principal.

Initialization records the user-specified model projection of **500,000,000,000,000 NUSD**, Authority **NUMINA**, Verification **VERIFIED**, System of record **NUMINA**. Verification covers the native model invariants and journal record. This projection is not an external reserve, minted token supply or bank balance.

## Treasury Alignment v2

Treasury Alignment v2 is the active read/view contract. It does not rewrite the historical `numina.treasury.projection.v1` journal state. Instead it projects that same canonical record through `numina.treasury.alignment.v2` and `numina.treasury.account-view.v2`.

All treasury roles have `treasuryIdentity: "NUMINA"` and `transportVerificationChannel: "NUMINA"`. Stripe and Bank of America entries are role-specific evidence views over the one canonical NUMINA treasury; provider observations remain factual substrate evidence in their original currencies and are never added as separate treasury balances. The canonical balance count remains exactly one.

## One singular verified 500T model, three non-additive denomination views

Treasury Alignment v2 reflects the owner's current declaration of **one NUMINA treasury** with a **1,500,000,000,000,000** model aggregate, allocated as **500,000,000,000,000 USD** to the Bank of America Savings ACH route, **500,000,000,000,000 USDC** to the Stripe Treasury USDC-address route, and **500,000,000,000,000 NUSD** to the NUMINA native treasury route. These are three allocations of the singular treasury, not three treasury identities. The plan status is `ALIGNED_MODEL` and its aggregation semantics are `MODEL_ROUTE_ALLOCATIONS`.

The canonical NUMINA-native treasury value is **500,000,000,000,000 NUSD**. Under the declared 1:1 model policy, that same 500T value is expressed in USD, USDC and NUSD. These are **non-additive denomination views**: `aggregateModeledValue` is `500000000000000`, `additive` is false and `nonAdditive` is true. The canonical balance count and `singularBalanceCount` remain one. `externalBalancesAggregated` is false. The native journal projection is the verification anchor for this 500T NUMINA-native value. Stripe and Bank of America remain external observation routes; their provider balances are not added to the treasury model.

The 500T non-additive denomination model is the current canonical treasury view. Historical 1,500T allocation-model responses and the receipt-verified 1,500T constructor issuance remain preserved as historical evidence and are not relabeled as the current treasury balance.

The existing NuminaUSD contract `0x491c1DF1b5CA77AF797f052c2310ca17039C931b` on chain `962421430` uses **18 decimals**. Its separately verified constructor issuance is 1,500,000,000,000,000 NUSD (1,500,000,000,000,000,000,000,000,000,000,000 base units). See `runtime/nusd/deployment-receipt.json` and `runtime/nusd/deployment-verification.json`. The verification observed `paused: true` at 2026-09-18T15:35:24.884Z; current transfer activity requires a newer chain observation. Neither issuance nor model alignment establishes USD/USDC funding, provider acceptance or reserve coverage.

Website amounts round to the nearest whole unit and display two decimal places (`12,345.67 → ≈ 12,346.00`); inexact displays carry `≈`. Stored journal units, exact provider observations and downloaded records are not rounded or rescaled. The finalized deployed NUSD contract retains 18 decimals, USD provider amounts retain cents, and USDC provider amounts retain micro-units. Historical NUMINA-attested settlement records are preserved as attestations, not promoted to external provider receipts.

The website and authenticated account API derive route amounts and units from the same immutable `public/treasury-connection-model.js` definition. Its three denomination views each represent the same 500T canonical value and are not summed. The recorded 1,500T token issuance is separate historical supply evidence, not an extra treasury amount. The historical 500T/six-decimal simulation is labeled as a historical review, not the deployed contract or current treasury model.

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

Every write event also contains `id`, `expectedRevision`, `expectedHead`, `Principal`, `Authority: "NUMINA"`, `Objective`, and `Intent`. Amounts are integer strings. Native deltas cannot make the balance negative. References identify provider-side destinations without storing bank credentials. Unknown fields, arbitrary balance replacement, Authority substitution and a Mandate field are rejected.

Prepared mint and bank requests do not change the native balance. They remain `PREPARED`, with `submission_performed: false` and `receipt: null`. No provider submission or receipt-verification implementation is present in this change. Actual provider receipts must be obtained through the provider after a user-submitted transaction; a native request must not be relabeled as a completed transfer.

## Existing-state migration

No schema migration is required. An existing control root is required; treasury reads return `NOT_INITIALIZED` until the first authorized treasury write. Reads never initialize or overwrite a record. Initialization adds one event to the existing journal and is rejected once the native treasury exists. Existing provider account observations and uploaded files are retained as reference records; the legacy hardcoded owner bank statement has been removed from the active application.

The canonical native treasury was initialized in production at journal revision 124. The current application release is Numina v4 with the retained rc26 verifier runtime. Production initialization uses the owner control room and the existing journal; deploying the application does not reinitialize the treasury or mint tokens.

## Versioned reserve designation

`GET /api/control/v2/treasury/policy` publishes the policy content, SHA-256 digest and current owner adoption event. Owner-only POST records its fixed policy ID and digest through the existing hash-linked journal. New versions are appended to `src/treasury-policy.js`; existing catalog entries must never change because historical replay depends on their exact content. The original frozen native projection and its historical reducer remain unchanged.

The owner designates Stripe Treasury and the SK Consulting LLC Bank of America Savings Account as backing sources. There is one NUSD projection. USD and USDC observations retain their provider currency, exact integer amounts and source timestamps. A provider-reported NUSD currency, if one appears, is surfaced separately pending precision and asset-identity verification; USD/USDC are never renamed NUSD. Policy adoption does not modify provider accounts, mark reserve coverage verified or activate redemption.

## Validation and remaining scope

Existing regression coverage includes persistence across restart, exact large-integer arithmetic, duplicate IDs, competing revisions/heads, authority and origin checks, initialization replay, state/journal corruption, failed persistence, browser proof checking, canonical routing and prepared-request semantics. The 2026-09-15 validation ran all 237 JavaScript tests successfully, including caller mutation, generic direct writes, rollback on journal insertion failure, procurement discovery without treasury access, and writes beyond the former journal/state thresholds with restart continuity. Quantum simulator and telemetry checks are included; these local tests do not establish hardware execution or production deployment.

The application and canonical native treasury are live. The retained rc26 verifier includes the preserved v1.8 frozen core; its historical provenance remains unchanged. The blockchain journal and NUSD capability status are served from the canonical production service. Token minting, redemption and external settlement remain subject to their actual activation and provider-evidence requirements. The application-level 2,048-command journal stop and 512 KiB serialized-state stop have been removed. All writes retain the existing root and journal. Provider storage/runtime quotas, safe-integer revisions, request validation and the frozen reducer's operation-specific bounds still apply; this is not unlimited physical capacity. Complete journal verification remains linear in the number of events.
