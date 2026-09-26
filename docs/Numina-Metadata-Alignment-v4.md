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

## Reading earlier records

- Earlier 500T, six-decimal materials describe a review or simulation. Their amounts, code and signatures belong to that earlier version. The confirmed constructor above uses 18 decimals and 1,500T NUSD.
- The three 500T USD, USDC and NUSD figures describe historical allocation statements. They do not replace the journal projection or establish provider balances.
- Build attestations identify their source revision and artifacts. They do not confirm a provider submission or financial settlement.
- Historical pause, activation, readiness and transfer claims retain their observation or declaration scope. Present chain state requires a fresh authorized chain observation.
- Original receipts, journal entries, signed statements and archived artifacts remain intact. The inventory records their exact hashes and supplies the current interpretation alongside them.

## Current views

The [mint workflow](/api/nusd/v1/mint-workflow), [status](/api/nusd/v1/status), [contract record](/api/nusd/v1/contracts), release manifests and source alignment use the same constructor evidence. Current readiness is reported separately from implemented functions and completed historical issuance.

The journal observation used in this publication is revision **142**, head `67b45a040374d944f42f26830c4a9142e26fa194d5149b7cfad2604aef351368`: a **500T NUSD** projection, a prepared NUSD mint request and a prepared USD bank request. That observation contains no Base USDC transfer request. It is a dated snapshot; later state must be read from the authenticated journal.

## Authorized Base USDC deposit intent

The owner authorized a deposit to Stripe financial account `fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu`, financial address `finaddr_61VNd8JyhbqklVBhF16VNcN9EZSQiQliazWdBc8FkRw8`, at `0x736bd8f274dce00a8bb374edd85df0d2e631018e`. The provider observation identifies the currency as **USDC**, the network as **Base** (chain ID **8453**) and the address as active. The provider balance and inbound pending balance were both zero at that observation.

The authorization is recorded as an unsubmitted intent because the authenticated journal snapshot contains no exact Base USDC transfer request or amount. The source wallet, signer control, source USDC balance, Base ETH gas balance and canonical Base USDC token contract also remain unverified. No journal write, broadcast, transaction hash, receipt, provider credit or reconciliation is recorded.

This publication aligns metadata. It records no new issuance, conversion, deposit or reconciliation. The Stripe destination is on Base; the Numina constructor mint uses chain `962421430`. A broadcast requires its own exact journal transfer request and amount, authorized source signer, source balances, canonical token identity, replay protection and resulting receipts.
