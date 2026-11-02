# Project 3: telemetry and provenance day-one testbed

Status: runnable **local simulation**. This directory contains no provider calls, command transport, deployment code, operational signing keys or financial actions. It changes no production core. It is not hardware-in-the-loop (HIL), a relevant-environment mission demonstration, an approval, or a performance commitment.

## Run

From the repository root, with Node 24 or later:

```sh
node --test tools/one-day/telemetry/telemetry.test.mjs
node tools/one-day/telemetry/benchmark.mjs 1200
```

Both commands are offline and dependency-free. A GitHub-hosted Node 26.13.0 job may run the same commands. Do not use a self-hosted runner or add production credentials. The benchmark accepts 30–100,000 generated observations. Standard output is a JSON report; redirect it to an evidence artifact when needed. No private key is serialized or saved.

## Implemented boundary

- `adapters.mjs`: bounded binary stream decoder and CCSDS header profile; STAC Item profile; sequence checks; canonical JSON serialization and `toCoreRecord` adapter.
- `provenance.mjs`: fixture principal/action policy and Ed25519 receipt signing/verification. Receipt signatures bind the run, ordered chain, normalized input, decision and test-key fingerprint.
- `fixtures.mjs`: deterministic generated packet/metadata fixtures, including an `example.invalid` asset URL that is never fetched.
- `telemetry.test.mjs`: positive and negative tests.
- `benchmark.mjs`: a reproducible sequential pipeline workload with measured timing, fixture/source hashes, a public test key, and three signed receipt examples.

The inspected production baseline is `Numina-Enterprise/numina-production@23c38e1e3a15e8f6559486ca024edb2faa3244cb`. Its `src/control.js` `normalizeRecord` accepts a `record:` resource and a bounded string payload. `toCoreRecord` produces that shape. Production reducer integration is **not tested or deployed** here; consumers must retain the existing authority checks before recording anything. This adapter's JSON serializer does not replace the production canonicalizer.

## Explicit protocol profiles

### CCSDS

The six-octet primary header and data-length-plus-one framing are derived from CCSDS 133.0-B-2, Issue 2, Editorial Change 2. This receiver deliberately supports only version-zero, unsegmented telemetry packets without secondary headers. APID 2047 idle packets, telecommands, segmentation and secondary headers are rejected. Payload bytes remain opaque. Default payload cap is 4,096 bytes; incoming chunks are capped at 65,536 bytes. There is no mission-specific CRC, link framing, packet authentication, secondary-header time decoder, or mission APID allocation.

Sequence continuity is checked per APID modulo 16,384. Forward gaps escalate; duplicate/older sequence values deny. This is a receiver test policy, not a requirement that transport never reorders. It cannot disambiguate replay across sequence-counter wraps or process restarts without a mission epoch/time rule. Its state is in memory for one run.

### STAC

The profile follows the OGC STAC 1.1.0 Item structure: Feature, identity, geometry/bbox, properties, links and assets. It accepts only 2D Point or null geometry; Point coordinates must lie within a bounded bbox. Null geometry prohibits bbox. UTC date-times or ordered UTC intervals are checked. Collection references must have collection links. It rejects extensions, non-HTTPS asset/link URLs and credentials in URLs. It never downloads links/assets.

This is a restricted ingestion profile, **not full STAC JSON-Schema or extension conformance**. Unsupported valid STAC geometries are deliberately rejected. The adapter accepts an already parsed plain JSON object; untrusted raw JSON needs a separately bounded parser that rejects duplicate member names before this interface. Decimal coordinate bytes are preserved through canonical serialization and hash binding; they do not enter treasury arithmetic.

## Policy and receipt interpretation

`ALLOW` means that a fixture observation passed this local policy. It does not authorize a real system action. A `tasking_proposal` always returns `ESCALATE` with no dispatch; unsupported actions and unknown principals deny. The benchmark intentionally mixes authorized observations, unauthorized identities and review-only proposals. Because unauthorized/proposal cases do not advance the telemetry sequence state, later sequence gaps can also escalate.

Each run generates an ephemeral Ed25519 test key in memory. It is visibly classified `LOCAL_SIMULATION` with `operationalAuthority: false`. That key is not Samuel's authority key, a KMS key, or a replacement runtime signer. The verifier uses a separately supplied test public key and expected run, rejects signature alterations, replay and reordered receipt chains, and never interprets the envelope's own key as an authority grant. Persistent replay enforcement and operational receipt storage remain outside this prototype.

## Evidence and remaining gates

`test-results.tap` and `benchmark-result.json` are observations of the current local run, not mission data. Source hashes in the benchmark identify the measured files; runtime, UTC observation time, workload size and fixture digest accompany timing. Results vary with host/load and include decoding, normalization, policy, signing and verification. No threshold is claimed as a mission requirement.

Before mission-environment acceptance: agree actual packet profiles and authorized datasets; provide mission-specific policy/normalizer bindings; integrate the approved operational signer without key extraction; add persistent replay/receipt storage; validate under representative load and failures; connect actual authorized hardware for any HIL claim; obtain mission-owner review. No solicitation, squadron acceptance, contract eligibility or Space Force endorsement is inferred.

## Primary sources checked 2026-11-02

- CCSDS Space Packet Protocol, 133.0-B-2 with Editorial Change 2: https://ccsds.org/Pubs/133x0b2e2.pdf (header, packet sizing and modulo sequence semantics; sections 4.1.2–4.1.3).
- OGC STAC Community Standard 1.1, 25-004: https://docs.ogc.org/cs/25-004/25-004.html (Item fields, temporal metadata and geometry/bbox rules).
- Inspected core contract: https://github.com/Numina-Enterprise/numina-production/blob/23c38e1e3a15e8f6559486ca024edb2faa3244cb/src/control.js (lines 35–39).

These sources establish wire/data contracts only. They do not establish operational readiness.
