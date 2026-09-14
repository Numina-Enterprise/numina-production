# Numina 4.0.0 — iOS source candidate

This folder contains a native SwiftUI/WKWebView Xcode project that opens `https://numinalabs.xyz/app`. It preserves the hosted application; it does not copy, replace, publish, or modify its web code. This is source, not an IPA, an installable build, or an App Store submission.

The v4 distribution reuses the existing iOS executable with bundle version 4.0.0 and build number 3. Only Info.plist version metadata is updated; no native compilation is claimed. The archive remains unsigned. The macOS workflow in `../../.github/workflows/numina-ios-signing.yml` requires Apple's actual distribution credentials; see `../signing/APPLE-SIGNING.md`. See `../../docs/native-package-record-v4.json`.

## Candidate settings

| Setting | Value |
| --- | --- |
| Display name | Numina |
| Proposed bundle identifier | `xyz.numinalabs.app` — unregistered/unverified |
| Version / build | 4.0.0 / 3 |
| Deployment target | iOS / iPadOS 15.0+ |
| Implementation | SwiftUI, WebKit; Apple system frameworks only |
| Signing | Disabled; no team, certificate, profile, or key supplied |

For an update to an existing store app, its existing bundle identifier must be used. This proposed value is not evidence that an app record exists or that the identifier is available. Build 3 must also be checked against any existing release history.

## Included behavior

- Opens the hosted workspace with first-party HTTPS navigation restricted to the exact `numinalabs.xyz` host and default HTTPS port. Subframes may use HTTPS. External top-level HTTPS, telephone and email links ask before opening the system handler. Other schemes and plain HTTP navigation are canceled. External form POST bodies are never forwarded into a browser URL.
- Contains native back, workspace, reload, browser, privacy and support controls. First-party new-window links reuse the same web view. WebKit performs normal certificate validation; there are no transport exceptions or certificate bypasses.
- Shows loading and page/network failure screens with retry. Retry loads a page with GET, without automatically repeating a submission. This does not provide offline private records, offline sign-in or queued transactions. Errors returned inside the hosted app's own JavaScript remain the hosted app's responsibility.
- Uses WebKit's persistent website-data store for its own cookies/cache. It has no analytics SDK, native JavaScript bridge, credential reader, push registration, native payment code, wallet integration, camera access or microphone access.
- Opens the existing `/privacy` and `/contact` pages from the native menu. No privacy claim about the hosted service is inferred from the absence of a native analytics SDK.

## Sign-in limitation

The saved hosted source starts authentication at `/signin-with-chatgpt?return_to=...`. This project intercepts that first-party route before the WebKit navigation and offers to start the complete sign-in flow in the system browser. The prompt explains that signed-in work stays in that browser. Browser sign-in does **not** sign in WKWebView.

There is no verified native OAuth callback, associated-domain entitlement, universal-link registration, token exchange, or session handoff. No authorization token or browser cookie is copied into WebKit. A native authenticated workspace requires an explicitly supported server flow and device validation before release. Apple's supported native web authentication API is [ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession).

## Build on a Mac

Open `Numina.xcodeproj` in a supported Xcode installation on macOS and select the shared `Numina` scheme. All sources are included directly; no package manager, project generator, dependency installation or paid build service is required.

Signing is deliberately off in `Configuration/Numina.xcconfig`. An unsigned simulator build can be made later with the following command, which was **not run** in this work:

```sh
xcodebuild -project Numina.xcodeproj -scheme Numina -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

Before a signed archive, the owner must confirm the app identity, configure their authorized Apple team and signing, and address `RELEASE-INPUTS.md`. Select an iOS device destination, then use Product → Archive. Export/upload is a separate action. Apple describes the archive and signing path in [Distributing your app](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

## Historical preparation record

Prepared on Windows, September 12, 2026. `xcodebuild`, `swift`, and `plutil` were not available on PATH. The project was not compiled, launched, tested, signed, archived, validated in Xcode, or submitted. No tests or test target were added. No Apple account, signing credential, key generation, paid service, or hosted-site mutation was used. Source inspection is not a successful native build.

The app icon asset catalog now contains an opaque 1024-pixel rendering of the existing Numina mark and is configured in the Xcode target. The final privacy manifest and store review remain release inputs. No `.ipa`, `.xcarchive`, signing material, or simulated store receipt is included.

Apple documents persistent storage in [WKWebsiteDataStore](https://developer.apple.com/documentation/webkit/wkwebsitedatastore). Current review requirements and privacy details were checked against the official sources linked in `RELEASE-INPUTS.md`.

## Historical v3 build record

Hosted build 34867504707 compiled the unsigned device release with its AppIcon successfully on 2026-09-14 at 16:16:32 UTC from commit `fd01df039f9e920afa29361a0df32709faa7dd08`. The downloaded artifact contains Assets.car and AppIcon metadata for iPhone and iPad. The unsigned app ZIP is downloadable; no signed IPA or App Store submission exists. Exact hashes, the prior build, and remaining signing status are in `../../docs/native-package-record-v3.json`. The earlier preparation record above is historical.

Copyright © 2026 SK Consulting LLC. Numina™ and Numina OS™ are trademarks claimed by SK Consulting LLC. See [OWNERSHIP.md](OWNERSHIP.md); third-party licenses remain applicable.
