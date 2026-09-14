# Numina Apple distribution signing

The current signing handoff is `../ios/Signing/README.md`. It contains the retained CSR, manual-signing configuration template, export-options template, required-input record and App Store handoff checklist.

The Apple Team ID and certificate/profile remain unverified here. User-reported Developer registration is recorded separately from Apple-issued signing credentials. Never substitute the Numina authority root for an Apple Team ID.

The existing `numina-ios-signing.yml` workflow remains manual and scoped to main. Its signing script now rejects a historical or uncompiled current-source input before accessing signing assets. The retained unsigned build 3 is not the current build 5 and must not be signed or relabeled as that update.

Prepare a freshly compiled current-source archive, verify its build identity and evidence, then deliberately integrate that artifact into the signing path. Do not dispatch the legacy job expecting the old recorded bundle to become the new native application.

Repository variable: `NUMINA_APPLE_TEAM_ID`.
Repository secrets: `NUMINA_APPLE_DISTRIBUTION_P12_BASE64`, `NUMINA_APPLE_DISTRIBUTION_P12_PASSWORD`, `NUMINA_APPLE_PROVISIONING_PROFILE_BASE64`.

No private key, certificate issuance, account enrollment, provisioning profile, IPA, App Store upload or approval is produced by this documentation.
