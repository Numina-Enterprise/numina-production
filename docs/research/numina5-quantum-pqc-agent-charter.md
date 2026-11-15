# Numina 5 — Quantum/PQC Research Agent Charter
Date: 2026-11-15 | Status: RESEARCH ONLY | Branch isolated from inference and production

## Mission
Develop an evidence-backed, migration-safe post-quantum provenance design for Numina 5. Do not block real GGUF generation or alter production signing policy.

## P0: Hybrid provenance design
- Inventory existing Ed25519 RFC 8032 signatures, RFC 8785 canonicalization, domain separation, Authority+Guardian 2-of-2 custody, receipt verifiers, and signing boundaries.
- Specify a versioned hybrid receipt envelope binding Ed25519 and FIPS 204 ML-DSA-65 signatures to exactly the same canonical, domain-separated bytes; distinguish algorithm identifiers, public-key IDs, signing context, and migration policy.
- Retain separate Authority and Guardian approvals. Hybrid signatures do not replace the 2-of-2 authority policy.
- Establish fail-closed verification for hybrid-required receipts, downgrade resistance, tamper tests, algorithm-confusion tests, known-answer vectors, and legacy Ed25519 verification under explicit legacy policy.
- Assess FIPS 203 ML-KEM only for key establishment use cases; do not confuse encryption/key exchange with signing.
- Document key generation, hardware custody support, rotation, revocation, auditability, verification library provenance, and fallback/rollback. No production key issuance or rotation.

## P1: Quantum research
- Benchmark classical quantization/compression and scheduling baselines before evaluating quantum-inspired alternatives.
- Any QPU experiment must have a defined workload, resource budget, measurement method, cost, and classical comparator. Do not represent quantum hardware as GGUF acceleration.
- The reported 7.05 remaining RUs is an unverified capacity claim; identify provider, account, unit meaning, expiration, and authorization before allocating or consuming any RUs. No billable experiments without approval.

## Acceptance evidence
Report branch/commit, design and threat model, test vectors, commands and results, verification of canonical bytes, measured performance, known limitations, citations to primary standards, and owner approval gates. Label VERIFIED, TESTED WITH MOCKS, PENDING, or BLOCKED.

## Boundaries
Read-only architecture/research and isolated test code only. Do not merge, deploy, alter access, change live signing requirements, move funds, or spend quantum service credits without approval. Coordinate interfaces with Agent Beta; do not modify the real-GGUF inference branch.
