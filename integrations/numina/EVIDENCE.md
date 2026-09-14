# Runtime build evidence — integration kit 3.0.0

This archive revision is `numina-root-v3.0.0`. The kit can read evidence labels and available NUSD receipt/readiness records from the [Numina application manifest](https://numinalabs.xyz/v3/release/manifest). It does not perform signature, receipt or readiness verification itself. Application release, rc26 control-plane runtime and the Linux execution image have separate identities and evidence scopes. This revision does not replace the retained runtime build evidence below.

## Read through a provider or local MCP host

Register the discovery tool descriptors, then call `numina_runtime_build` with `{}`. The JavaScript equivalent is `client.runtimeBuild()`. This uses one public GET of the existing application manifest. It preserves its `execution_runtime_build`, `financial_status_sources` and `scope` fields, plus `nusd_transaction_receipts` and `nusd_activation_readiness` when supplied as objects. Older manifests without these fields remain supported: the client omits absent fields instead of inventing evidence. It does not follow returned links, access owner accounts, run a program or activate a transaction.

The outer result remains `server_reported_not_independently_verified`. Boolean labels inside `execution_runtime_build` describe the server's recorded build evidence; they are not a new verification performed by the client. Receipt and readiness contents are likewise server assertions, even if a nested field says `verified` or `complete`. The result explicitly reports `receipt_verification_performed:false` and `readiness_verification_performed:false`. Receiving a record does not check a blockchain receipt, bank-origin document, deployed host or funded settlement route. A dated successful build is not a fresh observation of a production host or a financial account. Use `numina_nusd_status` with `{"request_id":null}` for the separate current public asset/capability response.

RUNTIME_BUILD_UNAVAILABLE means the current manifest does not include this record. The kit does not invent fallback hashes, replace missing data with zero balances or turn a build failure into a transaction outcome.

## Recorded runtime build

The retained [GitHub run 34725802271, attempt 1](https://github.com/skott34-dot/numina-production/actions/runs/34725802271/attempts/1) completed successfully on September 12, 2026. Separate GitHub CLI verification results recorded successful verification of all three artifact subjects against:

- Source: skott34-dot/numina-production at 2b0be57996c70e8fda49199d1d649fe3faf0e0d3.
- Signer workflow: skott34-dot/numina-builder/.github/workflows/numina-nusd-runtime-builder.yml at cda9bf7702d909ed1d8e16c338a91e283c1bce53.
- GitHub Actions OIDC issuer, SLSA v1 predicate and GitHub-hosted runners.

| Artifact | SHA-256 |
|---|---|
| numina-nusd-linux-runtime-source.tar.gz | 4486f9aae6a7e01078a09860c604f8a17573cd1c7126e2060ac91c1b4329a0ac |
| numina-nusd-linux-runtime-image.docker.tar.gz | 796add5e929bc63105a0d0e97e026d62481c46af09ec1cb08a30f1f5dafdcc33 |
| numina-nusd-runtime-inventory.json | 33c2517226539296eb40b7a24caeceb845ddf5a98c2589f359f141b555ff1fc9 |

The release publishes the [signed inventory](https://numinalabs.xyz/downloads/provenance/runtime-34725802271/numina-nusd-runtime-inventory.json), [detached provenance bundle](https://numinalabs.xyz/downloads/provenance/runtime-34725802271/provenance.jsonl) and [unsigned review index](https://numinalabs.xyz/downloads/provenance/runtime-34725802271/release-review.json). These links are publication targets for this release; this kit packaging step has not verified their live deployment.

## Verify outside the model's tool loop

Download the chosen artifact and detached bundle from the recorded release. Review their source, exact run and expected hashes. With a configured GitHub CLI, this command verifies the inventory against the intended signer and source:

~~~~sh
gh attestation verify numina-nusd-runtime-inventory.json --bundle provenance.jsonl --hostname github.com --repo skott34-dot/numina-production --signer-workflow skott34-dot/numina-builder/.github/workflows/numina-nusd-runtime-builder.yml --signer-digest cda9bf7702d909ed1d8e16c338a91e283c1bce53 --source-digest 2b0be57996c70e8fda49199d1d649fe3faf0e0d3 --source-ref refs/heads/main --cert-oidc-issuer https://token.actions.githubusercontent.com --predicate-type https://slsa.dev/provenance/v1 --deny-self-hosted-runners --format json
~~~~

Compare the verified subject digest and certificate/predicate run identity with the intended run above. Repeat with each downloaded archive to verify that file's bytes. Merely seeing three subjects in one statement does not mean the CLI hashed all three local files in a single command. See the [official GitHub CLI verification reference](https://cli.github.com/manual/gh_attestation_verify).

The signed inventory records an image build and save. It records no application start, production host deployment, registry push, Solidity compilation, provider submission, contract broadcast, mint or transfer. This kit does not establish production journal durability, reserves, custody, redemption or settlement. No new SLSA level or provider certification is asserted here, and the previously verified website build remains separate.
