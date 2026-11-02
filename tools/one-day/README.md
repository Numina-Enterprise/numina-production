# Numina one-day parallel implementation sprint

Sprint date: 2026-11-02 (operator timezone UTC−5). Source baseline: `Numina-Enterprise/numina-production@23c38e1e3a15e8f6559486ca024edb2faa3244cb`.

Samuel authorized all three projects to advance in parallel with a one-day implementation target. This package delivers reviewable implementation and reproducible verification. It does not compress external assessment, provider authorization, continuous observation or hardware access into an assumed pass.

| Owner | Workstream | Day-one deliverable | External acceptance remains gated by |
| --- | --- | --- | --- |
| ksi_engine | KSI and supply-chain evidence | Candidate S0 boundary, source-bound dependency inventory, audit-report ingestion and full Ed25519 signer challenge verification | Owner-approved scope, restore evidence, authentic scanner output, full KMS version and deployed signer evidence, assessment review |
| mcp_gateway | Authorized MCP boundary | Existing PR127 gate reproduction, authorization-boundary helpers and durable replay/cumulative-limit store | Real authorization-server/resource integration and provider tests; no token issuer or live execution is asserted |
| telemetry_testbed | Telemetry and provenance | Bounded CCSDS/STAC adapters, policy simulation, signed receipts and measured benchmark | Representative mission data, actual hardware and a mission-owner evaluation |
| integration | Combined verification | One repeatable test runner and evidence artifacts in the existing GitHub-hosted NUMINA job | Observed hosted job result and deployment review |

## One-day sequence

The following are implementation timeboxes, not external completion promises:

1. Hours 0–2: pin source and standards; assign one owner to each isolated workstream; record missing access.
2. Hours 2–8: implement the three bounded components concurrently.
3. Hours 8–16: run negative tests, reproduce existing gates and produce source/measurement evidence.
4. Hours 16–20: integrate in the existing approved runner, inspect actual GitHub job output, and distinguish code results from live evidence gaps.
5. Hours 20–24: review the candidate and issue a proceed/retest/block decision for each external gate.

## Run

`node tools/one-day/run-sprint.mjs <output-directory>`

This discovers all three projects' tests, runs test files concurrently on one computer, and writes `tests.tap` and `validation.json`. The report includes measured runtime, counts, file hashes and explicit false flags for live-runtime verification, provider execution, HIL and compliance authorization. A green test run is not a green deployment gate.

CI reuses `.github/workflows/numina.yml`, its pinned Node 26.13.0 runtime, `ubuntu-24.04` runner and pinned action versions. It adds no runner declarations and grants no new permissions. New steps run before the pre-existing dependency/build/release steps; the existing full release checks remain enforced.

## Checkout blocker and preserved reference

Observed earlier run: https://github.com/Numina-Enterprise/numina-production/actions/runs/41434301998

Job 125240217861 failed in checkout auth cleanup, before Node setup or tests:

`fatal: No url found for submodule path 'consolidated-evidence/your_files' in .gitmodules`

The pinned source tree contains an orphan gitlink at that exact path with mode `160000`, object `365c418d38d34c5765bd986250ff666541d9512e`, and no `.gitmodules`. That commit could not be resolved in this repository. A synthetic Git regression reproduced the same failure; sparse exclusion did not repair it.

The candidate removes only that orphan index/tree reference, preserving its exact identity here. It does not delete a remote repository, remote commit object or recovered submodule contents. No replacement URL is guessed. The reference remains recoverable from the baseline commit and this record. `checkout.test.mjs` verifies the failure and the narrow repair.

## Review and release boundary

No production signer, trust anchor, root authority, secret, IAM grant, trading account, payment, satellite command or treasury state is changed. No external evaluator has accepted these results. Project-specific READMEs enumerate exact commands, primary sources, observations and remaining gaps.

All results must retain their classification: source observation, local test, simulation, hosted CI or independently verified runtime evidence. Do not promote one class to another.
