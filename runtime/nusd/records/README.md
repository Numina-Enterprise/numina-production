# NUSD governance records

This folder holds owner-filled records for the NUSD admin lockdown. The `*.template.json` files are
blank forms. Copy one to a dated file (for example `safe-numina.2026-11-20.json`), fill it in from
on-chain reads, and commit it through a pull request. Nothing in this folder is signed or executed
by tooling.

| Template | Records | Runbook |
| --- | --- | --- |
| `safe-numina.template.json` | The 3-of-6 Safe on the Numina chain (962421430) that proposes and executes through the timelock that becomes NUSD default admin | `docs/nusd/runbooks/nusd-admin-safe-handoff.md` |
| `admin-handoff.template.json` | Each step of the default-admin handoff: role revocations, timelock deployment, transfer start, acceptance, and post-checks | `docs/nusd/runbooks/nusd-admin-safe-handoff.md` |
| `safe-base.template.json` | The separate Safe on Base (8453) that will administer `NuminaBaseUSDCVault` once that vault is deployed | `docs/nusd/runbooks/nusd-base-vault-safe.md` |

Rules:

- Record public addresses, transaction hashes, block numbers, and read-back values only. Never put
  private keys, seed phrases, RPC URLs, RPC credentials, or authorization headers here.
- Every value you fill in should come from a read you can repeat with
  `runtime/nusd/scripts/verify-admin-handoff.mjs` or `runtime/nusd/scripts/verify-safe-factory.mjs`.
- `admin-handoff.template.json` has an `expected` block in the format that
  `verify-admin-handoff.mjs --expected <file>` accepts. A `null` field is not checked.
- The owner signs every transaction. Tooling only reads.
