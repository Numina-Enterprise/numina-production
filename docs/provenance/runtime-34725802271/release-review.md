The Numina NUSD runtime source archive, Linux image archive and inventory match the retained successful GitHub attestation verification results. No source, builder, run or artifact-digest mismatch was found.

[Workflow run 34725802271, attempt 1](https://github.com/skott34-dot/numina-production/actions/runs/34725802271/attempts/1) completed successfully on 2026-09-12 at 23:35:53 UTC. Its source is skott34-dot/numina-production commit **2b0be57996c70e8fda49199d1d649fe3faf0e0d3**, directory runtime/nusd, on refs/heads/main. The signer is skott34-dot/numina-builder/.github/workflows/numina-nusd-runtime-builder.yml pinned to **cda9bf7702d909ed1d8e16c338a91e283c1bce53**.

The saved certificates and SLSA v1 statements agree on that source, signer and exact run. They identify GitHub-hosted execution and the GitHub Actions OIDC issuer. Each separate artifact-verification command has exit code 0 in the [retained comparison record](release-review.json). All three retained results contain the same signed statement covering these three subjects.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Source archive | 39,472 | 4486f9aae6a7e01078a09860c604f8a17573cd1c7126e2060ac91c1b4329a0ac |
| Linux image archive | 84,434,244 | 796add5e929bc63105a0d0e97e026d62481c46af09ec1cb08a30f1f5dafdcc33 |
| Runtime inventory | 6,357 | 33c2517226539296eb40b7a24caeceb845ddf5a98c2589f359f141b555ff1fc9 |

These hashes were calculated from the saved files and match their signed subjects. Source and image sizes and hashes also match the [signed inventory](numina-nusd-runtime-inventory.json). The retained run before and after download remains attempt 1 at the same successful source revision.

The signed inventory records an actual Docker build and saved Linux/amd64 image, with configuration digest **sha256:edff50ea08f24fa4c5c3f69575cdcf5768a00b8b7ab3738c31a9137e2a42a76e**. It records no application start, registry push, tests, RPC credentials or provider submission. The Solidity contract was included as a precompiled input; this workflow did not compile or deploy it.

This establishes builder-signed runtime artifacts. It does not establish a running production host, persistent production journal, contract deployment, issuance, transfer, verified reserves, custody or settlement. Submission readiness remains false. No new SLSA level or third-party certification is asserted by this review; signatures alone do not establish every build-control requirement. The previously signed website release remains separate and was not changed by this runtime build.

This review inspected retained evidence and local bytes only. It did not rerun attestation verification, execute tests, access the network, start the image or deploy anything. [Machine-readable comparisons and evidence hashes](release-review.json) preserve the exact comparison scope.
