# Numina 2.0 — SLSA Build L3 assessment

**Decision:** The two named artifacts from [GitHub Actions run 34717406980, attempt 1](https://github.com/skott34-dot/numina-production/actions/runs/34717406980/attempts/1) meet **SLSA v1.2 Build Level 3 under this documented self-assessment**. Their builder-signed provenance has been verified. This is not third-party certification.

Assessment record time: **2026-09-12 20:45:14 UTC**. Review used the retained successful run, verification output, approved policy and immutable builder workflow. No tests, builds or deployments were run for this assessment.

## Exact scope

| Item | Identity |
| --- | --- |
| Application | Numina 2.0.0 |
| Source repository | `skott34-dot/numina-production` — ID `1367647143` |
| Source revision | `38ba12943decfb33ad3579ed322e5f02bcd1372a` |
| Source ref | `refs/heads/main` |
| Builder repository | `skott34-dot/numina-builder` — ID `1367645630` |
| Builder revision | `4a7210c10fcfa79436018e8ba337244402661036` |
| Application build ID | `86534be2a6ea3fd513ce323932caf7381518ab45f435a4e69cad877e950d7770` |

The [immutable reusable workflow](https://github.com/skott34-dot/numina-builder/blob/4a7210c10fcfa79436018e8ba337244402661036/.github/workflows/numina-site-builder.yml) builds and signs these exact subjects:

| Artifact | SHA-256 |
| --- | --- |
| `numina-site-v2.0.0.tar.gz` | `daa688cd91a3a792531ee09f56129dbb8412f3c4516bc6d0da3a6d748c4e13d9` |
| `application-release-v2.json` | `30434a312366a8869b93e9f27b428ee0e5f385c1bd0e8fc877912a98fe97f792` |

The actual [Sigstore bundle](provenance.jsonl) has SHA-256 `f7884feee62e1262254b5faa076271c83fcb10b1194c3b2e69a26fbb3f1aa470`. The [verification result](verification-result.json), recorded at **2026-09-12T20:34:58.458029+00:00**, confirms the expected GitHub OIDC issuer, builder identity, source revision, hosted runner, run attempt and both subject digests. Rekor's verified timestamp is **2026-09-12T15:33:00-05:00**.

## Requirements assessment

| Requirement | Evidence and conclusion |
| --- | --- |
| Appropriate platform | GitHub documents reusable workflows that build and attest artifacts as its L3 approach. The actual run uses that architecture; this assessment checks the current v1.2 requirements. |
| Consistent process | Fixed builder SHA; exact source repository, numeric ID and protected-main checks; manual trigger without inputs; immutable source checkout; fixed build/package commands. |
| Provenance distribution | GitHub stores the actual attestation for the public source repository. The retained bundle supplies both signed subjects and is available alongside this record. |
| Existing, authentic provenance | In-toto statement with SLSA provenance v1; verified Sigstore signature, platform identity, source, invocation, digests and transparency timestamp. |
| Protected signing | Build job has read-only repository access and no OIDC permission. A fresh signing job executes no source code, performs no archive extraction and accepts no source-supplied predicate. |
| Trusted provenance fields | The pinned attestation action generates platform-derived provenance. Signing identity is pinned to the reusable workflow SHA. Subject names/digests use SLSA's permitted output exception. |
| Enumerated external parameters | No caller inputs, command/ref/runner overrides or inherited secrets. Provenance records caller repository/path/ref and resolved source commit; builder identity fixes internal configuration. Dependency completeness remains best effort. |
| Hosted, isolated execution | Standard GitHub-hosted Ubuntu VMs separate build and signing jobs. GitHub's documented fresh-runner model supplies ephemeral and cross-build isolation. |
| Cache, output and remote-influence controls | No application cache; setup-node caching disabled; immutable uploads, current-run artifact IDs and digest checks. The builder exposes no remote-control service. |
| Security practices | Full-SHA action pins, minimum permissions, protected-source guard, keyless workload identity and explicit verification policy. Managed-platform security and owner governance remain disclosed trust assumptions. |

This maps the [SLSA v1.2 requirements](https://slsa.dev/spec/v1.2/build-requirements) to observed controls and the documented [GitHub reusable-workflow approach](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating) and [runner isolation model](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners). The review found **no concrete unmet Build L3 requirement** within this scope. Detailed evidence and source links for each row are in the [machine-readable assessment](slsa-build-l3-assessment.json).

## Trust and limits

The assessment trusts GitHub's managed control plane, hosted-runner separation, OIDC identity and artifact service; Sigstore's trust infrastructure; and the reviewed builder/action pins. The builder is owner-governed. No independent approval of each source change or audit of GitHub administration is asserted. SLSA permits self-assessment; it does not intrinsically require independent human approval or third-party certification. [SLSA assessment guidance](https://slsa.dev/spec/v1.2/assessing-build-platforms)

The production record observes that the live inventory matches its signed subject. It also records later hosting archive transformations and injected HTML, incomplete provider-transformation provenance, and no independent inspection of executing private Worker bytes. **Those limitations exclude a complete delivery-chain claim; they do not change the build-level assessment of the original signed archive and inventory.**

This claim does not cover the separate rc22 runtime build, historical rc20 releases, future artifacts, software correctness, vulnerability absence, test coverage, reproducibility, financial execution, NUSD issuance/backing, legal approval, native-store publication or marketplace installation.

## Preserve the proof

Publish this assessment separately from the signed bytes. This document is explanatory metadata, not an additional builder signature. Earlier `slsa_level_claimed: null` records remain unchanged; the new conclusion belongs in this dated assessment. Keep the [approved policy](approved-policy.json), [verification result](verification-result.json), bundle and artifacts beyond the workflow's 30-day artifact retention. Reassess changes to builder pins, accepted inputs, source identity or platform trust.

The JSON assessment includes exact hashes of all supporting evidence. Consumers should verify the artifacts with the approved identities and revisions using [GitHub's verification command](https://cli.github.com/manual/gh_attestation_verify); a signature from an arbitrary workflow is insufficient.
