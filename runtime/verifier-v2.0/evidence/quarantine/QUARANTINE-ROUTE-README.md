# Quarantine evidence route — DO-NOT-USE

**This folder is isolated evidence only. It is not live code, not a
cluster root, not a verification root, and not to be imported by V2.0.**

Contents (copied verbatim from local records):

- `state-root-726e-quarantine-2026-10-23.md` — quarantine note, Oct 23 2026.
- `state-root-726e-verification-package-2026-10-23.md` — verification
  package, Oct 23 2026 (with Oct 28 2026 updates in that file).
- `state-root-726e-verify.py` — pure-Python RFC 8032 checker, Oct 24 2026.

The quarantined root itself appears in these evidence files, as it must
for the evidence to be intelligible. That appearance does **not** make it
a live root, and it does **not** lift the quarantine.

Rules for this folder:

1. Never import, call, or reference these files from live V2.0 code.
2. Never use the quarantined root as a cluster root, verification root,
   signing root, or authority proof.
3. Never delete this folder to "clean up" the quarantine — preservation
   is the point of an evidence route.
4. Any future V2.0 version that needs to cite the quarantine must cite
   this folder, labeled DO-NOT-USE, not copy the root into live code.

Live-code scans (`scripts/scan-v2.py`) exclude this folder from the
live-code count and report its presence separately, so a scan result of
"0 live occurrences" remains true while the evidence route is preserved.
