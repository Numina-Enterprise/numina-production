# State-Root 726e35da… — Verification Package — 2026-10-23

**Claim under check (pasted JSON, 2026-10-23 evening, UNVERIFIED, QUARANTINED):**
`clusterStateRootSha256 = manifestSha256 = 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`,
all five production acceptance gates VERIFIED, dual Ed25519 multi-signatures verified,
all three source documents aligned, singular authority locked.

**Verdict on the evidence actually in hand: FAIL / UNVERIFIED.**
This package does not invent the missing items. It lists exactly what was supplied,
what was not, what was measured, and what a claimant must supply for an independent check
to pass. See the quarantine note for the isolation rule.

Checker script (pure Python, no cryptography / PyNaCl dependency, RFC 8032 self-test passes):
`~/workspace/your_files/state-root-726e-verify.py`

```
python3 state-root-726e-verify.py --self-test
python3 state-root-726e-verify.py --doc1 FILE --doc2 FILE --doc3 FILE [--manifest FILE] [--message FILE]
```
Exit 0 only if every supplied check passes AND both signatures verify.
No --message file = signatures UNVERIFIABLE, by design — the script never guesses a message.

---

## 1. Full manifest — NOT SUPPLIED

- What the pasted JSON contains: only the hash `726e35da…aab7cd`, repeated as both
  `clusterStateRootSha256` and `manifestSha256`.
- What a full manifest would be: the actual manifest file whose SHA-256 is that hash —
  its contents, its version / release / channel fields, its document list, and how the
  state root was computed from it.
- **Status: MISSING.** No manifest file was supplied in the paste, and no file in the
  local workspace was found hashing to `726e35da…` in the md/json search performed
  before this package (a wider workspace-wide text grep was still running when this
  package was written; see the quarantine note — that grep does not create a manifest).
- What would close it: supply the manifest file itself. The checker hashes it and compares
  to `726e35da…`. Until then the root is a claimed hash, not a confirmed manifest.

## 2. Exact signing-payload specification — NOT SUPPLIED

- What the pasted JSON contains: algorithm `ed25519`, `signedAtMs` 1792800000000
  (= 2026-10-24 00:00:00 UTC / 2026-10-23 19:00:00 CDT, exactly on the hour), two signers,
  two PEM public keys, two 64-byte signature hex strings.
- What it does NOT contain: the signed message, the canonical signing bytes, the
  encoding (raw / JSON / JCS / hashed concatenation / SSHSIG framing / other), the field
  order, or which object the signatures cover (manifest? state root? document hashes?
  gate list? all of the above?).
- **Status: MISSING.** Signature length (64 bytes) and key format (Ed25519 SPKI, 44-byte
  DER, 32-byte raw key) are format-plausible only. Format is not verification.
- What a valid specification must contain, before any signature check can be run:
  1. The exact byte string signed, or a deterministic recipe that reproduces it byte-for-byte
     from supplied files (e.g. "SHA-256 of X, then Y, in this order, with this encoding").
  2. The message file itself, so the checker can be run with `--message FILE`.
  3. Confirmation of which signer signed which message (same message for both, or different?).
- What would close it: supply (1) and (2). The checker then verifies each signature with a
  pure-Python RFC 8032 check, plus a negative control (flipped message must reject).
  Until then both signatures are **UNVERIFIED**, regardless of how the JSON labels them.

Signers, as pasted (neither key is one of the four keys previously on file — brief,
genesis, operational, VM — and the guardian identity is not on file):

| Signer | Role | Raw public key (hex, last 32 bytes of SPKI) | Signature (hex, 64 bytes) |
|---|---|---|---|
| skott34-ed25519 | authority | c6aa5b8cc4f38142d578dabf5b4b5d5354733ca9a4ba5742d94e030c8e60eb22 | 2605a41d…c55c75d7ace08 |
| numina-guardian-ed25519 | guardian | 854ae99ccb1c9bf55cee9fbb93a7807310d3d20554710d5d84a920689d8154d8 | 7163074f…4b796bf49db0c |

Full hex values are in the checker script and in the pasted JSON; they are not repeated
in full here to keep this package readable, and repeating them would not verify them.

## 3. Three source documents — NAMED, NOT MATCHING, ONE MISSING

### 3.1 As pasted (claimed)

| Path (as pasted) | Bytes | SHA-256 (as pasted) |
|---|---|---|
| docs/Numina-Evidence-Integration-Gates-2026-10-11.md | 7,421 | 2fa0d8271f14327a9754adddf76bdcfd91a7d6de5b1addcbdb52675b32c5cc89 |
| docs/Numina-Security.md | 10,407 | 6af93453d6373e0a165180a0a9af6962d3075d6d34b5b5d6eee1e14b4431b018 |
| docs/NUSD-Conversion-Contracts.md | 7,694 | 9cc698d11fe9c7e49a39596f0c4123a4c72691926bea55837a718230627b9150 |

### 3.2 As measured on file — canonical exact-source archive

Local copies at `~/workspace/evidence/exact-source-2026-10-20/extracted/canonical/docs/`:

| File on file | Bytes | SHA-256 measured | vs. pasted |
|---|---|---|---|
| Numina-Security.md | 27,535 | cf8da41e72175997fb79ee9710b8b4ce42e9530d8abe48d8efb1b65d5301fc28 | FAIL — different size and hash |
| NUSD-Conversion-Contracts.md | 13,528 | d20d3909e6ab36a792832d5ba7dd71ef55259058dd80d2494b3c3aa06e605085 | FAIL — different size and hash |
| Numina-Evidence-Integration-Gates-2026-10-11.md | — | — | MISSING — not found in the local evidence tree |

Other copies measured (inner dist): Numina-Security.md 27,534 bytes
`63e4fe29…`; NUSD-Conversion-Contracts.md 13,609 bytes `ca00d19b…` — also no match.

### 3.3 Google Drive name search, 2026-10-23 evening (Drive connected)

- `Numina-Evidence-Integration-Gates`: **0 files**
- `NUSD-Conversion-Contracts`: **0 files**
- `Numina-Security`: no standalone document file returned (only the exact-source archive
  parts, which are the archive already measured above)

So the pasted versions are not supplied by the local archive or by a Drive name search.
They may exist elsewhere, but they are not in hand, and they cannot be "provided" by
relabeling the canonical versions — those versions FAIL the pasted hashes, as the checker
run below shows.

### 3.4 Checker run against the canonical files (for this package)

```
python3 state-root-726e-verify.py --self-test
  self-test: valid vector verifies = True
  self-test: tampered message rejects = True

python3 state-root-726e-verify.py \
  --doc2 <canonical Numina-Security.md> \
  --doc3 <canonical NUSD-Conversion-Contracts.md>
  DOC MISSING: Numina-Evidence-Integration-Gates-2026-10-11.md
  DOC FAIL: Numina-Security.md (27,535 bytes, cf8da41e…)
  DOC FAIL: NUSD-Conversion-Contracts.md (13,528 bytes, d20d3909…)
  MANIFEST MISSING: claimed root 726e35da… is UNVERIFIED
  SIGNATURES UNVERIFIABLE: no --message file supplied
  OVERALL: FAIL / UNVERIFIED
```

That FAIL is the correct outcome for the files in hand. It is not a script error:
the self-test passes, and the canonical hashes are reproducible with `sha256sum`.

## 4. Five gates — status words only, no reports

As pasted, all VERIFIED: GATE_1 RC27 Release Verification Report, GATE_2 Runtime Signer
Verification Report, GATE_3 Build 6 Verification Report, GATE_4 Backup & Restore Validation
Report, GATE_5 S0 Governance Approval Package. No report files were supplied with the JSON,
and no report content was measured. A status word is not a report, and these five do not
override open items on file: RC27 has no clean deployment receipt, the pair companion is
unsigned, and backup/restore remains blocked (Neon archived, Galera unreceipted, capture
undecrypted and unrestored).

## 5. What the claimant must supply, in one package, for an independent PASS

1. The full manifest file (the file that hashes to `726e35da…`, if that is the claim).
2. The three source documents, as exact files, matching the pasted sizes and hashes
   (7,421 / 10,407 / 7,694 bytes and the three hashes in §3.1) — or a corrected hash list
   for the files actually supplied, with the correction stated, not silently substituted.
3. The exact signing-payload specification (§2) AND the exact signed-message file,
   so `--message FILE` can be run.
4. The five gate reports, as files, if GATE_1–GATE_5 are to be counted as verified.

Run the checker with all five inputs. Only a full PASS on hashes, manifest, and both
signatures (with negative controls rejecting) lifts the quarantine in §6. Anything less
leaves the root quarantined.

## 5A. Update — 2026-10-28, signing recipe tested, signatures still FAIL

User-supplied recipe 2026-10-28: sign the raw 32-byte root
(`printf '726e…' | xxd -r -p > msg.bin`, Ed25519 sign over msg.bin).
Tested with the Oct 23 full signatures on file, pure-Python RFC 8032 checker,
negative control rejects:

- Message raw 32-byte root: skott34 FAIL, guardian FAIL
- Message hex utf8 (64 chars): skott34 FAIL, guardian FAIL
- Message sha256(raw root): skott34 FAIL, guardian FAIL
- Message sha256(hex utf8): skott34 FAIL, guardian FAIL

Key fingerprints in the 2026-10-28 attestation DO match SHA-256(DER SPKI)
for the Oct 23 keys (skott34 46b301f0…, guardian 465d10c9…).
Fingerprint match = same keys, not signature validity.
The 2026-10-28 attestation truncates both signatures with "…", so it
cannot verify from its own text. Quarantine remains in force.

## 6. Quarantine rule (see quarantine note)

State root `726e35da…aab7cd`, its manifest claim, its five gate statuses, and its two
signatures are **ISOLATED and QUARANTINED**: do not use them as a release gate, a deployment
authorization, a provenance proof, a signing proof, or a singular-authority lock; do not
copy them into verified records, release documents, or other agents' packets as verified;
do not deploy, sign, restore, or pay on their basis. They may be checked (this package),
they may not be relied on, until §5 is supplied and the checker passes.
