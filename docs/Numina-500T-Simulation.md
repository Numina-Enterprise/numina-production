# Numina 500T simulation

## Historical simulation scope

The simulation retains the September 16, 2026 **500T, six-decimal review model**. The confirmed token has separate Numina chain evidence: **1,500T NUSD at 18 decimals**, constructor mint block `51725`, chain `962421430`, receipt `0x1`, transaction `0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b`, contract `0x491c1DF1b5CA77AF797f052c2310ca17039C931b`. The settlement-contract deployment is a separate transaction at block `51726`.

The [mint receipt](/downloads/nusd/mint-receipt.json) and [current minting guide](/downloads/NUSD-Minting-v4.md) identify that September 18, 2026 observation. The Numina Native Treasury journal remains the software source of truth. Simulation quantities and local-test results retain their original scope and do not replace the confirmed mint or current balances.

Open **https://numinalabs.xyz/treasury-simulation**. The descriptor is `GET /api/nusd/v1/simulation`; it also passes through the existing Numina gateway. This is a browser-only allocation model. Reload or reset to start again.

The starting amount is **500,000,000,000,000 NUSD**, represented exactly as `500000000000000000000` base units with six decimals. It begins in the simulated native bucket. The simulated Stripe and bank buckets begin at zero. All three together always total 500T; the amount is counted once.

The assumed rate is **1 NUSD = 1 USDC = 1 USD**. A transfer subtracts an amount from one simulated bucket and adds the same amount to another. Bank allocations require whole cents. No rounding, overdraft or duplicate allocation is allowed. Exact retries reuse their full event; changing an event under the same ID is rejected.

The example allocates 250T to simulated Stripe and 250T to the simulated bank, leaving zero in the simulated native bucket. Reset restores the original browser state. Export produces a file explicitly marked as simulation, with no production receipt or provider-balance evidence.

## Contract review

The owner-approved review `nusd-owner-approved-uncapped-500t-2026-09-16` is published at `/api/nusd/v1/approved-review`. The reviewed contract has no configurable supply cap; its arithmetic remains bounded by `uint256`. Its positive constructor amount mints 500T to one recipient before pausing. Nine local EVM tests cover the reviewed implementation, including the exact 500T issuance case. These local contracts use ephemeral test accounts.

The browser simulation models allocation of that fixed starting amount. It does not deploy or run the contract, mint additional supply, authenticate to a provider, or change the production native journal. Production supply, contract addresses, reserves, Stripe USDC, bank USD and settlement receipts retain their own evidence requirements.

## Production preparation

Follow [the owner-signing sequence](Numina-500T-Deployment-Sequence.md). The existing capped v2 deployment adapter is retained. The standalone uncapped v3 review has a different constructor and must use matching tooling before production encoding.
