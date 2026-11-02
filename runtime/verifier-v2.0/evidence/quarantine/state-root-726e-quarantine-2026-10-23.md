# QUARANTINE — State Root 726e35da… — 2026-10-23

**Quarantined value (full):**
`726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`

**Quarantined with it:** the pasted productionAcceptanceGates JSON that carried it
(GATE_1–GATE_5 all "VERIFIED"), its two Ed25519 signatures (skott34-ed25519, authority;
numina-guardian-ed25519, guardian), its three claimed document hashes, and its
"singular authority locked" claim.

**Status: ISOLATED. DO NOT USE. DO NOT RELY ON. DO NOT DEPLOY / SIGN / RESTORE / PAY ON IT.**

## Why it is quarantined

1. The three claimed document hashes do NOT match the canonical copies on file
   (Numina-Security.md and NUSD-Conversion-Contracts.md both FAIL on size and hash;
   Numina-Evidence-Integration-Gates-2026-10-11.md is not found in the local evidence tree
   or in a Google Drive name search).
2. No manifest file was supplied — only the hash, repeated as both clusterStateRootSha256
   and manifestSha256.
3. No signing-payload specification and no signed message were supplied — both signatures
   are format-plausible (64 bytes, Ed25519 keys) but UNVERIFIABLE from the JSON alone.
4. The five gates are status words only; no gate reports were supplied.
5. Neither signer key is one of the four keys previously on file (brief, genesis,
   operational, VM); the guardian identity is not on file.

## Isolation rules

- This hash, its gates, and its signatures must NOT be copied into verified records,
  release documents, Agent Brief, or other agents' packets as verified.
- They must NOT be used as a release gate, deployment authorization, provenance proof,
  signing proof, or authority lock.
- They MAY be checked, using `~/workspace/your_files/state-root-726e-verify.py` and
  `~/workspace/your_files/state-root-726e-verification-package-2026-10-23.md`.
- They may be LIFTED from quarantine only if the claimant supplies, in one package:
  the full manifest file, the three exact source documents matching the claimed hashes
  (or a stated correction), the exact signing-payload specification plus the exact
  signed-message file, and the five gate reports — AND the checker passes on all of them,
  including negative controls.
- Quarantine is not deletion and not an accusation about the value's origin. It is a
  holding state: unverified claims are kept separate from verified records until a
  check passes.

## Search note (at time of writing)

- md/json search of the local workspace for this hash: no matches found before this note.
- A wider workspace-wide text grep for this hash was started 2026-10-23 ~22:48 CDT and
  was still running when this note was written. That grep, when it finishes, can add
  "found in X" or "not found workspace-wide" to this note — it does not, by itself,
  verify the hash, lift the quarantine, or supply a manifest.
- The hash appears in this quarantine note and in the verification package by design:
  that is the isolation record, not a use of the hash as a gate.

## Owner action that created this quarantine

Owner direction, 2026-10-23 evening: "We need to isolate and quarantine the 'state root'
726e35da" — recorded and executed here. The owner's later direction in the same evening
to provide the manifest / signing-payload specification / three source documents is
answered by the verification package above: those items are NOT in hand (see §1–§3 of
that package), and this quarantine stays in place until they are supplied and checked.
