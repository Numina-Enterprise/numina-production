# Apple signing evidence — 16 September 2026

## Compiled input integrated

- Application: **4.0.0, build 5**, bundle `xyz.numinalabs.app`.
- Source commit: `c6ffbb50d77ff53323b71b7048872637677e6b42`.
- Successful unsigned build: [35158998398](https://github.com/skott34-dot/numina-production/actions/runs/35158998398).
- Selected input in `docs/native-package-record-v4.json`: `numina-4.0.0-ios-build5-c6ffbb5-unsigned-app.zip`.
- Artifact SHA-256: `23e953860f7ec71937666a0fe543613bc4762fab4abd9da0fc59def92334425e`.
- Current and compiled native source fingerprint: `85775b4254ba63eee0709738a842dcffb95746caaf671472d75fb3dbf00e1da0`.
- Current source identity check passes. The current build is compiled, unsigned and selected for signing; historical build 3 is not the signing input.

## Signing and enrollment outcome

[Signing run 35160378703](https://github.com/skott34-dot/numina-production/actions/runs/35160378703) failed with **Required Apple signing secrets are not configured.** The workflow did not produce a signed IPA.

The authenticated Apple organization enrollment flow subsequently displayed **“Contact us to continue your enrollment. You’ve exceeded the maximum number of attempts. Please contact us.”** Apple support case **102965682708** is confirmed. Enrollment has not completed. No enrolled Apple team, distribution certificate, provisioning profile, signed IPA or App Store submission is established by these actions.

GitHub repository settings inspection found the existing encrypted release signing vault, but none of the three Apple-specific secrets or the Apple Team ID variable. The required configuration is:

| GitHub setting | Required value |
| --- | --- |
| Variable `NUMINA_APPLE_TEAM_ID` | Verified Apple-issued 10-character Team ID |
| Secret `NUMINA_APPLE_DISTRIBUTION_P12_BASE64` | Base64 of the Apple Distribution certificate with its matching private key in PKCS#12 format |
| Secret `NUMINA_APPLE_DISTRIBUTION_P12_PASSWORD` | Nonempty password for that PKCS#12 |
| Secret `NUMINA_APPLE_PROVISIONING_PROFILE_BASE64` | Base64 of the matching, unexpired explicit App Store profile for `xyz.numinalabs.app` |

## Remaining steps and validation

1. Resolve the enrollment attempt limit through support case **102965682708**, then complete enrollment and required agreements.
2. Confirm the team's identity, bundle registration and access to the retained CSR's matching key. Obtain the Apple Distribution certificate and matching App Store profile; configure the four GitHub settings through their secure interfaces.
3. Run the existing signing workflow on `main`. Validate its certificate/profile match, team, bundle ID, profile expiry, current build identity, input hash and code-signature result. Retain the signed IPA, its SHA-256 and `signing-result.json`.
4. Record App Store validation, upload or review outcomes only after performing those separate operations and obtaining their actual results.

This documentation correction changes only `mobile/signing/APPLE-SIGNING.md` and this evidence file. Both are outside the native source fingerprint scope defined by `scripts/ios-release.mjs`; no native build input is changed. Apple application signing does not sign a financial policy, authorize a wallet transaction or execute treasury operations.
