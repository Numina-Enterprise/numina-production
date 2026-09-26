# Numina historical and current metadata

**Source of truth: NUMINA.** The authenticated Numina Native Treasury journal at `/api/control/v1/treasury` supplies current software state. The [alignment inventory](/metadata-alignment.json) links that state to dated chain records and retained historical metadata.

## Canonical constructor mint

| Field | Numina retained receipt |
| --- | --- |
| Constructor mint block | **51725** |
| Transaction | `0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b` |
| Contract | `0x491c1DF1b5CA77AF797f052c2310ca17039C931b` |
| Chain ID | `962421430` |
| Receipt status | `0x1` |
| Issuance | `1,500,000,000,000,000.00 NUSD` |
| Token decimals | `18` |
| Retained observation | `2026-09-18T15:35:24.884Z` |

The separate settlement-contract deployment occurred at **block 51726**. It records contract creation. The [mint receipt](/downloads/nusd/mint-receipt.json) and [deployment receipt](/downloads/nusd/deployment-receipt.json) retain their original bytes.

The retained deployment verification at block **51749** observed constructor issuance, total supply and the initial recipient balance at the same `1,500,000,000,000,000,000,000,000,000,000,000` base units. It therefore records **0 NUSD burned** at that dated observation. This does not establish the current chain burn state. The observed issuer policy hash `0x2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5` binds the declared 1:1 issuer policy; it is not evidence of external USDC or USD backing. The same verification records `externallyBackedClaim: false`, external USDC settlement false and reserves unverified.

The superseding [settlement validation](/downloads/nusd/treasury-settlement-receipt-validation.json) preserves the 2026-09-19 static record as historical provenance and classifies the assertion as `NUMINA_VERIFIED_ASSERTION`, verified by NUMINA. It separately records owner authorization for execution, settlement and a journal append. The authenticated journal contains no matching settlement event, so `journalAuthenticated`, `executionVerified`, `submissionPerformed`, `broadcastPerformed` and `settlementPerformed` remain false. The constructor mint at block 51725 and the zero-burn observation at block 51749 remain mint-only evidence and do not establish provider backing or settlement.

## Reading earlier records

- Earlier 500T, six-decimal materials describe a review or simulation. Their amounts, code and signatures belong to that earlier version. The confirmed constructor above uses 18 decimals and 1,500T NUSD.
- The three 500T USD, USDC and NUSD figures describe a prepared aggregate model. The USD route uses the `NUMINA_SCOPED_OBSERVATION` scope, the USDC route remains provider scoped, and the NUSD route remains receipt backed issuance. These roles do not replace the journal projection or establish provider balances.
- Build attestations identify their source revision and artifacts. They do not confirm a provider submission or financial settlement.
- Historical pause, activation, readiness and transfer claims retain their observation or declaration scope. Present chain state requires a fresh authorized chain observation.
- Original receipts, journal entries, signed statements and archived artifacts remain intact. The inventory records their exact hashes and supplies the current interpretation alongside them.

## Current views

The [mint workflow](/api/nusd/v1/mint-workflow), [status](/api/nusd/v1/status), [contract record](/api/nusd/v1/contracts), release manifests and source alignment use the same constructor evidence. Current readiness is reported separately from implemented functions and completed historical issuance.

The journal observation used in this publication is revision **142**, head `67b45a040374d944f42f26830c4a9142e26fa194d5149b7cfad2604aef351368`: a **500T NUSD** projection, a prepared NUSD mint request and a prepared USD bank request. That observation contains no Base USDC transfer request. It is a dated snapshot; later state must be read from the authenticated journal.

## Authorized Base USDC deposit intent

The owner authorized a deposit of **500,000,000,000,000.00 USDC** to Stripe financial account `fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu`, financial address `finaddr_61VNd8JyhbqklVBhF16VNcN9EZSQiQliazWdBc8FkRw8`, at `0x736bd8f274dce00a8bb374edd85df0d2e631018e`. The provider observation identifies the currency as **USDC**, the network as **Base** (chain ID **8453**) and the address as active. The provider balance and inbound pending balance were both zero at that observation. Circle's current contract registry identifies native Base USDC as `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

The authorization and exact amount are recorded as an unsubmitted intent because the authenticated journal snapshot contains no Base USDC transfer request. The source wallet, signer control, source USDC balance, Base ETH gas balance, idempotency state and replay state remain unverified. No journal write, broadcast, transaction hash, receipt, provider credit or reconciliation is recorded.

The current source implements a canonical `PREPARE_USDC_DEPOSIT` journal operation at `/api/control/v1/treasury`. A successful commit would add one `PREPARED` `usdc_transfer_request`, advance the journal by one revision, preserve the NUSD projection balance, bind Base chain `8453` and canonical USDC, and retain null source wallet, balance, transaction hash and receipt fields with execution, broadcast and submission set to false. This is an implemented request schema, not a live journal event; the revision-142 observation still has no Base USDC transfer request.

The historical Numina managed deployment sender `0x1a45671ae2ee3e52264116151924faacb80fc02e` was checked only as a candidate source through a read-only Base observation. At Base block `51830620` (hash `0x8e8c4b0f29b1486be1d484c2a0c7659cb9827b668d35e9a622d13824ed6a1a18`), it had `0` wei, `0` native USDC base units and transaction count `0`. Its historical role on Numina chain `962421430` does not establish current Base signer control, and the observed candidate cannot fund the USDC transfer or pay Base gas.

## Prepared aggregate model schema

The source implements `PREPARE_AGGREGATE_MODEL` for one model-only journal request. It records three separate 500T roles: NUSD as `NATIVE_VALUE` with receipt-backed issuance evidence, USDC as `DIGITAL_DOLLAR_ROUTE` with provider-scoped observation, and USD as `BANK_ROUTE` with source-scoped observation. Their modeled sum is 1,500T while the native NUSD projection remains 500T. The result is `PREPARED_MODEL_ONLY`; external balances, backing, funds movement, execution, broadcast, submission and settlement remain false, the transaction hash and receipt remain null, and reconciliation remains pending evidence. The schema is implemented in source but has not been committed to the live revision-142 journal.

## Owner-provided bank alignment

The owner linked the same nominal amount to a Bank of America account ending in **3486**, ACH routing reference `073000176`, confirmation `8000750550`, and an asserted cleared date of **2026-08-31**. The full account number is excluded from public metadata. This is a `source_scoped_assertion`: `assertedCleared` is true while `providerVerified` and `reservesVerified` are false and `clearedByProvider` is null. The retained provider observation describes a different displayed transaction amount and confirmation, so it does not verify the 500T USD claim, conversion, external funds movement or settlement.

This publication aligns metadata. It records no new issuance, conversion, deposit or reconciliation. The Stripe destination is on Base; the Numina constructor mint uses chain `962421430`. A broadcast requires its own exact journal transfer request and amount, authorized source signer, source balances, canonical token identity, replay protection and resulting receipts.
