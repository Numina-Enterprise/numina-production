# Numina iOS signing handoff

Prepared for application 4.0.0, iOS source build 5, runtime 1.9.0-rc27, core 1.8.0.
These documents configure a future signing operation. They are not an Apple certificate, a provisioning profile, a signed IPA, or an App Store receipt.

## Included documents

- `Numina-Distribution.certSigningRequest`: exact copy of the existing owner-approved CSR. Its request self-signature was verified locally; no key was replaced and Apple issuance was not verified.
- `Numina-Signing.xcconfig.template`: explicit manual-signing override. Copy beside the template as `Numina-Signing.local.xcconfig` and fill the actual Apple Team ID and profile name.
- `ExportOptions.plist.template`: export-only App Store Connect configuration. Fill the same team/profile values; automatic version/build changes are disabled. Confirm the options with the selected Xcode's `xcodebuild -help` before use.
- `signing-inputs.json`: missing provider values remain null, with separate CSR and enrollment observations.
- `APP-STORE-HANDOFF.md`: release-review items not established by code signing.

## Certificate and profile

Verify the legal entity and Team ID in Apple Developer membership. Confirm that `xyz.numinalabs.app` is the actual App Store Connect bundle identifier before registering or changing an app. A reported registration alone is not certificate/profile evidence.

Use the retained CSR for an Apple Distribution certificate only after confirming access to its matching private key. The existing source record references the encrypted `NUMINA_RELEASE_SIGNING_VAULT`; this work did not access it. An issued certificate without that matching private key cannot produce the intended signature. Do not generate another CSR merely to fill a missing file; coordinate any deliberate key rotation separately.

Using the authorized Account Holder/Admin account, select the matching explicit App ID and distribution certificate to generate and download an App Store Connect profile. Use the actual profile name and Team ID in both templates. Never treat the Numina authority root hash as an Apple Team ID.

## Signing-secret placement

Repository variable: `NUMINA_APPLE_TEAM_ID`.
Repository secrets: `NUMINA_APPLE_DISTRIBUTION_P12_BASE64`, `NUMINA_APPLE_DISTRIBUTION_P12_PASSWORD`, `NUMINA_APPLE_PROVISIONING_PROFILE_BASE64`.
Export the Apple-issued certificate together with its matching private key as password-protected PKCS#12. Put its base64 representation and profile base64 directly into the authorized secrets interface. Base64 is encoding, not encryption. Do not paste secrets into chat or commit them. Keep certificates/keys in the intended secure signing host/keychain; use transient CI keychains with cleanup.

## Fresh build requirement

The tracked unsigned bundle is historical build 3 and cannot represent current build 5. The signing script now rejects stale or uncompiled current-source inputs. Create and validate a fresh Xcode archive of the committed source before signing or exporting. Do not alter an old Info.plist to manufacture a current release.

Use Xcode 26 or later with iOS SDK 26 or later for the current App Store Connect upload requirement. The app deployment target remains iOS 15. A current SDK requirement does not itself require dropping support for iOS 15.

For a manual Mac workflow, open `Numina.xcodeproj`, use the actual team/profile via the signing override, choose a device destination, then Archive. Validate the archive in Organizer; export with the completed export-options file or distribute through Organizer. The templates are preparation only and have not been exercised on macOS here.

Retain actual source commit, Xcode/SDK versions, bundle identifier, marketing/build versions, certificate fingerprint, profile UUID/expiry, artifact SHA-256, and validation/upload results. Record Apple processing and TestFlight/App Review outcomes only after Apple supplies them.

## Official references checked September 14, 2026

- CSR: https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/
- App Store profile: https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/
- Current SDK requirements: https://developer.apple.com/news/upcoming-requirements/
- Signing secrets and runner cleanup: https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications
