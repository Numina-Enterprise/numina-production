# Numina Apple distribution signing

## Current signing input

The current-source unsigned application **4.0.0, build 5**, bundle `xyz.numinalabs.app`, is compiled and integrated into the signing path. `docs/native-package-record-v4.json` selects `numina-4.0.0-ios-build5-c6ffbb5-unsigned-app.zip`, produced by [build run 35158998398](https://github.com/skott34-dot/numina-production/actions/runs/35158998398) from source commit `c6ffbb50d77ff53323b71b7048872637677e6b42`. Its SHA-256 is `23e953860f7ec71937666a0fe543613bc4762fab4abd9da0fc59def92334425e`.

The current native source fingerprint matches the compiled input: `85775b4254ba63eee0709738a842dcffb95746caaf671472d75fb3dbf00e1da0`. The manual `numina-ios-signing.yml` workflow remains scoped to `main`; its script checks current-source build identity before accessing signing assets. Historical build 3 is retained as historical evidence and is not the selected signing input.

[Signing run 35160378703](https://github.com/skott34-dot/numina-production/actions/runs/35160378703) stopped with **Required Apple signing secrets are not configured.** No signed IPA was produced.

## Apple enrollment and credentials

The Apple organization enrollment flow stopped with **“Contact us to continue your enrollment. You’ve exceeded the maximum number of attempts. Please contact us.”** Apple support case **102965682708** is confirmed. Enrollment has not completed, and an enrolled team, distribution certificate and provisioning profile have not been established. The support case is an assistance request, not enrollment or signing approval.

The following GitHub repository settings remain required:

| Location | Exact name | Required value |
| --- | --- | --- |
| Actions variable | `NUMINA_APPLE_TEAM_ID` | Actual Apple-issued 10-character Team ID |
| Actions secret | `NUMINA_APPLE_DISTRIBUTION_P12_BASE64` | Base64 of the Apple Distribution certificate and matching private key exported as PKCS#12 |
| Actions secret | `NUMINA_APPLE_DISTRIBUTION_P12_PASSWORD` | Nonempty password protecting that PKCS#12 |
| Actions secret | `NUMINA_APPLE_PROVISIONING_PROFILE_BASE64` | Base64 of an unexpired explicit App Store distribution profile for `xyz.numinalabs.app`, matching the team and certificate |

Never substitute the Numina authority root for an Apple Team ID. Enter credentials through the authorized secrets interface; do not commit them or place them in logs.

## Next steps

1. Continue with Apple support case **102965682708** to resolve the enrollment attempt limit and complete the organization's enrollment and required agreements.
2. Verify the enrolled team's identity and the explicit bundle ID. Confirm access to the private key matching the retained CSR before obtaining its Apple Distribution certificate. The source records reference the existing encrypted `NUMINA_RELEASE_SIGNING_VAULT`; this documentation does not retrieve or replace its key.
3. Obtain the matching App Store distribution profile, export the certificate with its matching key as password-protected PKCS#12, and configure the four settings above.
4. Dispatch **Numina iOS distribution signing** on `main`. Retain the signed IPA and `signing-result.json`; verify the artifact hash, version/build, team, certificate fingerprint, profile UUID and code-signature result.

`../ios/Signing/` retains the CSR, manual-signing and export-options templates, and App Store handoff checklist. Its older statements that current build 5 lacks a compiled input are superseded by the current build record and this guide. See `../../release-evidence/apple-signing-2026-09-16.md` for the release evidence.

Signing does not upload the app or establish App Store approval or physical-device testing. Apple app-distribution signing is separate from financial policy signatures, wallet transactions and treasury execution. No enrollment, issued signing credentials, signed IPA or App Store submission is claimed here.
