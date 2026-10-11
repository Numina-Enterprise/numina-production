# Ed25519, a Universal Companion Model — evidence update

Prepared 10 October 2026, America/Chicago; final verification captured 11 October 2026 UTC. This update records recovered signing evidence, fresh bounded NCPS proof checks, the official Internet-Draft record and observed cloud setup paths. The Numina tree remains the singular source of record. Original signed payloads, signature files, ZIPs and the supplied manuscript are retained unchanged. This dated addendum supplies the current evidence status alongside the original manuscript's historical statements.

## Recovered signing evidence

The original `Numina-v161-operational-observation-binding-2026-10-09.zip` was recovered from the connected Mac. Its 19,783 bytes and SHA-256 `e999eff016e49fe789504f62cd3dda5a5aa66a824fb918eb4d49fced506f2a37` exactly match Appendix Q.1 of the supplied manuscript. The earlier review's statement that this package was unavailable describes the earlier review capture; it is superseded for the current delivery by this recovery.

Both detached Ed25519 signatures verify over the unchanged payload file bytes:

| Signed payload | Bytes | Result |
| --- | ---: | --- |
| `publication-observation.json` | 6,763 | Signature verified |
| `v161-observation-binding-manifest.json` | 23,310 | Signature verified |

All 11 listed file checksums pass. All four one-byte payload/signature mutations are rejected. The observation exactly matches `release-evidence/deployment-2026-10-09/publication-observation.json` in the Numina production tree. The binding manifest preserves all 19 checked provenance values, including canonical source, delivery source, build, archive and saved publication records.

The original `PairWireRecovery-Ed25519-signed-public-2026-10-09.zip` was also recovered intact: 13,846 bytes, SHA-256 `889aa0f181e587e7b4a2acf1e056b5171794b0040c1f5da13f7c006c76029659`. Its exact `PairWireRecovery.lean` source (5,568 bytes) and `Hello_Ed25519.test.txt` (13 bytes) each have a valid detached Ed25519 signature. All four one-byte mutation controls are rejected.

These four recovered signatures use the raw 32-byte public key with SHA-256 `b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f`. This matches the operational public-key identity reported by the manuscript. The historical runtime public-key pin and key ID `3a2fe594a7e10458ae89683f` remain preserved. No new signature, key replacement or private-key export was performed during recovery.

## Source and publication binding

| Retained identity | Value |
| --- | --- |
| Canonical source commit | `d1b1cd852927052b54af2b540b031d77311ccecf` |
| Delivery source commit | `76a08b2d54679238416ee87818732ac441c5f933` |
| Saved Sites version | 161 |
| Recorded publication status | Succeeded |
| Observation SHA-256 | `949cbb6d637fde547a95b40d6fa8c54b5af510effed38c74f1c9f25c37131733` |
| Binding manifest SHA-256 | `9fa4860cbad5e28e0e3f3c31feccdd9127092b7dc6694ecd3a7ed68fd72d9f8e` |

The retained local gzip-tar archive was independently rehashed and matches `555c9285eb6baae123bae0de81cf90f53ed000c3e2c3013d667c77b295b9f642`. The provider-reported stored tar digest identifies a different archive representation; provider tar bytes were not independently recovered and hashed. The signatures authenticate historical evidence statements, with their original observation times and limitations. A new runtime health observation was not performed.

Fresh authenticated provider readback separately confirms version 156 publication succeeded and binds it to source commit df099d3ae4952a9966cf3b9e4ef299626dc7d338. The unchanged historical production-pair digest function reproduces source 1 as 1bf43817cf470abb868074a76598cb5f360517d7255b92ab3b409c6b545ec66b and source 2 as 1a17f584e23279684574022f39e533966ad09919f484e005c03948178a46aa0a. All four inspected LIVE/FRONTIER_FINAL cells match. Exact selected source files and the digest program are preserved with the new verification report. This verifies the historical software projection and publication metadata at their stated scopes, not whole-release compliance or companion acceptance.

The specifically requested final-deployment-receipt artifact was not observed in checked canonical history or the scoped Mac files and archive inventories. The unsigned nUSD blockchain receipts have different subjects. The recovered signed version 161 observation is retained separately and is not substituted as a version 156 receipt. Provider archive bytes and present runtime health remain unchecked.

## Cloud setup and observed build path

The setup script is `/workspace/numina-cloud-setup.sh`. Its production source path is `/workspace/numina-production`. Its Node gate is:

```sh
test "$(node -p 'process.versions.node.split(".")[0]')" = 24
```

Fresh read-only inspection reports Node `v24.19.0`; the major-version gate passes. The saved pointer `/workspace/.numina-build-path` currently contains `/workspace/numina-build-lw2a35jy`. The script creates a temporary build directory, copies source files and links its `.git` directory to the production repository's `.git` directory. Each future invocation can produce a different temporary build path; the saved pointer records the selected path.

The currently retained build directory contains an earlier source snapshot. Its `package.json`, `public/runtime-contract.js` and `src/application-release-contract.js` differ from the current production files. Because its Git metadata is shared with production, a matching reported Git HEAD does not establish matching working files or a fresh current build. This update records inspection of the script and Node gate; it does not report a new execution of its dependency installation, build, tests or release packaging.

The setup script's inspected SHA-256 is `a88ac44e0436e7cd53d5a2ebbd153d2552990e28d45519011dcabbaa36a0b5b5`.

## Manuscript and signature coverage

The supplied original manuscript remains 104 pages and 404,249 bytes, SHA-256 `4b22068f0df2ff2d9b2b3084941ecada40b9915b68ededf4126db6e56671b03b`. The user reports that the manuscript is already signed. Its own existing detached signature has not been recovered for fresh verification. This does not establish that no external manuscript signature exists.

The recovered signatures cover the two deployment payloads, the exact PairWire source and the exact Hello Ed25519 test. They do not inherit to edited manuscript bytes, this addendum, verification reports or a new delivery ZIP. The appended PDF is a separately identified updated document, with the original manuscript retained separately. Its final SHA-256 commitment is recorded in the delivery manifest. New detached signing evidence, when present, must be checked against that exact manifest and checksum list using the included public verifier; it does not become the original manuscript's missing signature.

Numina's singular companion model, source ordering and existing signing domains are preserved. Operational companion authorization, current revision/revocation evidence, authenticated private-reference resolution, and adoption of the signature-acceptance policy remain open at their previously stated scopes. This evidence update does not claim whole-protocol acceptance or a new site deployment.

## Retained verification records

The final delivery includes new detached pure Ed25519 signatures over the final PDF, the preserved original PDF, every included text document and program, the delivery manifest and the checksum list. The existing operational key is reused; no substitute signing key is introduced. The signed inventory also binds every included binary supporting artifact by exact SHA-256. The final signing receipt identifies this new event, its exact signed bytes and the verified mutation controls. These are operational delivery signatures, not an embedded PDF signature, a private companion-wire acceptance, provider attestation or IETF approval.

Both original signed ZIPs, their public keys and original receipts remain intact. Four recovered historical signatures and eight historical mutation checks pass. The fresh verification reports, source snapshots, original manuscript and this separately identified final PDF are retained alongside them. The new signatures are separately dated and do not replace or retrospectively verify the user's reported earlier manuscript signature.

## Fresh NCPS proof verification and assumptions

The retained NCPS-Lean4-Proofs-2026-10-09 source bundle was freshly compiled in an isolated scratch copy on the connected Mac with native Lean 4.22.0, commit ba2cbbf09d4978f416e0ebd1fceeebc2c4138c05, and trust level 0. All 12 compilation units passed. All 131 named theorem declarations were independently checked with Lean's axiom printer; the source and audit name sets match exactly. There are no custom axioms, sorryAx, omitted theorems or extra audit names. All 18 original manifest entries match, all ZIP members match the retained sources, and originals are unchanged.

The disclosed foundational dependencies are propext on 60 theorems, Quot.sound on 22, and Classical.choice on 2. These are separate from explicit theorem hypotheses: generic codec results assume roundtrip; implementation agreement assumes conformance; refinement requires initial-state, step-preservation and safety premises. The concrete codec is an illustrative binary codec, not RFC 8785 JCS. Modeled acceptance flags do not establish external signature, authority, freshness or deployment evidence. The UTF-8 boundary relies on Lean's String.fromUTF8? and does not prove a complete JSON parser.

The exact proof ZIP is 22,789 bytes, SHA-256 62b3607544daeb524fb82ad60c7442eb9281f9cfb1862029fc716cfd5a14954e. The fresh compilation and kernel-audit report, complete assumption review and source-search record are included in the final delivery. This is a bounded proof PASS; whole-protocol correctness remains unestablished.

This recovered Lean 4.22.0 bundle is distinct from the manuscript's reported Lean 4.24.0 corrected and structural packages. Those exact Appendix Q sources were not located in the checked Documents/Numina directory, either retained temporary proof tree or the inspected proof archive. Their historical results are preserved as reported evidence and are not relabeled as this fresh rerun.

## Official Internet-Draft and Independent Stream check

The official Datatracker record lists draft-kott-numina-pair-binding-01 as an active individual Internet-Draft, updated 8 October 2026, with revisions 00 and 01. It records no RFC stream and no stream state; the IESG state is I-D Exists. The local revision 02 PDF is a separate manuscript, not the posted revision shown in this check.

Independent Stream submission or acceptance is not established by the checked record. A separate authenticated ISE receipt or decision was not recovered. The RFC Editor procedure requires an additional submission template and editorial review; public draft posting alone does not complete that process. No ISE submission or publication was performed during this verification. Operational delivery signatures authenticate the evidence package and its byte commitments; they are not IETF or ISE approval.

Official sources checked: https://datatracker.ietf.org/doc/draft-kott-numina-pair-binding/ and https://www.rfc-editor.org/authors/rfc-independent-submissions/. The final delivery retains a dated public-status report with these sources and the observed fields.
