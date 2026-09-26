# NUSD contract source and settlement

The application publishes the compiled contract records at `/api/nusd/v1/contracts`, including exact source and artifact hashes. Numina's retained September 18, 2026 receipts record the `NuminaUSD` constructor mint at block `51725` and the separate `NuminaSettlement` deployment at block `51726`. Conversion and redemption retain their own deployment and execution status.

## Confirmed constructor mint

| Field | Retained Numina receipt |
| --- | --- |
| Mint/deployment block | `51725` |
| Transaction | `0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b` |
| NUSD contract | `0x491c1DF1b5CA77AF797f052c2310ca17039C931b` |
| Chain ID | `962421430` |
| Receipt status | `0x1` |
| Constructor issuance | `1,500,000,000,000,000.00 NUSD` |
| Decimals | `18` |
| Base units | `1500000000000000000000000000000000` |

The [mint receipt](/downloads/nusd/mint-receipt.json) and [deployment verification](/downloads/nusd/deployment-verification.json) retain the original evidence. The [settlement-contract deployment receipt](/downloads/nusd/deployment-receipt.json) records transaction `0xe63dec1d443ccb15c87b3fb599bc868ef9b5919b6ef996ddb1c8aade4a6dba9b` at block `51726`. That transaction deployed the settlement contract; completion of a settlement operation requires its own record. Current chain state has not been reverified by this documentation update.

The Numina Native Treasury journal at `/api/control/v1/treasury` remains the software source of truth. The September 25, 2026 revision-142 observation records a separate 500T NUSD projection and a `PREPARED` mint request. Current account references use `/api/control/v2/treasury/accounts`. [Minting metadata and evidence scope](/downloads/NUSD-Minting-v4.md) explain these records together.

## Token

The deployed token record uses 18 decimal places, a configured supply cap, separate administrator, issuer, minter and pauser roles, and an initial pause. Issuance authorizations specify a recipient, amount, expiry and one-use reference. Ordinary ERC20 transfers use existing token balances. Retained six-decimal, uncapped review artifacts describe earlier proposals and local tests; they are historical inputs with their original hashes.

The existing native treasury still contains one 500T NUSD model projection. Publishing or deploying contract code does not change that projection or automatically issue tokens from it. Initial token issuance and the supply cap require explicit deployment inputs.

## Settlement

`NuminaSettlement` binds one token address at construction. A payer grants that contract an allowance and calls `settle(operationId, recipient, amountBaseUnits)`. The contract transfers existing tokens directly to the recipient and records completion only when the recipient receives exactly the requested amount. It holds no settlement balance and cannot mint tokens.

Operation IDs are scoped to the payer. An exact retry returns the original result without another transfer or completion event. Reusing an ID with a different amount or recipient reverts. Failed transfers, missing allowance, insufficient funds, paused token transfers and inexact receipts cannot create a completed settlement record. Reentrant calls are rejected.

A completed contract call concerns NUSD on the configured blockchain. It is not a bank deposit, USD/USDC conversion, reserve attestation or provider receipt. An application must obtain a successful canonical transaction receipt and check the deployed token and settlement identities before reporting an on-chain settlement as confirmed.

## Build and local validation

Development dependencies are isolated from the production runtime and pinned in `runtime/nusd/development/package-lock.json`.

```sh
cd runtime/nusd/development
npm ci --ignore-scripts
npm run compile
cd ../../..
node --test tests/nusd-contracts.test.mjs tests/nusd-contract-record.test.mjs
```

Tests use a local ephemeral blockchain and test-only wallets. They do not broadcast to Numina, mint production tokens or make external deposits. The source has not received an independent security audit.

## Deployment inputs

The token requires four distinct controlled role addresses, a treasury recipient, an explicit initial issuance and cap, administrator delay, reviewed chain identity and issuer policy inputs. The existing deployment validator generates unsigned data from the exact retained token artifact; it never recompiles or submits during validation. The managed adapter retains its journal, nonce, fee, review and receipt checks.

The supplied Stripe address is a provider deposit destination, not evidence of control over Numina role wallets. It must not be substituted for those roles or used to claim that Stripe accepts NUSD on the Numina chain.

The previously attested Linux runtime remains a historical build. This application release publishes updated source; it does not relabel that older container as containing the new settlement contract or runtime fixes.
