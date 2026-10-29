# Conformance v0.1

Web release 0.2.0 · Implementation test specification · 2026-09-10

This suite tests the implemented demo protocol. It is separate from the original frozen 20 scenarios in the supplied Core v1.8 archive, and does not certify C1–C14 or financial safety.

## Run independently

Download `conformance.mjs` from this site's downloads directory and run with Node 24 or later:

```text
node conformance.mjs https://www.numinalabs.xyz
```

The harness downloads the explicitly public test issuer key, signs a fresh EAC with Node crypto, verifies it through HTTP, commits a simulated event, verifies its receipt signature independently, retrieves the receipt, checks replay rejection and signature tampering, and inspects coverage. It creates one test ledger entry and a small number of violation receipts per run. It never sends funds. A failure exits nonzero. Allow a minute between repeated runs to respect rate limits.

## Versioned vectors

`conformance-vectors.json` contains the pinned test public key, envelopes, explicit evaluation time and expected result/reason for 20 cases: valid; wrong environment; wrong audience; wrong action; wrong resource; wrong issuer; changed profile; expiry boundary; future validity; excessive lifetime; inverted window; issuance after activation; short nonce; unsupported version; extra field; fractional time; tampered signature; unknown key; wrong purpose; unsupported algorithm. Evaluate offline at each vector's supplied time. The live API uses its own clock and does not accept an evaluation-time override.

GET `/api/v0.1/conformance` returns the recorded build-time vector report, not a live test run or independent certification. The report links the vectors and external harness. The release manifest records the Worker SHA-256.

## Repository checks

Run `node scripts/fixtures.mjs`, `npm run build`, and `npm test` with Node 24+. The additional regression tests cover canonicalization ambiguity, revoked keys, signature-bound fields, event and nonce uniqueness, HTTP transport limits, separate receipt signatures, missing dependencies, and rate-limit persistence. Tests use a real SQLite engine through a D1-compatible adapter. Live D1 and edge routing must also pass the external harness after deployment.

## Required remaining assurance

Full hosted C1–C14 enforcement, parity beyond the exposed adapter functions, independent security review, sustained load/abuse testing, disaster recovery rehearsal, remote alert delivery and comprehensive external bypass detection are not established by this suite. Public deployment status and actual live checks are reported separately.

## Core v1.8 source audit

All 309 supplied test cases passed locally using unittest plus zero-argument assertion functions and a narrowly checked pytest.raises adapter. Pytest itself was unavailable and its installation was blocked by network policy. No source test was rewritten. All 104 present manifest entries matched; two listed Python bytecode cache files were absent. The adapter also verifies a Python-signed 10^18-quantity EAC and rejects a one-unit signature mutation. Margin arithmetic is checked against the original v1.8 examples. Neither this audit nor source hashes establish independent certification.
