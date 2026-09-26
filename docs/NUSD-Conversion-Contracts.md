# NUSD 1:1 conversion contracts

## Release scope

The software includes two compiled, **undeployed contract candidates**: `NuminaUSDCConversion` and `NuminaUSDRedemption`. They implement fixed 1:1 whole-unit arithmetic for existing 18-decimal NUSD, with explicit scaling to six-decimal USDC or two-decimal USD cents. Numina's retained token and settlement-contract deployments have their own receipts, identified below. Publishing these conversion candidates does not establish a conversion deployment, exchange, bridge, provider payment, reserve funding or financial approval. Custom contracts have not received an independent security audit.

Read the versioned software record at `/api/nusd/v1/conversion-workflow`; source and ABI/bytecode hashes are in `/api/nusd/v1/contracts`. The application status and release manifest carry the same records. All live financial-execution flags remain false until independently evidenced activation.

## NUSD ↔ USDC: fixed-price token inventory

`NuminaUSDCConversion` atomically exchanges existing 18-decimal NUSD and six-decimal USDC at **one whole NUSD for one whole USDC**, with zero contract fee. Both tokens must exist on the **same chain**. One USDC base unit corresponds to `1000000000000` NUSD base units. NUSD-to-USDC inputs must be exactly divisible by that scale; no rounding occurs. Constructor addresses are immutable. Checking decimals and deployed code does not establish issuer identity: verify the exact NUSD deployment and the canonical Circle-issued USDC contract separately.

Numina's September 18, 2026 [mint receipt](/downloads/nusd/mint-receipt.json) identifies the confirmed 18-decimal constructor issuance: `1,500,000,000,000,000.00 NUSD`, block `51725`, transaction `0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b`, contract `0x491c1DF1b5CA77AF797f052c2310ca17039C931b`, chain `962421430`, receipt `0x1`. The separate settlement-contract deployment occurred at block `51726`. These records establish their own operations; conversion and external deposits require separate execution evidence. The Numina Native Treasury journal remains the software source of truth.

The output token must already be present in the vault. A native journal valuation, a declared 1:1 rate or a token symbol cannot satisfy the liquidity check. Both input and output sender/recipient balance deltas must equal the requested amount, or all effects revert. Fee-on-transfer and inexact token behavior are rejected. Reentrant movement is blocked. The contract cannot mint either asset.

Calls:

- `quote(nusdToUsdc, inputAmount)` returns the output amount in the output token's base units. `true` divides NUSD input by `1000000000000`; `false` multiplies USDC input by that scale. Zero, inexact or overflowing amounts revert. This arithmetic read reserves no liquidity and is not a binding live quote.
- `convert(operationId, nusdToUsdc, inputAmount, recipient)` exchanges both tokens atomically using the quoted scale. `true` selects NUSD → USDC; `false` selects USDC → NUSD. Caller eligibility and token allowance are required. The recipient is explicit; no Stripe address is inferred.
- `addLiquidity(isUsdc, amount)` deposits existing inventory from an authorized liquidity manager. Only the exact received amount is accepted.
- `removeLiquidity(isUsdc, amount, recipient)` lets the liquidity manager withdraw inventory **only while conversion is paused**. Such withdrawals reduce available redemption capacity. The vault does not guarantee backing for NUSD held outside it or maintain asynchronous withdrawal promises.

An exact repeat of a caller's operation ID returns the original conversion without another transfer. Changing the direction, recipient or amount under that ID reverts. IDs are scoped to the initiating wallet; successful events are emitted once.

The contract starts paused. A delayed-transfer administrator manages roles and unpauses; a distinct pauser stops conversion; a distinct liquidity manager supplies/removes inventory. A `PARTICIPANT_ROLE` allowlist gates conversions. Address separation does not prove independent human custody. No keys, provider credentials or addresses from an existing wallet assignment are automatically granted roles by compiling or publishing this source.

### Stripe destination

An eventual USDC deposit must use an asset and network supported by that Stripe destination. Observed Stripe instructions specify USDC on Base. A NUSD token on Numina chain 962421430 cannot be sent to that USDC destination as if it were USDC. These contracts contain no cross-chain bridge, and this release does not establish canonical USDC availability on the Numina chain. Any chain migration or verified bridging integration is a separate workstream.

## NUSD → USD: escrow and bank outcome tracking

`NuminaUSDRedemption` locks existing NUSD against a USD payment obligation at **1 NUSD = 1 USD gross**. USD is paid through a separate, funded bank/payment provider integration. The contract neither creates dollars nor sends a bank transfer.

18-decimal NUSD must convert exactly to two-decimal USD cents: **10,000,000,000,000,000 NUSD base units = 1 USD cent**. Zero and sub-cent requests revert; there is no rounding or haircut. Solidity integer arithmetic retains exact values beyond JavaScript's safe-number range. Clients must use decimal strings and big integers, never floating-point money calculations. For example, 500T NUSD is `500000000000000000000000000000000` NUSD base units and `50000000000000000` USD cents; this arithmetic establishes no funding.

| State | Allowed next step | Token treatment |
|---|---|---|
| Requested | Holder cancels, or operator begins the bank attempt | NUSD remains locked |
| Processing | Distinct confirmer attests a final paid or failed outcome | NUSD remains locked; no timeout refund |
| PaidAttested | Terminal; matching retries are harmless | Exact locked NUSD is burned |
| Refundable | Original holder claims the refund | NUSD remains locked until successfully returned |
| Refunded / Cancelled | Terminal | Exact NUSD returned once |

`requestRedemption` binds the caller's operation ID, amount and a salted destination commitment. Use a cryptographically random salt and a canonical commitment envelope containing the chain, escrow address, holder, intended legal entity, currency and private bank destination. Keep bank numbers, personal information, evidence documents and credentials off-chain. The payment operator must resolve and validate the commitment against the private instructions before a bank submission; the contract cannot validate those instructions.

`beginPayment` locks a unique payment reference and the initiating operator address before the separate provider submission. That reference must become the provider adapter's durable idempotency identity. The recorded initiating address cannot confirm that payment later, even if governance rotates its role to confirmer. It is an attempt record, not evidence that a provider accepted or completed a payment. No bank adapter is connected by this release.

`attestBankOutcome` requires a different privileged role from the operator, the exact request, payment reference, gross USD cents and a unique nonzero evidence hash. A paid attestation burns the locked NUSD; both vault balance and total token supply must decrease exactly. A failed attestation allows refund. Repeated references, altered retries, contradictory final outcomes and reuse of one evidence hash across requests revert. Escrow tokens have no administrator withdrawal path.

**Attestation trust boundary:** the chain checks the confirmer's authority and field consistency; it cannot authenticate a bank statement, USD reserve balance or bank signature. A privileged false attestation could wrongly burn a holder's tokens or release them after a bank payment. The off-chain service must independently verify the provider's final status, exact beneficiary and gross amount. Require final bank settlement, not submission acceptance, a pending state or an owner declaration. A later return after paid attestation requires a separately reconciled remedy; this candidate does not reverse burns or manufacture provider credit.

## Security and operational controls

- Both contracts are non-upgradeable candidates with immutable token addresses, explicit allowlists, OpenZeppelin safe token calls, reentrancy protection and emergency pause controls.
- USD administration, payment operation, confirmation and pausing require distinct privileged addresses. Administrative transfers use OpenZeppelin's delayed two-step mechanism; the deployment delay is an explicit reviewed parameter. Protect all privileged keys with independently reviewed custody.
- Revoking holder eligibility or pausing the escrow does not itself revoke a cancellable or refundable claim. If the underlying NUSD token is paused or frozen, attempted return/burn reverts without consuming the claim or evidence.
- A processing claim cannot be cancelled merely because time elapsed. The operator must reconcile uncertain provider outcomes before a confirmer enables refund; otherwise a delayed bank payment and token refund could both succeed.
- Escrowed tokens cannot simultaneously fund USDC conversion. Contracts neither add to nor replace the single canonical journal projection at `/api/control/v1/treasury`. Ledger reconciliation must record actual confirmed on-chain movements without counting token, inventory and journal views as separate funds.
- Existing provider read credentials retain their scopes. Future bank submission requires a separate server-held, narrowly scoped credential, authenticated owner authority, durable provider idempotency, replay-safe signed webhook verification, amount/beneficiary checks and reconciliation of uncertain attempts before retry.
- Monitor pause changes, role changes, inventory balances, pending USD obligations, aging processing requests and paid/refund attestations. Reconcile finalized chain events against the provider ledger; reorgs and delayed or returned bank payments need explicit handling.

## Verification and activation

Tests execute locally with synthetic accounts, a test reserve token and an in-process EVM. They verify reproducible source/artifact hashes; exact and insufficient-liquidity exchange; fee-bearing-token rejection and rollback; reentrancy; access and pause boundaries; idempotency; cents precision; bank-claim cancellation, confirmation, burn and refund; evidence/reference reuse prevention; and inability to spend the same tokens through both contracts. Test activity is not live funding, minting or a provider payment.

Before activation, independently review the custom contracts, identify and verify both deployed token contracts and their chain, configure reviewed roles/delays and custody, verify source/bytecode and receipts, fund actual output liquidity, implement and test the bank adapter and attestation service, verify destination ownership/asset acceptance, resolve issuer and holder terms, and publish actual addresses and deployment evidence. Keep conversion and external-deposit flags disabled until those facts are established. Publication of this software alone does not satisfy them.

References: [OpenZeppelin token safety utilities](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20), [OpenZeppelin access control](https://docs.openzeppelin.com/contracts/5.x/api/access), [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), [Stripe funding requirements](https://docs.stripe.com/treasury/add-funds).
