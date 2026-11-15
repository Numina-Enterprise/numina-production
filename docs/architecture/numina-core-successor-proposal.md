# NUMINA Core successor — forward development authorization proposal

Status: REVIEW ONLY. Not an approved release, production unfreeze, or cryptographic re-signing.
Date: 2026-11-15

## Core distinction
The historical verifier v1.8 and v2.0 frozen manifests remain immutable and must continue verifying. The proposed successor is a separately versioned core candidate, not an edit to archived evidence.

## Advancement gates
1. Record baseline manifests, digests, source revisions and current runtime evidence.
2. Design the successor under a new versioned namespace with isolated tests and explicit migration mapping.
3. Re-run legacy frozen-source verification without exemptions.
4. Run candidate tests, regression, compatibility, policy, security and rollback checks.
5. Produce new signed release evidence under existing Authority + Guardian rules.
6. Require independent review and explicit release approval before promotion.

## Runner v15 authorization
The proposed runner policy retains the 44-declaration baseline, permits exactly one newly named pinned hosted workflow, and rejects all unlisted additions. Self-hosted execution and scheduling remain denied. No blanket policy disable is intended.

## Evidence boundary
This document and the associated policy change are committed source only. They do not prove CI pass, core activation, deployment, signing, or a production runtime change.
