# Numina NUSD managed runtime candidate

## Contract lifecycle

The NUSD contract lifecycle is **INITIATED** for `NuminaUSD`, `NuminaSettlement`, `NuminaUSDCConversion`, and `NuminaUSDRedemption`. Each role is in `DEPLOYMENT_PREPARATION_INITIATED`. This records software preparation only: no contract address, transaction hash, chain receipt, mint, conversion, redemption, bank payment, or external deposit is asserted until the corresponding provider/network evidence exists.

## 1:1 conversion contract candidates

The source also includes `NuminaUSDCConversion` for exact exchange against existing same-chain NUSD/USDC inventory and `NuminaUSDRedemption` for NUSD escrow with separate bank-outcome attestations. Both start paused; publishing or compiling them does not deploy them, mint tokens or initiate deposits. Their sources and artifacts are included in the application contract record. See [contract and security documentation](../../docs/NUSD-Conversion-Contracts.md) for interfaces, trust boundaries, local tests and activation requirements. The existing managed token deployment adapter does not deploy these new contracts automatically.

Linux container source for the managed deployment adapter. The runtime uses Node 24 and ethers 6.17.0 with a committed dependency lock and pins ws 8.21.3 through an exact npm override. It includes a previously compiled contract artifact; this container build does not compile Solidity.

The default container command only observes directory-flush support, with networking disabled in the default Compose service. Operator credentials, reviewed deployment parameters, persistent transaction history and private policies are external inputs and are not in this repository. No container build or artifact signature sends a blockchain transaction or establishes token reserves.

The operator must preserve the complete persistent journal and manifest history across container replacement. The two named external volumes must exist and be writable by UID 1000. Do not replace an uncertain journal with an empty volume or remove its locks. Application review, hash, nonce and durability requirements remain enforced by the adapter.

The separate hosted workflow produces source and container-image archives plus a file inventory. Its provenance applies only to those exact artifacts. It does not establish website deployment, signing-host availability, independent custody, reserves, issuance or settlement. The existing website release workflow and its attested artifacts remain separate.

## Prepare unsigned token deployment

Copy `deployment.template.json` to a private working directory and fill the explicit recipient, four distinct roles, cap, initial supply, administrator delay, finality policy and existing review-record fields. Supply the actual issuer policy file and its SHA-256. The template's network and issuer names are configured targets, not verification of chain identity or legal authority. Do not enter secrets or substitute a provider deposit destination for controlled role wallets.

With the locked dependencies installed, run:

```sh
node scripts/validate-deployment.mjs /path/request.json --output /path/unsigned-deployment.json
```

No arguments validate the included incomplete template and return a structured list of missing inputs. A valid request produces creation data bound to its exact request and pinned artifact hashes, with explicit cap, issuance, recipient and role information. The command never contacts an RPC provider, signs, broadcasts, estimates fees, writes the native treasury or creates a transaction receipt. Record presence checks do not verify the underlying reviews.

The token starts paused. Constructor issuance is separate from the existing native treasury projection and must be explicitly specified; the recorded native 500T balance does not automatically select the token supply. After a user-signed token deployment, confirm its chain, receipt, runtime, roles, supply and pause state. Only then prepare the settlement contract using that verified token address. `NuminaSettlement` transfers existing NUSD; it does not convert it to USDC or submit bank deposits.

### Inspect constructor data while reviews are open

Reviewers can inspect and simulate exact creation data before completing independent and operational reviews:

```sh
node scripts/prepare-review-draft.mjs /path/request.json --output /path/review-draft.json
```

This offline command still validates the cap, initial supply, recipient, distinct roles, delay, policy bytes/hash and pinned artifact. It tolerates missing review references solely for producing a `numina.nusd.transaction-review-draft.v1` artifact. The result includes the unresolved review list, exact data and hashes, `submissionApproved: false`, and no signer, nonce, fees, signature or receipt. Even populated review strings do not make a preview approved. Existing different output is never replaced; identical retries reuse the same file.

The ordinary validator and managed deployment adapter retain their review requirements. A review draft is not a managed execution manifest and cannot be passed to the adapter as one. Completing an assessment with a failed or evidence-required finding does not clear the corresponding production review. No review-preparation command contacts an RPC provider, reads wallet keys, signs, submits or updates the native treasury.

## Provision distinct local role wallets on Windows

`scripts/provision-wallets.mjs` creates four independent cryptographically random keys, verifies their encrypted keystores, and assigns their public addresses to an existing request. Supply the requested recipient explicitly. It changes only the role and recipient fields; rerunning with the same vault restores the same addresses. It refuses to replace existing different assignments or overwrite a private vault.

```sh
node scripts/provision-wallets.mjs /private/request.json /private/new-vault "COMPUTER\\owner" 0xTreasuryRecipient
```

The local provisioning/backup tools require Node 24 and Python 3 on Windows (set `NUMINA_WALLET_PYTHON` to a Python executable if it is not on PATH). The Python bridge invokes native Windows security APIs directly; it does not change PowerShell execution policy. The vault must be outside Git checkouts and public/outputs/dist directories. Web3 Secret Storage v3 keystores use ethers' default scrypt encryption with a random 256-bit password. Windows DPAPI LocalMachine protects that password, and a verified non-inherited NTFS ACL limits the vault directory and private file to the named Windows owner, its creating account and SYSTEM. Local administrators can recover access. This deliberately supports an owner account different from a sandbox creator; CurrentUser protection under the sandbox account would not give the owner recovery access. LocalMachine protection relies on file access control. Never upload the private vault or include it in source, artifacts or a hosted runtime.

The four addresses have separate private keys but share one host and custody boundary. Their creation does not satisfy `independentRoleKeyCustody`, select a deployment sender, fund gas, change token supply, verify the network, or authorize a reserve claim. Those input/review fields remain unchanged. Only a public assignment manifest is written alongside the deployment request; no private key or password is printed.

Run `python scripts/backup-wallets.py --vault /private/vault --destination /private/new-backup --owner-account "COMPUTER\\owner"` as the named Windows owner to make portable encrypted keystore backups. The helper prompts locally for a new password twice and passes it through a private process pipe, never command arguments. Retain this password separately from the backup. Until a portable backup is created and checked by the owner, recovery depends on this Windows installation and its protected vault. No recovery phrase is generated. The backup tool never signs or broadcasts a transaction.

Windows references: [DPAPI protection scope](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dataprotectionscope) and [ethers encrypted JSON wallets](https://docs.ethers.org/v6/api/wallet/).
