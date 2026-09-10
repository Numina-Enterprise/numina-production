# Numina Core Reference v1.8

**Autonomous Clearing & Systemic Stability Runtime** — deterministic margin state, bounded margin calls, default waterfalls, recovery ordering, systemic stress envelopes, and crisis non-amplification proofs layered over the v1.7 constitutional market.

## v1.8 additions

- deterministic maintenance-margin assessment over gross open obligations
- bounded, buffered, replay-safe margin call objects
- priority-ordered default waterfall allocation using only pre-existing resources
- recovery plans restricted to obligation-satisfying, risk-reducing, reconciliation, and collateralization actions
- systemic clearing envelopes across obligations, collateral, settlement capacity, and deficiency
- crisis non-amplification proofs preventing risk-authority expansion under stress
- observation-only assessment semantics: measurement cannot mint or mutate authority

**Conformance: 309/309 tests passing.**

See `CLEARING-STABILITY-v1.8.md`.

---

# Numina Core Reference v1.6

**Institution-Scale Rights & Obligation Network** — cross-domain rights propagation, recognition surfaces, deterministic claim priority, insolvency preservation, contract-network reachability, settlement proofs, and bounded authority synthesis.

## v1.6 additions

- explicit rights propagation routes with non-transitive-by-default semantics
- monotonic capacity narrowing across recognition/propagation hops
- recognition-surface measurement without treating duplicate recognition as new intrinsic capacity
- deterministic seniority/priority waterfall and explicit deficiency accounting
- contract-network systemic reachability with cycle-safe consequence bounds
- replay-protected settlement proofs binding obligation identity, parties, amount, sequence and prior state
- atomic local/network obligation satisfaction on accepted settlement proof
- bounded authority synthesis from active, recognized, available rights
- 20 new v1.6 conformance scenarios

**Conformance: 269/269 tests passing.**

See `INSTITUTION-NETWORK-v1.6.md` and `institution_network_example.py`.

---

# Numina Core Reference v1.5

**Rights Runtime** — deterministic rights genesis, occupancy, reciprocal right/obligation formation, recognition budgets, lifecycle mutation, and Rights VM execution feeding the Institutional Compiler.

## v1.4 additions

- explicit `RightCreationAuthority` and bounded root/derived rights genesis
- rights occupancy: reserved, encumbered, exercised, uncertain
- source-right encumbrance for derived resource-backed rights
- atomic reciprocal claim-right + obligation creation
- recognition budgets and non-expansive external recognition
- rights suspension, activation, transfer, uncertainty narrowing and extinction
- conservative Maximum Reachable Rights Consequence (`MRRC`)
- deterministic Rights VM programs and state roots
- direct projection into the v1.3 Institutional Compiler

**Conformance:** 228/228 tests passing.

See `RIGHTS-RUNTIME-v1.4.md` and `rights_example.py`.

---

# Numina Core Reference v1.3

**Executable Institutional Compiler** — compiles an autonomous institution into deterministic rights, authority, obligation, recognition, recovery, reachability and viability artifacts.

**Conformance:** 204/204 tests passing.

## v1.3 additions

- deterministic Institution IR and reproducible institutional build digest
- rights-lineage and authority-conservation verification
- recognition non-expansion checks
- recovery-path and obligation-preservation viability checks
- institutional MREC projection
- semantic build classification and economic diff
- exact build-bound launch governance proofs
- formal institution lifecycle through wind-down and dissolution
- recursive child-build commitments for sub-institutions

See `INSTITUTIONAL-COMPILER-v1.3.md` and `institution_example.py`.

---

# Numina Core Reference v1.2

**Autonomous Institutional Controller** — deterministic predictive authority control over the v1.1 Authority Physics runtime. Automatic control can preserve or contract authority; expansion is proposal-only until explicit governance proof authorizes it.

**Conformance:** 184/184 tests passing.

## v1.2 additions

- Policy-safe predictive authority control over bounded future horizons.
- Authority homeostasis targets for liquidity, pressure, uncertainty, observation lag, concentration, and MREC.
- Explicit governed-expansion proposals bound to source state, governance epoch, distinct approver threshold, and parent capacity.
- Counterfactual shadow universes that cannot mutate live authority.
- Continuous constitutional chaos testing with no authority-expansion fault opcode.
- Deterministic, integer-only trajectory scoring and artifact digests.

See `AUTONOMOUS-CONTROLLER-v1.2.md` and `CONTROLLER-DEMO-OUTPUT.txt`.

---

# Numina Core Reference v1.1

Deterministic reference runtime for **Numina — Economic Authority Infrastructure**.

v1.1 advances the executable Authority Physics layer into an **Adaptive Authority Control Runtime**. The layer derives field state from existing constitutional authority and may automatically contract or preserve power; it never creates rights or expands authority.

## v1.1 Adaptive control

- continuous safety-envelope assessment
- deterministic field metrics: horizon MREC, liquidity, uncertainty, velocity, observation lag, dependency concentration, pressure and structural entropy
- field-triggered non-expansive contraction plans
- observation-lag / velocity coupling
- uncertainty-preserving contraction floors
- pressure monitoring with explicit prohibition on automatic expansion
- deterministic stress / perturbation simulation on copied state
- conservation-preserving dynamic authority placement plans
- mandatory release-proof markers before reallocation
- deterministic non-expansion proof artifacts

Core rule: **learning, measurement, stress analysis and optimization may change proposals; only legitimate constitutional transitions may change economic power.**

## Run

```bash
python -m pytest -q
python example.py
python adaptive_example.py
```

Expected conformance result:

```text
164 passed
```

## Files

- `numina_core.py` — constitutional reference runtime plus v1.1 adaptive-control primitives
- `test_numina_core.py` — complete conformance suite
- `AUTHORITY-CONTROL-v1.1.md` — adaptive control laws and boundary conditions
- `adaptive_example.py` — executable field/envelope/contraction/stress demonstration
- `CONFORMANCE-REPORT.txt` — verified local test result
- `MANIFEST.sha256` — package content hashes

## Scope

Reference implementation only. No live money, custody, broker, wallet, or employer-owned integration code is included. This package does not claim regulatory approval, external standards recognition, production certification, or financial safety.


## v1.5 — Rights Foundry + Autonomous Contracting

Adds governed right templates, novel right-type governance, conserved rights transformation, exclusivity, rights-genesis min-cut analysis, and proof-bound atomic autonomous contracts that emit matching rights and obligations into Rights Runtime state. See `RIGHTS-FOUNDRY-v1.5.md`.


## v1.7 — Constitutional Market & Coordination Runtime

Adds explicit clearing domains, bounded netting rights, collateral authority/encumbrance, default and closeout semantics, systemic contagion analysis, and replay-protected inter-institution settlement proofs. **Conformance: 289 passed.** See `CONSTITUTIONAL-MARKET-v1.7.md`.
