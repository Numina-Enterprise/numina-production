# Numina Control Room — Parallel Research Integration Gate

Status: PROPOSED / NOT RELEASED
Date: 2026-11-07
Scope: research-only integration; no plant controls, enrichment-process optimization, production activation, or financial transfers.

## Parallel workstreams
| Workstream | Inputs | Acceptance | Current status |
|---|---|---|---|
| Quantum / Genesis | research results, signed manifests | independent key verification, canonical encoding, dual signatures | unverified |
| Fusion / Plasma | reproducible datasets | units, uncertainty, independent validation | unverified |
| HALEU / SMR | fuel-eligibility profiles and supplier evidence | fail closed for operational-readiness claims without authenticated evidence | unverified |
| Natrium / TerraPower | non-proprietary energy/storage scenarios | bounded grid-level simulations; technology-specific safety evidence | unverified |
| Gas / Fracturing | aggregate site production and electrical loads | emissions and fuel balance tests | unverified |
| Batteries / Grid | demand and storage profiles | conservation, SOC bounds, reproducible dispatch | unverified |
| Infrastructure / CI | repository test harness | clean checkout, tests and artifact hashes | unverified |

## Mandatory gates
1. Treat uploaded or locally generated ZIPs as untrusted until source hashes, tests, and dependencies are independently checked.
2. Never infer regulatory approval, fuel custody, enrichment capability, or plant readiness from a simulation.
3. Enforce provenance: canonical manifest bytes, domain-separated Ed25519 signatures, independent Authority and Guardian keys, external trust anchors, revocation and validity checks.
4. Require source dataset identifiers, units, timestamps, reproducible commands, expected outputs, and verification results.
5. No automatic merge, production deployment, nuclear equipment commands, or treasury transactions.
6. A blocked gate remains BLOCKED, not PASSED, until evidence is supplied.

## Integration checklist
- [ ] Identify authoritative NUMINA-root source and package versions
- [ ] Inspect modules and dependency lockfiles
- [ ] Verify full test suite on a clean runner
- [ ] Reconcile fusion/SMR/gas/battery interfaces and units
- [ ] Check HALEU-dependent model gating
- [ ] Verify Genesis manifest signatures against independent pinned public keys
- [ ] Attach run logs, hashes, and scientific limitations
- [ ] Obtain release approval before merge or deployment
