# NuminaBaseUSDCVault: separate Safe on Base

**Status:** plan only. `NuminaBaseUSDCVault` is **not deployed**. Nothing here has been executed. The
owner signs every transaction.

## Scope

| Item | Value |
| --- | --- |
| Chain | Base, chain ID `8453` |
| Contract | `runtime/nusd/contracts/NuminaBaseUSDCVault.sol` (artifact `runtime/nusd/artifacts/NuminaBaseUSDCVault.json`) |
| USDC | Native Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals), a constant in the contract |
| Release recipient | `0x736BD8F274DCE00a8bB374EDd85DF0d2e631018e`, a constant in the contract (`STRIPE_TREASURY`) |
| Roles | `DEFAULT_ADMIN_ROLE` (AccessControlDefaultAdminRules), `RELEASER_ROLE`, `PAUSER_ROLE` |

## How the vault behaves

- The constructor reverts unless `block.chainid == 8453` and Base USDC reports 6 decimals.
- It **starts paused**. Only `DEFAULT_ADMIN_ROLE` can `unpause()`. `PAUSER_ROLE` can `pause()`.
- **There is no withdraw path.** The only function that moves USDC is
  `release(operationId, sourceTxHash, usdcAmount)`. It is RELEASER-only and only works while
  unpaused. It transfers to the fixed treasury address and nowhere else, and it checks that the
  treasury's balance went up by exactly the amount. Replaying an `operationId` with different values
  reverts.
- USDC sent to the vault can only leave through `release` to that treasury. Never fund the vault
  with more than the amount intended for the treasury.
- It never mints USDC. It does not bridge anything itself.

## Warnings

1. This Safe is **separate from the Numina-chain Safe** in `nusd-admin-safe-handoff.md`. A Base Safe
   has no authority over the NUSD token on chain 962421430, and the reverse is also true.
2. Keep the vault paused until the source and bytecode are verified, the roles are read back, and the
   release path is reviewed.
3. Never renounce `DEFAULT_ADMIN_ROLE` on the vault. Without it, the vault can never be unpaused.
4. The owner signs every step. No secrets, RPC URLs, or keys go in this repository. The verify script
   reads `BASE_RPC_URL` and the optional `BASE_RPC_AUTHORIZATION` from the environment.

## Steps

1. **Check the Safe contracts on Base (read-only).**
   `BASE_RPC_URL=… node runtime/nusd/scripts/verify-safe-factory.mjs --chain base`
   The canonical Safe v1.4.1 contracts are expected to be present on Base already.
2. **Deploy a 3-of-6 Safe on Base.** Use distinct owners and threshold 3. Then run:
   `BASE_RPC_URL=… node runtime/nusd/scripts/verify-safe-factory.mjs --chain base --safe <BASE_SAFE> --threshold 3 --owners 6`.
   Record the result in `runtime/nusd/records/safe-base.<date>.json`.
3. **Deploy the vault (owner signs).** Constructor `(admin, releaser, pauser, adminDelaySeconds)`:
   - `admin` = the Base Safe, or a timelock owned by the Base Safe, the same way as the Numina handoff
   - `releaser` = a dedicated address, different from the admin and the pauser
   - `pauser` = a dedicated, fast-response address
   - `adminDelaySeconds` = `86400` or more
4. **Verify before unpausing.**
   - The deployed runtime bytecode matches the `deployedBytecode` in the artifact, after accounting
     for immutables.
   - `paused()` is true, and `hasRole` reads back correctly for the admin, releaser, and pauser.
   - `usdc()` is `0x8335…2913` and `STRIPE_TREASURY()` is `0x736B…018e`.
   - Record all of this under `vault` in the Base record.
5. **Unpause.** Only after the owner reviews step 4, the Base Safe (or its timelock) calls
   `unpause()`. Record `unpausedAt`.
6. **Monitor.** Watch for `Released`, `Paused`, `Unpaused`, `RoleGranted`, `RoleRevoked`, and
   `DefaultAdminTransferScheduled` on the vault, and `AddedOwner`, `RemovedOwner`, and
   `ChangedThreshold` on the Base Safe.

## Cancel and rollback

- Before deployment, there is nothing to undo.
- After deployment and while paused, no funds can move. If the configuration is wrong, leave it
  paused, don't fund it, and deploy a corrected vault.
- If anything looks wrong once it is live, PAUSER calls `pause()` right away. Resuming needs the
  admin.
- For admin changes, use `beginDefaultAdminTransfer`, then `cancelDefaultAdminTransfer` within the
  delay if needed.
