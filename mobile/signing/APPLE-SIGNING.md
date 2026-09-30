# Numina Apple distribution signing

## Current signing input

Current source is **4.0.0, build 6**, bundle `xyz.numinalabs.app`. A matching compiled and signed artifact is not recorded. The main-branch `numina-ios-signing.yml` workflow compiles current source before the signing script checks its bundle identity and accesses signing assets.

The retained `numina-4.0.0-ios-build5-c6ffbb5-unsigned-app.zip` was produced by [build run 35158998398](https://github.com/skott34-dot/numina-production/actions/runs/35158998398) from source commit `c6ffbb50d77ff53323b71b7048872637677e6b42`. Its SHA-256 is `23e953860f7ec71937666a0fe543613bc4762fab4abd9da0fc59def92334425e`; its compiled input fingerprint is `85775b4254ba63eee0709738a842dcffb95746caaf671472d75fb3dbf00e1da0`. It is historical build 5, does not match current build 6 source, and is not a valid signing input for the current release. `docs/native-package-record-v4.json` preserves this distinction and the current source fingerprint.

[Signing run 35160378703](https://github.com/skott34-dot/numina-production/actions/runs/35160378703) stopped with **Required Apple signing secrets are not configured.** No signed IPA was produced.

## Apple enrollment and credentials

The earlier Apple organization enrollment flow reached an attempt limit and support case **102965682708**. The owner subsequently reported Developer registration complete and certificate issuance. Those owner statements are retained in `release-identities.json`; current Apple membership, Team ID, usable distribution certificate with its matching private key, and provisioning profile remain provider-unverified. The support case and owner statements do not establish a usable signing environment.

The following GitHub repository settings remain required:

| Location | Exact name | Required value |
| --- | --- | --- |
| Actions variable | `NUMINA_APPLE_TEAM_ID` | Actual Apple-issued 10-character Team ID |
| Actions secret | `NUMINA_APPLE_DISTRIBUTION_P12_BASE64` | Base64 of the Apple Distribution certificate and matching private key exported as PKCS#12 |
| Actions secret | `NUMINA_APPLE_DISTRIBUTION_P12_PASSWORD` | Nonempty password protecting that PKCS#12 |
| Actions secret | `NUMINA_APPLE_PROVISIONING_PROFILE_BASE64` | Base64 of an unexpired explicit App Store distribution profile for `xyz.numinalabs.app`, matching the team and certificate |

Never substitute the Numina authority root for an Apple Team ID. Enter credentials through the authorized secrets interface; do not commit them or place them in logs.

## Next steps

1. Verify the owner-reported completed registration against the actual Apple membership, seller identity and required agreements. Use Apple support case **102965682708** if the earlier enrollment block remains unresolved.
2. Verify the enrolled team's identity and the explicit bundle ID. Confirm access to the private key matching the retained CSR before obtaining its Apple Distribution certificate. The source records reference the existing encrypted `NUMINA_RELEASE_SIGNING_VAULT`; this documentation does not retrieve or replace its key.
3. Obtain the matching App Store distribution profile, export the certificate with its matching key as password-protected PKCS#12, and configure the four settings above.
4. Dispatch **Numina iOS distribution signing** on `main`. Retain the signed IPA and `signing-result.json`; verify the artifact hash, version/build, team, certificate fingerprint, profile UUID and code-signature result.

`../ios/Signing/` retains the CSR, manual-signing and export-options templates, and App Store handoff checklist. See `../../release-evidence/apple-signing-2026-09-16.md` for the historical build 5 signing attempt; it does not establish current build 6 compilation or signing.

Signing does not upload the app or establish App Store approval or physical-device testing. Apple app-distribution signing is separate from financial policy signatures, wallet transactions and treasury execution. No enrollment, issued signing credentials, signed IPA or App Store submission is claimed here.
