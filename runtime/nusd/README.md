# Numina NUSD managed runtime candidate

Linux container source for the managed deployment adapter. The runtime uses Node 24 and ethers 6.15.0 with a committed dependency lock. It includes a previously compiled contract artifact; this container build does not compile Solidity.

The default container command only observes directory-flush support, with networking disabled in the default Compose service. Operator credentials, reviewed deployment parameters, persistent transaction history and private policies are external inputs and are not in this repository. No container build or artifact signature sends a blockchain transaction or establishes token reserves.

The operator must preserve the complete persistent journal and manifest history across container replacement. The two named external volumes must exist and be writable by UID 1000. Do not replace an uncertain journal with an empty volume or remove its locks. Application review, hash, nonce and durability requirements remain enforced by the adapter.

The separate hosted workflow produces source and container-image archives plus a file inventory. Its provenance applies only to those exact artifacts. It does not establish website deployment, signing-host availability, independent custody, reserves, issuance or settlement. The existing website release workflow and its attested artifacts remain separate.
