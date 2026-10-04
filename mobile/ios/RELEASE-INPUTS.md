# iOS release inputs still required

Current source is 4.0.0 with build number 6 and has not been compiled after the latest native changes. The recorded unsigned build 5 is historical, not release evidence for build 6. Apple signing remains pending; the main-branch signing workflow compiles current source before signing with the shared Numina distribution policy.

Historical status updated September 13, 2026: the unsigned 3.0.0 device package compiled in hosted run 34785069076. The user reports Apple Developer organization registration is complete. Distribution signing assets, provisioning, archive validation and store publication remain unverified.

| Input | Current state / action needed |
| --- | --- |
| macOS + Xcode | Historical v4 build 5 compilation is recorded; current build 6 is not verified compiled. Use the configured macOS runner, then validate the actual bundle and toolchain. |
| Store identity | Proposed `xyz.numinalabs.app`; confirm the actual App Store Connect identifier. Current source is 4.0.0 build 6. Historical binaries retain their original build evidence and must not be relabeled. |
| Signing and distribution | Apple Developer organization registration is user-confirmed. The owner-approved CSR and owner-reported issuance are recorded in `../signing/release-identities.json`; a usable distribution certificate/profile and signed archive are not yet verified. |
| Native sign-in | Source opens the fixed hosted workspace sign-in origin in the external browser; the xyz origin remains the only first-party web-view origin. Browser authentication is verified for the hosted website, not for a rebuilt native app or device. Returning browser credentials to the native app is not implemented. |
| Native utility | The app now includes native navigation/failure controls and a native System Status surface that shows app/device diagnostics from the existing web view and routes runtime/quantum metrics to the shared owner-only Frontier panel without independent network probes. Apple guideline 4.2 still requires sufficient app functionality; these additions do not guarantee review eligibility. |
| Branding | The AppIcon catalog contains the existing Numina vector mark rendered as an opaque 1024-pixel PNG, and the Xcode target selects it. Compile the catalog and inspect the resulting app before submission. |
| Privacy | Review the hosted application, sign-in, hosting/storage providers, Google Fonts, payment provider and any other data flows. Complete accurate App Store privacy disclosures and any applicable privacy-manifest declarations. No blanket “data not collected” statement is supplied. |
| Legal notices | Source menu links `/terms`, `/privacy`, `/software-licenses` and `/compliance`; legal companion records are included in the current source archive. The final binary and actual hosted data flows require build-specific review. |
| Account deletion | Hosted `/privacy#delete-account` provides a deletion request email and describes the authenticated `/api/app/v1/account/delete` path when workspace access and storage are active. Verify this route inside the freshly built app, account creation behavior, retention exceptions and the applicable in-app/store requirements before submission. Source links alone are not installed-app deletion evidence. |
| Payments and services | Review the actual service types, geographic availability and payment flows against current platform requirements before distribution. This wrapper does not add purchases or activate payments. |
| Shared software alignment | Root application 4.0.0 and rc26/core 1.8.0 are checked by scripts/ios-release.mjs and the normal software build. The iOS source archive must match current input hashes. This is source evidence only. |
| Fresh signing input | `.github/workflows/numina-ios-signing.yml` compiles current source, then `scripts/sign-ios-release.py` checks its bundle identity/build and the real Apple distribution identity/profile before signing. It does not select the historical unsigned bundle. |
| Release evidence | No simulator/device run, sign-in validation, screenshots, accessibility review, purchase review, archive validation or store review exists. |
| Listing | Confirm product name, support/privacy URLs, rights, category, age rating, review access and all final listing content. |

No privacy manifest is fabricated here. The native source calls no custom required-reason API directly; the final app and any future libraries must still be assessed. A native-only declaration cannot replace disclosures about the hosted service.

Official sources checked September 12, 2026:

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — minimum functionality, account deletion, privacy policy and payment requirements.
- [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) — disclosures for the app and integrated third parties.
- [Distributing your app](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases) — archives, signing and App Store Connect distribution.
- [ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession) — native browser-based authentication with a callback to the app.

These notes describe outstanding work; they are not legal approval, an App Store guarantee or authorization to submit.

## Signing document package

See `Signing/README.md`. The package preserves the existing CSR and provides templates only; actual Apple team/certificate/profile values remain required. The signing script requires a freshly compiled current-source bundle. Repackage with `python scripts/package-ios-source.py` after source changes; this updates source evidence only, never native build evidence.
