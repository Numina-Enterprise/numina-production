# NUSD 1:1 conversion contracts

## Release scope

This document describes the `NuminaUSDCConversion` and `NuminaUSDRedemption` contract candidates. They implement fixed 1:1 whole-unit arithmetic for existing NUSD tokens. The current contract sources require 6-decimal NUSD and 6-decimal USDC. This documentation update changes neither token supply nor issuer/minter separation. Publishing these sources or this document does not establish contract deployment, token issuance, a bridge, provider payment, reserve funding or financial approval. An independent security audit is not established by this source review.

Read the versioned software record at `/api/nusd/v1/conversion-workflow`; source and ABI/bytecode hashes are in `/api/nusd/v1/contracts`. The application status and release manifest carry the same records. All live financial-execution flags remain false until independently evidenced activation.

## Source-review evidence — 2026-09-19

Reviewed source commit: `0c6a1061953b6e813bcb3a2e29cc1976a6abf222` in `skott34-dot/numina-production`. The Git blob identifiers below identify the source bytes reviewed, not deployed bytecode or signed transaction receipts.

- `runtime/nusd/contracts/NuminaUSDCConversion.sol`: `6ae00e2f212e7afd721f81daf8ba38bd020f604b`.
- `runtime/nusd/contracts/NuminaUSDRedemption.sol`: `7adb0e715244ddee21de14fb5fc853792bad1cc3`.
- `runtime/nusd/deployment-receipt.json`: `81307af071cfec391f1694696dd2371d991906e5`. This historical record describes the NUSD token and `NuminaSettlement`; it does not contain separate deployment receipts for the conversion and redemption contracts. It records `externallyBackedClaim: false` and no bank or provider settlement receipt.

No live RPC state, conversion-vault inventory, bank reserve balance, bridge, signing authority or payment-provider execution was independently verified in this source review. No contract test suite was executed by this documentation update; only documentation arithmetic was checked. No contract, mint, burn, conversion, redemption, bank deposit or Stripe deposit was executed. Deployment and funding must be established from their own evidence before activating a financial operation.

## NUSD ↔ USDC: fixed-price token inventory

`NuminaUSDCConversion` atomically exchanges existing tokens at **1 whole NUSD = 1 whole USDC**, with zero contract fee. NUSD and USDC must both have **6 decimals** and exist on the **same chain**. One USDC base unit corresponds to one NUSD base unit. Constructor addresses are immutable. Checking decimals and deployed code does not establish issuer identity: verify the exact NUSD deployment and the canonical Circle-issued USDC contract separately.

The output token must already be present in the vault. A native journal valuation, a declared 1:1 rate or a token symbol cannot satisfy the liquidity check. Both input and output sender/recipient balance deltas must equal the requested amount, or all effects revert. Fee-on-transfer and inexact token behavior are rejected. Reentrant movement is blocked. The contract cannot mint either asset.

Calls:

- `quote(nusdToUsdc, inputAmount)` returns output-token base units. NUSD -> USDC and USDC -> NUSD preserve the exact base-unit amount because both tokens use six decimals. Zero input is rejected. This arithmetic read reserves no liquidity and is not a binding live quote.
- `convert(operationId, nusdToUsdc, inputAmount, recipient)` exchanges both tokens atomically; `inputAmount` uses the input token's base units. `true` selects NUSD → USDC; `false` selects USDC → NUSD. Caller eligibility and token allowance are required. The recipient is explicit; no Stripe address is inferred.
- `addLiquidity(isUsdc, amount)` deposits existing inventory from an authorized liquidity manager. Only the exact received amount is accepted.
- `removeLiquidity(isUsdc, amount, recipient)` lets the liquidity manager withdraw inventory **only while conversion is paused**. Such withdrawals reduce available redemption capacity. The vault does not guarantee backing for NUSD held outside it or maintain asynchronous withdrawal promises.

An exact repeat of a caller's operation ID returns the original conversion without another transfer. Changing the direction, recipient or amount under that ID reverts. IDs are scoped to the initiating wallet; successful events are emitted once.

The contract starts paused. A delayed-transfer administrator manages roles and unpauses; a distinct pauser stops conversion; a distinct liquidity manager supplies/removes inventory. A `PARTICIPANT_ROLE` allowlist gates conversions. Address separation does not prove independent human custody. No keys, provider credentials or addresses from an existing wallet assignment are automatically granted roles by compiling or publishing this source.

### Stripe destination

An eventual USDC deposit must use an asset and network supported by that Stripe destination. Retrieve the financial account's active receiving routes from Stripe and bind the exact asset, network and address; this document does not select a network or authorize a transfer. A NUSD token on Numina chain 962421430 cannot be sent to that USDC destination as if it were USDC. These contracts contain no cross-chain bridge, and this release does not establish canonical USDC availability on the Numina chain. Any chain migration or verified bridging integration is a separate workstream.

## NUSD → USD: escrow and bank outcome tracking

`NuminaUSDRedemption` locks existing NUSD against a USD payment obligation at **1 NUSD = 1 USD gross**. USD is paid through a separate, funded bank/payment provider integration. The contract neither creates dollars nor sends a bank transfer.

Six-decimal NUSD converts exactly to two-decimal USD cents: **10000 NUSD base units = 1 USD cent**. `quoteUsdCents(amountNusd)` rejects zero and sub-cent requests; there is no rounding or haircut. Solidity integer arithmetic retains exact values beyond JavaScript's safe-number range. Clients must use decimal strings and big integers, never floating-point money calculations. For example, 500T NUSD is `500000000000000000000` NUSD base units. At the configured 1:1 whole-unit rates, its arithmetic equivalents are `500000000000000000000` USDC base units or `50000000000000000` USD cents. These are unit-conversion examples, not a funding observation, executable payment instruction or transfer receipt.

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
