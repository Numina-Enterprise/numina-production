# Owner-approved NUSD review — one shared500T

The owner approved an uncapped supply policy and an initial supply of **500,000,000,000,000 NUSD**. The native treasury, Stripe and Bank of America references point to that **same canonical value, counted once**. They create no additional allocations or provider balances. This replaces the prior1500T review quantity.

## Software behavior

The contract has no configurable supply cap. It uses finite uint256 accounting with six decimals:500T NUSD is500,000,000,000,000,000,000 base units. “Uncapped” does not mean an infinite numeric balance. A configured constructor issues to one specified recipient and then pauses. Role separation, delayed administration, one-use issuance references, expiry and numeric headroom protection remain.

Nine local tests passed, including the exact500T constructor mint-before-pause sequence, one recipient balance equal to total supply, and zero balances at every other test account. The1500T case remains a software regression test only. These in-memory test transactions are not production issuance.

## Approval and evidence

Owner review approval is recorded. Source/artifact reproduction and local tests are verified. Independent audit, external reserves, provider acceptance and production contract deployment are not established by this review. Provider records retain their own reported units and balances.

The constructor sheet still has a null native treasury recipient and null transaction data. The four previously supplied addresses are administrator, issuer, minter and pauser role assignments; no recipient is silently selected from them. Production transaction, chain identity, fee and remaining review inputs must be completed separately.

No transaction was signed or broadcast, no production mint or deposit occurred, and no native journal was changed. The package contains no production private keys or credentials.

## Reproducibility and integration

The sources, artifact, pinned development dependencies, local test runner/report and SHA256SUMS are included. The existing capped production adapter cannot accept this eight-argument constructor without an explicit versioned integration update. See SECURITY-AND-INTEGRATION.md and DEVELOPMENT.md. Historical review archives remain unchanged.
