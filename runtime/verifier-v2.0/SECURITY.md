# V2.0 security — safeguarded and secured

## 1. No secret values

- No secret values, tokens, private keys, passwords, or credential values
  anywhere in V2.0.
- Secret **reference names only** (e.g. GCP secret-manager reference paths,
  environment variable names). A reference name is not a value.
- Any demo / mock keys are clearly labeled MOCK / TEST ONLY and are not
  usable as real credentials. Mock webhook secrets and mock tokens that
  previously embedded a fragment of the quarantined root were replaced
  with plain `MOCK_ONLY` labels in this merge.
- If a scan finds a value that looks like a real secret, treat V2.0 as
  unfit to push until it is removed and the manifest is regenerated
  (which creates a new version, per the freeze rule).

## 2. Fail-closed by default

- Dry-run / read-only gates are preserved verbatim in the financial code:
  - Connector mode `READ_ONLY`; any other mode throws
    `CONNECTOR_MODE_MUST_REMAIN_READ_ONLY`.
  - `SettlementRailConnector.submitTransfer()` throws
    `DRY_RUN_REJECTED_BY_GATE`.
  - `allowSettlementSubmission` is forced `false`; NCUA submission is
    disabled (`submissionEnabled: false`).
- Any settlement, mint, transfer, or redemption attempt fails closed
  unless explicitly authorized in a **separate, documented step** — which
  is **not** part of V2.0. V2.0 itself authorizes nothing.
- Python verifier semantics are observation-only where stated in v1.8
  (measurement cannot mint or mutate authority); V2.0 does not change
  that semantics.

## 3. Integrity

- `FROZEN-CORE-V2.0.sha256` lists every V2.0 file (except itself and
  except `sign-and-bind/`, whose own hashes are recorded inside that
  package). Run `python3 scripts/verify-manifest.py` — it reports any
  file changed, missing, or added since the manifest.
- `AUDIT-LOG.md` records every merge change: source, destination, and
  transformation. If a file is not in the audit log, it was copied
  unchanged (except for the cluster-root replacement, which is logged
  per file).
- A changed file after freezing does **not** get a quiet manifest update.
  It gets a new version.

## 4. Access — who may change V2.0

- **Only Samuel J. Kott may change frozen V2.0, and only by creating a
  new version.** No other person, agent, or system may edit frozen V2.0
  in place.
- Changes go through review: manifest verification, secret scan,
  personal-data scan, quarantined-root scan (live code), and test
  results, all recorded before any push.
- A push to the public repo must be reviewed for secrets, personal
  data, and quarantined-root references **before** it happens.
  **Do not push V2.0 yet** — this package is local only.

## 5. Personal data

- No phone numbers, emails, or account identifiers were added in V2.0.
- Identifiers already public in the source repo (e.g. GCP project
  reference names, key-ring reference names) remain as reference names
  only, not as credential values. No new personal data was introduced.
- The Stripe test account identifier that was hard-coded in the source
  financial config is retained as-is because it was already public in
  the source repo; it is a test-environment identifier, not a secret,
  and V2.0 does not use it to make any live call. If the owner wants it
  redacted in a future version, that is a new-version change.

## 6. Quarantined root

- Still quarantined. Still DO-NOT-USE as a cluster root or verification
  root. Preserved only as isolated evidence in `evidence/quarantine/`.
- Live code must contain zero occurrences of the quarantined root.
  `scripts/scan-v2.py` enforces this (evidence folder reported
  separately, not counted as live code).
