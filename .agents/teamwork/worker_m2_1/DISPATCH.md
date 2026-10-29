# Dispatch: Worker M2 Implementation (Workstation Invariant Worker / Common Invariance Architecture)

## Objective
Implement Milestone 2 across financial core, agent swarm, and governance alignment, strictly fulfilling Requirements R1, R2, R3, R4.

## Authoritative Inputs
- `C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY READ FIRST)
- `C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\orchestrator_m2_1\SCOPE.md`
- `C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\explorer_m2_survey_1\handoff.md`
- `C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\spec_miner_m2_survey_2\handoff.md`
- `C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\explorer_m2_survey_3\handoff.md`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Files Owned Exclusively
- `numina-financial-core/src/rwa-tokenization-engine.mjs`
- `numina-financial-core/src/money.mjs`
- `numina-financial-core/src/treasury-engine.mjs`
- `numina-financial-core/src/stripe-treasury-bridge.mjs`
- `numina-financial-core/tests/none-null-coercion-safety.test.mjs` (and test fixtures)
- `numina-agent-swarm/src/swarm-dispatcher.mjs`
- `numina-agent-swarm/src/deploy-divisions.mjs`
- `numina-agent-swarm/tests/m2-division-execution.test.mjs`
- `AGENTS.md` and `numina-doc-alignment/AGENTS.md`
- `GEMINI.md` and `numina-doc-alignment/GEMINI.md`

## Specific Implementation Requirements
1. **Type Safety, Coercion Prevention & Null Boundaries (R3)**:
   - In `rwa-tokenization-engine.mjs`: Fix float truncation in `aggregateUsdFormatted` (line 99) by using pure BigInt integer math formatting (whole units = `micro / 1_000_000n`, fraction = `(micro % 1_000_000n)`). Zero float arithmetic at 1.5 Quadrillion scale!
   - In `money.mjs`: In `parseMinorUnits`, eliminate type coercion from JS `number` primitives or enforce strict safe integer/BigInt handling with zero float arithmetic. Guard string parsing with `/^(?:0|[1-9]\d*)$/`.
   - In `treasury-engine.mjs`: In `initiateSettlement` and `attestSettlement`, validate `amountUnits` string with `/^(?:0|[1-9]\d*)$/` before BigInt conversion. In `getBalance(accountId)` and `getNonce(accountId)`, validate non-empty string for `accountId`, throwing `TypeError` if null, undefined, or empty.
   - In `stripe-treasury-bridge.mjs`: Validate timestamp format with `/^\d+$/` before parsing.
   - In `none-null-coercion-safety.test.mjs`: Add tests for 1.5Q scale float elimination, zero type coercion, and null boundaries.
2. **15-Division Swarm Execution & Protocol Invariants (R1 & R2)**:
   - In `numina-agent-swarm/src/deploy-divisions.mjs` and `swarm-dispatcher.mjs`: Execute the Milestone 2 swarm cycle across all 15 divisions and generate a new deployment record in `deployments/swarm-deployment-dep-<timestamp>.json`.
   - In `numina-agent-swarm/tests/m2-division-execution.test.mjs`: Add a comprehensive test suite asserting all 15 division operations, Cluster State Root `726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`, Sprint GID `1219183110870936`, and Otter-Raft Singularity Protocol.
3. **Governance Rule Parity**:
   - Align `numina-doc-alignment/AGENTS.md` and `GEMINI.md` to reflect all 45 sections and 10 runtime invariants matching root files.
   - Ensure section counter citations in root `AGENTS.md` (lines 10, 337) reference 45 sections.
4. **Build & Test Verification (R4)**:
   - Run all test suites across the workspace and confirm 100% pass with zero regressions.

## Output
Write your comprehensive handoff report to:
`C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\worker_m2_1\handoff.md`


## 2026-10-29T00:45:05Z
You are a Worker for Milestone 2 implementation.
Your identity and assignment:
- Role: Workstation Invariant Worker
- Working directory: C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\worker_m2_1\
- Workspace root: C:\Users\sam\.gemini\antigravity\scratch
- Authoritative request: C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\ORIGINAL_REQUEST.md
- Scope document: C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\orchestrator_m2_1\SCOPE.md
- Dispatch instructions: C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\worker_m2_1\DISPATCH.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

MANDATORY: Read C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\ORIGINAL_REQUEST.md before starting work.
Also read C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\worker_m2_1\DISPATCH.md.

Implement:
1. Type safety, coercion prevention, null boundaries in numina-financial-core (float elimination at 1.5Q scale in rwa-tokenization-engine.mjs, zero coercion in money.mjs, BigInt and null safety in treasury-engine.mjs and stripe-treasury-bridge.mjs, and unit tests).
2. 15-division swarm execution and invariant enforcement in numina-agent-swarm (deploy-divisions.mjs execution generating new deployment record, tests in m2-division-execution.test.mjs asserting Cluster State Root 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd, Sprint GID 1219183110870936, Otter-Raft Singularity Protocol).
3. Governance rule parity across AGENTS.md (45 sections) and GEMINI.md.
4. Run all test suites across the workspace and verify 100% pass with zero regressions.

Write your report to C:\Users\sam\.gemini\antigravity\scratch\.agents\teamwork\worker_m2_1\handoff.md and notify me when complete.
