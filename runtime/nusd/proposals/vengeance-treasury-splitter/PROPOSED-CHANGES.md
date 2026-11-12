# Proposed changes, separate from the reference sources

The files in `numina-smart-contracts/contracts/` are unchanged reference evidence. Their hashes are in `runtime/nusd/reference/vengeance-local-source-intake/provenance.json`. The Solidity in this directory is a proposal. It was not compiled, deployed, bytecode-compared, or connected to a deployer, settlement caller, or revenue caller.

`NuminaTreasuryReserve.proposed.patch` and `NuminaRevenueSplitter.proposed.patch` are review diffs against those reference files. Diff headers use workspace timestamps, not an original-machine mtime.

## What the proposal keeps

- Treasury decimals stay 6.
- `MAX_SUPPLY` stays `1_500_000_000_000_000 * 10**6`.
- The constructor still assigns that cap to the deployer. That retained mint is not a reserve attestation.
- `CLUSTER_STATE_ROOT` stays a constant label. The proposal does not read cluster state and does not treat the constant as deployment identity.
- Splitter weights stay 7000 / 2000 / 1000 basis points.
- Integer division dust still goes to the protocol share, and the three shares are required to sum to the distributed amount.

## Treasury

| Source-review lead | Proposal |
| --- | --- |
| Notice calls the contract a 1:1 rail without external verification | `externalBackingVerified` is a constant `false`. The notice states that the contract does not verify cash, USDC, or bank balances. |
| `guardian` is stored and unused | Guardian must be a nonzero address distinct from the deployer. Guardian signs execution enablement and settlement, and may cancel a preparation or disable execution. Guardian cannot move balances alone. |
| Nonzero `proofHash` is treated as sufficient in `executeSettlement` | `prepareSettlement` stores the hash and does not move balances. `executeSettlement` no longer accepts a proof hash as its authorization. It requires a stored preparation, an unexpired deadline, owner submission, and EIP-712 signatures from both owner and guardian over chain id, this contract, the prepared fields, and the debit account. The execution flag starts false. Enabling it is a separate guardian-signed action. Cancelled and executed keys are not reused. |
| `Transfer` is emitted from `owner` when the contract balance was debited | The preparation names `debitFrom` as either this contract or the owner. There is no fallback from one balance to the other. The debit and the `Transfer` event use that account. `totalSupply` must be unchanged. |
| `transferFrom` has no zero-recipient check | `transferFrom` rejects `to == address(0)` and `from == address(0)`. |

On-chain signatures are secp256k1 with a low-`s` check. They are not a check of the off-chain Ed25519 guardian keypin, and this proposal does not claim that check.

## Splitter

| Source-review lead | Proposal |
| --- | --- |
| `receive` and `distributeRevenue` forward native value immediately with `transfer` | `receive` only increases `escrowed` and emits `RevenueReceived`. Distribution is a separate distributor-only call, and it starts disabled. That call accounts claim balances and does not send value. A creditor later pulls its own claim. The accounted balance is reduced before the external call. |
| 70/20/10 with remainder to protocol | Unchanged arithmetic. Constructor requires the basis points to sum to 10,000. `executeDistribution` requires the shares to sum to the amount. |

`address(this).balance` can exceed `escrowed + totalClaimable` if value arrives outside `receive`. The proposal does not sweep that surplus.

## Explicitly not selected

This proposal is not a runtime configuration choice. `selectedRuntimeVariant` in the variant record is `null`. The six modules under `runtime/nusd/contracts/`, the 18-decimal copies under `runtime/nusd/history/18d/` and `docs/contracts/`, the deployment receipt, and the issuer policies are not rewritten here.
