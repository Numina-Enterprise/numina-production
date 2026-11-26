# NUSD admin lockdown: Safe and timelock handoff

**Status:** plan only. Nothing in this runbook has been executed. The owner signs every
transaction in it. Tooling in this repository only reads.

## Scope

| Item | Value |
| --- | --- |
| Token | NuminaUSD (NUSD) `0x491c1DF1b5CA77AF797f052c2310ca17039C931b` |
| Chain | Numina blockchain, chain ID `962421430` (`0x395d62b6`) |
| Decimals | 18. Supply equals cap at `1500000000000000000000000000000000` base units (1.5e15 NUSD) |
| Access control | OpenZeppelin `AccessControlDefaultAdminRules`, default-admin transfer delay 86400 s (1 day). The token is not upgradeable. |
| Recorded default admin | `0xa7e9FB02495700ccE0d209392C0A30FbE077498e` |
| Recorded ISSUER | `0xdfEb99a8CbB9d2536EB9CA3D4D38DC5f4D1dE1a0` |
| Recorded MINTER | `0x62dC06f05aF1b9aBA65d7ee4DBaB067249FC5DA6` |
| Recorded PAUSER | `0x434AB24E613055Fd2598Fd9f0558A06a94D39c81` |
| Sources | `runtime/nusd/deployment.production.json`, `runtime/nusd/deployment-receipt.json`, `runtime/nusd/mint-receipt.json` |

These role holders are the values recorded at deployment (2026-09-18). They are not live reads.
Step 0 confirms them.

## Why

The default admin can grant ISSUER, MINTER, or PAUSER to any other address instantly. The token's
`PrivilegedRoleConflict` check only stops one address from holding two privileged roles; it does not
slow down a grant. Minting is currently blocked only because supply equals cap. A burn would reopen
headroom. The end state of this runbook:

- ISSUER and MINTER are revoked. Nobody can mint.
- PAUSER stays in place so the token can still be paused in an emergency.
- The default admin is a `TimelockController` with a ~48 h delay. A 3-of-6 Safe on the Numina chain
  proposes and executes through it, and the owner can cancel any queued operation.

## Warnings

1. **Never renounce admin.** Do not call `renounceRole(DEFAULT_ADMIN_ROLE, …)` or
   `beginDefaultAdminTransfer(0x0000…0000)`. The token is not upgradeable. Without an admin, no role
   can ever be granted or revoked again and the token can never be unpaused.
2. **The token's Safe must be on the Numina chain (962421430), not Base.** A Safe address on Base
   controls nothing on the Numina chain, even if the same address exists on both. The Base vault
   Safe is a separate Safe covered in `nusd-base-vault-safe.md`.
3. **The owner signs every step.** No agent, CI job, or script in this repository signs, holds keys,
   or broadcasts any step here. `verify-admin-handoff.mjs` and `verify-safe-factory.mjs` only read.
4. Revoke ISSUER and MINTER **while the owner key is still the sole admin**. After the handoff, each
   role change takes the timelock delay.
5. After the handoff, `unpause()` and every role change take at least 48 h. `pause()` stays immediate
   through PAUSER. If the token is paused today, decide whether it should be unpaused before the
   handoff.
6. Do not move the PAUSER key into the Safe or timelock. An address that holds DEFAULT_ADMIN cannot
   also hold PAUSER (`PrivilegedRoleConflict`), and the pause path should stay fast.
7. Never commit RPC URLs, RPC credentials, authorization headers, or keys. The verify scripts read
   the RPC from `NUMINA_RPC_URL` and the optional header from `NUMINA_RPC_AUTHORIZATION`.
8. The Numina chain's pinned RPC environment was returning HTTP 404 / `-32001` ("No Kaleido
   environment is available") as of 2026-11-10. Every step needs a working RPC first.

## Step 0: Confirm live state (read-only)

```sh
cd runtime/nusd
NUMINA_RPC_URL=… NUMINA_RPC_AUTHORIZATION=… node scripts/verify-admin-handoff.mjs
NUMINA_RPC_URL=… NUMINA_RPC_AUTHORIZATION=… node scripts/verify-safe-factory.mjs --chain numina
```

- Exit 0 means the live state matches the recorded baseline. Exit 1 means it does not match; stop and
  investigate. Exit 2 (`rpc_unavailable`) means the RPC could not be reached; fix that first.
- Confirm there is no pending admin transfer (`pendingDefaultAdmin` is the zero address) and note
  `paused`.
- Read `authorizedSupply()` on the token. It should be `0`, meaning no outstanding issuance
  authorization.
- Fill in `before` in a copy of `runtime/nusd/records/admin-handoff.template.json`.

## Step 1: Revoke ISSUER and MINTER, keep PAUSER (owner signs as sole admin)

From the current admin `0xa7e9…498e`, on chain 962421430:

1. `revokeRole(ISSUER_ROLE, 0xdfEb99a8CbB9d2536EB9CA3D4D38DC5f4D1dE1a0)`
   (`ISSUER_ROLE = keccak256("ISSUER_ROLE")`)
2. `revokeRole(MINTER_ROLE, 0x62dC06f05aF1b9aBA65d7ee4DBaB067249FC5DA6)`
   (`MINTER_ROLE = keccak256("MINTER_ROLE")`)
3. Do **not** revoke `PAUSER_ROLE` from `0x434AB24E613055Fd2598Fd9f0558A06a94D39c81`.

Check: a `RoleRevoked` event for each, and `hasRole` is false for both. Record the transaction hashes
under `steps.revokeIssuer` and `steps.revokeMinter`.

## Step 2: Verify or deploy the canonical Safe contracts on the Numina chain

```sh
NUMINA_RPC_URL=… node scripts/verify-safe-factory.mjs --chain numina
```

This checks for code at the Safe singleton factory `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7` and
the Safe v1.4.1 SafeL2 singleton, SafeProxyFactory, CompatibilityFallbackHandler, and
MultiSendCallOnly. Re-confirm those addresses against `safe-global/safe-deployments` before
signing anything.

If any are missing:

1. The singleton factory needs a deployment transaction that is pre-signed for this chain ID. It is
   requested from Safe through `safe-global/safe-singleton-factory`. Without it, the canonical
   addresses cannot be reproduced on this chain.
2. Once the factory exists, the owner deploys the Safe v1.4.1 contracts through it using the
   official `safe-smart-account` deployment, which produces the canonical addresses.
3. Re-run the check until it exits 0. Record the results in `safe-numina.<date>.json` under
   `factoryCheck`.

Do not deploy Safe contracts at non-canonical addresses without reviewing that choice first. The Safe
UI and tooling will not recognize them.

## Step 3: Deploy a 3-of-6 Safe on the Numina chain

- Six distinct owner addresses. Each key should be held by a different person or device. Record who
  holds each one in `ownerCustodyNotes`, without any secret material.
- Threshold 3. Fallback handler is CompatibilityFallbackHandler.
- Deploy through SafeProxyFactory `createProxyWithNonce` with the SafeL2 singleton.
- None of the six owners should be the current admin key, the PAUSER, or a former ISSUER or MINTER.

Check:

```sh
NUMINA_RPC_URL=… node scripts/verify-safe-factory.mjs --chain numina --safe <SAFE> \
  --threshold 3 --owners 6 --expected-owners <o1,o2,o3,o4,o5,o6>
```

## Step 4: Deploy a TimelockController (~48 h)

OpenZeppelin `TimelockController(minDelay, proposers, executors, admin)`:

| Parameter | Value |
| --- | --- |
| `minDelay` | `172800` (48 h) |
| `proposers` | `[SAFE]`. In OZ v5, proposers also get `CANCELLER_ROLE`. |
| `executors` | `[SAFE]`. Do not use `address(0)`, which lets anyone execute. |
| `admin` | `address(0)` (Option A) or the owner briefly (Option B, below), so the timelock ends up administering itself |

Give the owner `CANCELLER_ROLE` using one of these options:

- **Option A (no bootstrap admin):** deploy with `admin = address(0)`. Then, from the Safe, schedule
  and (after 48 h) execute `grantRole(CANCELLER_ROLE, OWNER)` on the timelock itself.
- **Option B (short bootstrap):** deploy with `admin = OWNER`. The owner calls
  `grantRole(CANCELLER_ROLE, OWNER)`, then `renounceRole(DEFAULT_ADMIN_ROLE, OWNER)` **on the
  timelock**, never on the token. Finish both before Step 5.

Either way, check that `getMinDelay()` is `172800`, that `hasRole(CANCELLER_ROLE, OWNER)` is true,
that the Safe has PROPOSER and EXECUTOR, and that only the timelock itself holds
`DEFAULT_ADMIN_ROLE` on the timelock.

Record the timelock under `steps.timelock`.

## Step 5: Start the default-admin transfer to the timelock

From the current admin `0xa7e9…498e`:

1. `beginDefaultAdminTransfer(TIMELOCK)`
2. Check that `pendingDefaultAdmin()` returns `(TIMELOCK, schedule)`, where `schedule` is about the
   block time plus 86400. A `DefaultAdminTransferScheduled` event confirms it.
3. Right away, from the Safe, schedule a timelock operation:
   `target = NUSD`, `value = 0`, `data = acceptDefaultAdminTransfer()`, `predecessor = 0x0`,
   `salt` = a recorded unique value, `delay = 172800`. Record the operation ID.

## Step 6: Wait, then accept

- The token's 1-day schedule must pass, and so must the timelock's 48 h delay. The 48 h delay is the
  later of the two.
- From the Safe, call `execute` on the timelock with the same parameters. The timelock then calls
  `acceptDefaultAdminTransfer()` on NUSD.
- Check for a `RoleGranted(DEFAULT_ADMIN_ROLE, TIMELOCK, …)` event and a
  `RoleRevoked(DEFAULT_ADMIN_ROLE, 0xa7e9…498e, …)` event.

## Cancel and rollback

| When | How |
| --- | --- |
| Before acceptance, during the 1-day window | Current admin calls `cancelDefaultAdminTransfer()`. Look for a `DefaultAdminTransferCanceled` event. |
| A queued timelock operation | Owner (CANCELLER) or Safe calls `cancel(operationId)` on the timelock. Look for a `Cancelled` event. |
| Wrong Safe or timelock deployed, but not yet admin | Cancel per the rows above, then redeploy. Nothing on the token changed. |
| After acceptance | The only path is a new handoff from the timelock: the Safe schedules `beginDefaultAdminTransfer(NEW_ADMIN)` through the timelock (48 h), then `acceptDefaultAdminTransfer()` from the new admin after the 1-day delay. This is slow by design. |
| Revoked ISSUER or MINTER needed again | After the handoff, the Safe schedules `grantRole` through the timelock (48 h). Before the handoff, the admin can re-grant directly. |

## Post-checks (read-only)

Fill in `expected` in your copy of `admin-handoff.template.json`: set `defaultAdmin` to the
timelock, and add the timelock and Safe as role holders where relevant. Then run:

```sh
NUMINA_RPC_URL=… node scripts/verify-admin-handoff.mjs --expected ../records/admin-handoff.<date>.json
NUMINA_RPC_URL=… node scripts/verify-safe-factory.mjs --chain numina --safe <SAFE> --threshold 3 --owners 6
```

Both must exit 0. Expected state:

- `defaultAdmin` is the timelock, and `pendingDefaultAdmin` is the zero address.
- `defaultAdminDelay` is `86400`.
- `hasRole(DEFAULT_ADMIN_ROLE, 0xa7e9…498e)` is false.
- ISSUER and MINTER are false for the former holders. PAUSER is true for `0x434A…9c81`.
- `decimals` is `18`, and `totalSupply` and `cap` are both `1500000000000000000000000000000000`.

## Monitoring

Watch NUSD `0x491c…931b` and the timelock on chain 962421430 for these events:

| Contract | Event | Meaning |
| --- | --- | --- |
| NUSD | `RoleGranted(bytes32,address,address)` | Any role grant. After the handoff, there should be none unless a timelock operation was announced first. |
| NUSD | `RoleRevoked(bytes32,address,address)` | Any role revocation |
| NUSD | `DefaultAdminTransferScheduled(address,uint48)` / `DefaultAdminTransferCanceled()` | Admin handoff started or cancelled |
| NUSD | `DefaultAdminDelayChangeScheduled(uint48,uint48)` / `DefaultAdminDelayChangeCanceled()` | Someone is changing the 1-day delay |
| NUSD | `Paused(address)` / `Unpaused(address)` | Pause state changes |
| Timelock | `CallScheduled`, `CallExecuted`, `Cancelled`, `MinDelayChange` | Queued, executed, or cancelled admin operations |
| Safe | `AddedOwner`, `RemovedOwner`, `ChangedThreshold` | The Safe's signer set changed |

An unexpected `CallScheduled` gives at least 48 h to cancel it.
