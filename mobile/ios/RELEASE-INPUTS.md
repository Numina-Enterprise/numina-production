# iOS release inputs still required

Status: source candidate only, September 12, 2026. None of these inputs is represented as approved, completed, or store-assigned.

| Input | Current state / action needed |
| --- | --- |
| macOS + Xcode | Absent on this Windows host; compile and review the source on a supported Mac. |
| Store identity | Proposed `xyz.numinalabs.app`; confirm the identifier of any existing Numina app before changing it. Version 3.0.0 and build 1 are candidates. |
| Signing and distribution | No Apple team, signing certificate, provisioning profile, app record, archive or IPA. The owner configures authorized signing before device distribution. |
| Native sign-in | Browser continuation is implemented. Returning a signed-in session to the native app is not implemented or verified. |
| Native utility | This is a hosted-web wrapper. Apple guideline 4.2 requires sufficient app functionality beyond merely repackaging a website. This source does not establish review eligibility. |
| Branding | Add an approved iOS app-icon asset catalog, including store artwork, then configure `ASSETCATALOG_COMPILER_APPICON_NAME`. Existing web icons are not asserted to meet iOS release requirements. |
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
