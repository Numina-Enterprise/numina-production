# Vengeance source reconciliation

The owner-supplied `NuminaTreasuryReserve.sol` and `NuminaRevenueSplitter.sol` bytes are already the files at `numina-smart-contracts/contracts/`. SHA-256 `2f1c5551b51042882bf445d96a61e5a4d38fbe491fc358b1c676a488871192ff` (4138 bytes) and `685d081ff1b4485a112eeb926f4e0edff71b419879b655d8b7ceb31a8d22f000` (2122 bytes). Those paths stay the reference originals. A second copy of the same bytes was not added.

`provenance.json` records that match. It does not reconstruct the intake file's original machine, path, or mtime, because that provenance file was not in this workspace. The checkout timestamp on these files is not that mtime. These local files are not proof of a deployment, of bytecode, or of external backing. The statement that a narrow Mac directory inspection found no separate public source, ABI, or bytecode filename is recorded as a scoped observation, not as proof of absence.

## Variants left intact

| Identity | Decimals | Base units for the 1.5-quadrillion whole-unit figure | Hash |
| --- | --- | --- | --- |
| Vengeance `NuminaTreasuryReserve` | 6 | `1500000000000000000000` | `2f1c5551…` |
| Receipt-bound `NuminaUSD` (`docs/contracts/NuminaUSD.sol`, also `runtime/nusd/history/18d/contracts/NuminaUSD.sol`) | 18 | `1500000000000000000000000000000000` | `08fdd4e8…`, equal to `deployment-receipt.json` `sourceSha256` |
| Current runtime candidate `runtime/nusd/history/6d/contracts/NuminaUSD.sol` | 6 | Cap is a constructor argument, not the vengeance constant | `c2aa2975…` |

The 6-decimal cap times `10^12` is numerically the 18-decimal receipt base-unit figure. That arithmetic is not applied, and it is not source or bytecode equivalence. The receipt's `externallyBackedClaim` is false. The runtime candidate is a different file from both the receipt-bound source and the vengeance treasury.

The other runtime modules are unchanged, including the 6-decimal conversion and redemption candidates, the 18-decimal copies under `docs/contracts/` and `runtime/nusd/history/18d/`, `NuminaBaseBridgeEscrow` (expects 18-decimal NUSD), and `NuminaBaseUSDCVault`. Settlement source `dddf5300…` is shared by the runtime, docs, and 18-decimal history copies.

`selectedRuntimeVariant` is `null`. No issuer policy, contract record, or deployment script is switched. Proposed hardening lives only under `runtime/nusd/proposals/vengeance-treasury-splitter/` and is not wired to financial execution.

Repository prose that describes the vengeance treasury as an EIP-712 multi-sig, or as verified because a source string matched, is not what the reference source does. The reference `executeSettlement` checks that `proofHash` is nonzero. It does not recover a signature. That mismatch is left in the historical documents and is not treated as authorization.

The leads below are from reading the reference source. They are not executed test findings.

- The treasury notice says it is a 1:1 rail. The contract has no external balance check.
- `guardian` is stored and never read.
- Nonzero `proofHash` is the settlement authorization check.
- `executeSettlement` always emits `Transfer(owner, recipient, amount)`, including when `balanceOf[address(this)]` was the account debited.
- `transferFrom` does not reject a zero recipient.
- The splitter's `receive` calls `distributeRevenue`, which forwards with `transfer`. Shares are 70/20/10, and the remainder of the integer division is assigned to protocol.

Static checks for this reconciliation are in `tests/vengeance-source-reconciliation.test.mjs`. They were written and not run.
