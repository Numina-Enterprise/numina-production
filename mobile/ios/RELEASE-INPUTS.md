# iOS release inputs still required

Current source is 4.0.0 with build number 5 and has not been compiled after the latest native changes. Earlier unsigned bundles predate these native wiring changes and are not release evidence for the current source. Apple signing remains pending; use the shared Numina distribution policy and macOS signing workflow.

Historical status updated September 13, 2026: the unsigned 3.0.0 device package compiled in hosted run 34785069076. The user reports Apple Developer organization registration is complete. Distribution signing assets, provisioning, archive validation and store publication remain unverified.

| Input | Current state / action needed |
| --- | --- |
| macOS + Xcode | Historical v3 compilation is recorded; current build 5 is not verified compiled. Use Xcode 26+ with iOS SDK 26+ for upload eligibility, then validate the actual bundle. |
| Store identity | Proposed `xyz.numinalabs.app`; confirm the actual App Store Connect identifier. Current source is 4.0.0 build 5. Historical binaries retain their original build evidence and must not be relabeled. |
| Signing and distribution | Apple Developer organization registration is user-confirmed. The owner-approved CSR and owner-reported issuance are recorded in `../signing/release-identities.json`; a usable distribution certificate/profile and signed archive are not yet verified. |
| Native sign-in | Browser continuation is implemented, including the canonical runtime metrics panel. Returning a signed-in browser session to the native app is not implemented or verified. |
| Native utility | The app now includes native navigation/failure controls and a native System Status surface that shows app/device diagnostics from the existing web view and routes runtime/quantum metrics to the shared owner-only Frontier panel without independent network probes. Apple guideline 4.2 still requires sufficient app functionality; these additions do not guarantee review eligibility. |
| Branding | The AppIcon catalog contains the existing Numina vector mark rendered as an opaque 1024-pixel PNG, and the Xcode target selects it. Compile the catalog and inspect the resulting app before submission. |
| Privacy | Review the hosted application, sign-in, hosting/storage providers, Google Fonts, payment provider and any other data flows. Complete accurate App Store privacy disclosures and any applicable privacy-manifest declarations. No blanket “data not collected” statement is supplied. |
| Privacy policy | `/privacy` is linked in the native menu. Confirm that the published notice covers the distributed iOS experience and all actual data flows. |
| Account deletion | Saved web privacy source says automated account deletion is unavailable. Determine and implement the required in-app deletion route where account creation is offered. |
| Payments and services | Review the actual service types, geographic availability and payment flows against current platform requirements before distribution. This wrapper does not add purchases or activate payments. |
| Shared software alignment | Root application 4.0.0 and rc26/core 1.8.0 are checked by scripts/ios-release.mjs and the normal software build. The iOS source archive must match current input hashes. This is source evidence only. |
| Fresh signing input | The legacy signing workflow still selects the recorded older unsigned bundle. Do not use it for build 5; a matching freshly compiled bundle and signing integration remain required. |
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

See `Signing/README.md`. The package preserves the existing CSR and provides templates only; actual Apple team/certificate/profile values remain required. The legacy signing script rejects historical or uncompiled current-source inputs. Repackage with `python scripts/package-ios-source.py` after source changes; this updates source evidence only, never native build evidence.
