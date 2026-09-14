# iOS release inputs still required

Current source is 4.0.0 with build number 3 and has not been compiled. The distribution reuses the existing unsigned 3.0.0 artifact; Apple signing remains pending.

Historical status updated September 13, 2026: the unsigned 3.0.0 device package compiled in hosted run 34785069076. Apple-issued distribution signing and store publication remain unverified.

| Input | Current state / action needed |
| --- | --- |
| macOS + Xcode | Hosted macOS/Xcode compilation completed; device behavior and release review remain outstanding. |
| Store identity | Proposed `xyz.numinalabs.app`; confirm the identifier of any existing Numina app before changing it. The compiled version is 3.0.0 with build number 2. |
| Signing and distribution | The owner-approved CSR and owner-reported issuance are recorded in `../signing/release-identities.json`. Apple issuance, active membership and a usable provisioning profile are not verified; no signed IPA exists. |
| Native sign-in | Browser continuation is implemented. Returning a signed-in session to the native app is not implemented or verified. |
| Native utility | This is a hosted-web wrapper. Apple guideline 4.2 requires sufficient app functionality beyond merely repackaging a website. This source does not establish review eligibility. |
| Branding | The AppIcon catalog contains the existing Numina vector mark rendered as an opaque 1024-pixel PNG, and the Xcode target selects it. Compile the catalog and inspect the resulting app before submission. |
| Privacy | Review the hosted application, sign-in, hosting/storage providers, Google Fonts, payment provider and any other data flows. Complete accurate App Store privacy disclosures and any applicable privacy-manifest declarations. No blanket “data not collected” statement is supplied. |
| Privacy policy | `/privacy` is linked in the native menu. Confirm that the published notice covers the distributed iOS experience and all actual data flows. |
| Account deletion | Saved web privacy source says automated account deletion is unavailable. Determine and implement the required in-app deletion route where account creation is offered. |
| Payments and services | Review the actual service types, geographic availability and payment flows against current platform requirements before distribution. This wrapper does not add purchases or activate payments. |
| Release evidence | No simulator/device run, sign-in validation, screenshots, accessibility review, purchase review, archive validation or store review exists. |
| Listing | Confirm product name, support/privacy URLs, rights, category, age rating, review access and all final listing content. |

No privacy manifest is fabricated here. The native source calls no custom required-reason API directly; the final app and any future libraries must still be assessed. A native-only declaration cannot replace disclosures about the hosted service.

Official sources checked September 12, 2026:

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — minimum functionality, account deletion, privacy policy and payment requirements.
- [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) — disclosures for the app and integrated third parties.
- [Distributing your app](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases) — archives, signing and App Store Connect distribution.
- [ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession) — native browser-based authentication with a callback to the app.

These notes describe outstanding work; they are not legal approval, an App Store guarantee or authorization to submit.
