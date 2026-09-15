# Numina NUSD managed runtime candidate

Linux container source for the managed deployment adapter. The runtime uses Node 24 and ethers 6.15.0 with a committed dependency lock. It includes a previously compiled contract artifact; this container build does not compile Solidity.

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
