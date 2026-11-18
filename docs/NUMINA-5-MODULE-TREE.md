# Numina 5 — Singular Neural Network Module Tree

Status: ARCHITECTURE PROPOSAL / RELEASE HOLD
Date: 2026-11-17
Repository: Numina-Enterprise/numina-production
Authority: SK Consulting LLC dba Numina Labs

## Governing model
The **Numina neural network** is the one logical root tree. Numina LLM is a module of that tree. All applications, agents, inference services, science, telemetry, cryptographic governance, release control, and native treasury interfaces are modules or submodules of the same tree; none forms an independent authority or competing root.

"All production" means a unified production **product architecture / governance scope**, not that every module is live, public, approved, or demonstrated operational. The release status of each module must come from its own verifiable receipt.

## Initial module hierarchy (design scope; not proof of implementation)
- NUMINA / Neural Network (canonical logical root)
  - Intelligence / Numina LLM
    - Licensed model checkpoint registry; tokenizer; GGUF artifact digest
    - llama.cpp runtime and real-generation receipts
    - Evaluation, benchmarks, and acceptance fixtures
  - Agents / Singularity coordination
    - Identity, capability scopes, topology, task/evidence envelopes, signatures
  - Numina Native Treasury
    - Accounting/view interfaces and separately authorized transaction controls
    - No inference or agent branch may gain treasury signing or fund-moving authority by inheritance
  - Apps / Web, mobile, desktop, API, developer SDK
  - Cyber, telemetry, provenance, resilience / Raft
  - Infrastructure / Runner and deployment control
  - Governance / Signing, canonical releases, audit, CI

## Independent axes: maturity, audience, and runtime
Every module record MUST independently specify:
- `module_id`, `parent_id`, `version`, `source_commit`, `module_owner`;
- `maturity`: `LEGACY | ALPHA | BETA | STABLE`;
- `audience`: `INTERNAL | DEVELOPER | PRIVATE | PUBLIC`;
- `deployment`: `NOT_DEPLOYED | STAGING | PRODUCTION`;
- `acceptance`: `NOT_RUN | BLOCKED | PASS | FAIL | INCONCLUSIVE | RELEASE_HOLD`;
- `artifact_path`, `expected_sha256`, `observed_sha256`, `license_evidence`, `exact_command`, `runner_environment`, `observed_output`, `verifier`, `linked_evidence`, `blocker`, `final_disposition`.

For example, a LEGACY module may be production deployed but private; an ALPHA module may be developer-only and un-deployed; a STABLE module may still be in RELEASE_HOLD. The word "production" does not implicitly turn any unverified acceptance gate to PASS.

## Canonical release records
One active Numina 5 `build.json` and one active Numina 5 `manifest.json` must be chosen and reviewed as a pair. This proposal does NOT overwrite existing historical `public/final-build.json` and `public/final-manifest.json`, which may be pinned by runtime/topology and signed-provenance checks. The pair must bind the source commit, module graph, model checkpoint ID, license evidence, verified SHA-256, llama.cpp binary digest, real generation receipt, CI, benchmark results, and Authority + Guardian signatures. Existing archived signed roots remain immutable. A new release identity needs independent compatibility checks and explicit approval.

## Evidence and licensing constraints
- Numina-owned branding, modules, API orchestration and native treasury do not themselves confer ownership or relicensing rights over third-party model weights. Record each model's actual upstream license, attribution, redistribution constraints and exact weights revision.
- Do not call a simulator, mocked subprocess, fixture-only evaluation, or policy inspection a real Numina LLM inference success.
- Require actual installed llama.cpp executable, verified binary identity, licensed and hash-matched GGUF, exact execution command, model stdout, exit code, device/runner environment, timings and linked immutable receipt.
- Evaluate valid, tampered, missing-license, missing-hash, invalid-path, and invalid-executable fixtures, as well as independent acceptance benchmarks.
- A root authority name or email inside JSON is metadata, NOT cryptographic proof. Verify signature against approved keypin on RFC 8785 canonical bytes; maintain separate independent authorization under the existing two-signer policy.
- Production release remains HOLD until license, hash, runnable executable, real model generation, acceptance fixtures, CI, independent verifier and explicit release authorization pass.

## Integration guidance
README, AGENTS and Singularity envelopes may reference this module tree, but pinned historical protocol files and hashes must not be mechanically rewritten. Make reviewed, scope-appropriate updates only with revalidation of the existing singularity coordination source-alignment/latch checks. No deployment, treasury operation, permission change, automated release, or signature creation is authorized by this document.

## Known evidence baseline (2026-11-17)
PR #196 merged to main as `a48f7490451b81d1d5d85f32625c9dd7f8c25695`. Its successful Model Foundry CI validated runner policy, Python unit tests and cross-platform contracts; it did not demonstrate real licensed model generation. Thus Numina LLM real inference acceptance remains NOT_RUN / RELEASE_HOLD until receipts exist.
