# Numina Apple distribution signing

The shared configuration is `distribution-policy.json`. All five Numina architecture layers reference it. It uses the existing `xyz.numinalabs.app` identity and canonical Numina root; Apple distribution membership is a separate provider identity. The Apple Team ID is currently unconfigured.

The manually dispatched `.github/workflows/numina-ios-signing.yml` requests a GitHub-hosted macOS runner with Apple's `security`, `codesign` and `ditto` tools. Creating this workflow does not provision a running host or grant Apple account access. It signs the recorded v4 bundle using the retained executable and creates an App Store IPA only after profile, team, certificate and signature checks succeed. It does not run tests or submit a store release.

Configure repository variable `NUMINA_APPLE_TEAM_ID` from the active Apple Developer membership. Configure these GitHub Actions secrets through GitHub's settings, never in source or chat:

- `NUMINA_APPLE_DISTRIBUTION_P12_BASE64`: Apple-issued distribution certificate and its private key, exported as PKCS#12 and base64 encoded.
- `NUMINA_APPLE_DISTRIBUTION_P12_PASSWORD`: that export's password.
- `NUMINA_APPLE_PROVISIONING_PROFILE_BASE64`: an unexpired explicit App Store profile for `xyz.numinalabs.app`, from the same team and including that certificate.

The signing job uses a temporary keychain and removes it when done. Missing signing assets, invalid teams, mismatched profiles and unsupported nested code stop the job. Only a successful job creates `signing-result.json`; this document is not evidence of a signature or Apple approval.

After the source is published, dispatch `numina-ios-signing.yml` on `main`. Retain the returned IPA and signing result. Publish the same signed artifact to Sites and Vercel only after verifying its actual hash and updating the distribution record. Hosting a download does not install an iOS app or establish App Store acceptance. Until this job succeeds, both targets must describe the bundle as unsigned.

Implementation references: [GitHub's macOS signing setup](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications) and [Apple distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
