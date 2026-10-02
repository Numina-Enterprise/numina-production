# Numina 4.0.0 — iOS source candidate

This folder contains a native SwiftUI/WKWebView Xcode project that opens `https://numinalabs.xyz/app`. It preserves the hosted application; it does not copy, replace, publish, or modify its web code. This is source, not an IPA, an installable build, or an App Store submission.

The current source targets bundle version 4.0.0 and build number 6. It now includes native code changes, not only version metadata. These latest changes have not been compiled or signed; earlier unsigned artifacts must not be presented as builds of this source. The macOS workflow in `../../.github/workflows/numina-ios-signing.yml` requires Apple's actual distribution credentials; see `../signing/APPLE-SIGNING.md`. See `../../docs/native-package-record-v4.json`.

## Shared software release binding

The application remains **4.0.0**, with iOS source build **6** and runtime **1.9.0-rc26** / core **1.8.0**. Android's source build counter is 4. Platform build counters are not software versions and must not be overwritten to match the number in an older binary record.

`node scripts/ios-release.mjs check` verifies the iOS identity against the root application package, required architecture, runtime contract and shared distribution policy. `node scripts/ios-release.mjs sync` regenerates only `Configuration/NuminaRelease.xcconfig`; it does not change the source build counter or create a binary. The generated dependency values are embedded into Info.plist and shown in native diagnostics.

The normal web build checks these bindings before building and records the current iOS input fingerprint in source-alignment.json. Release metadata treats stored iOS source ZIPs as historical snapshots: a stale snapshot is marked non-authoritative instead of replacing or blocking the checked-in current source identity. The source snapshot and existing unsigned binary remain separate artifacts.

The latest recorded unsigned iOS binary is historical build 5 from commit `c6ffbb50d77ff53323b71b7048872637677e6b42` and predates the current source. **Do not sign or submit that older bundle as build 6.** A fresh macOS compile, matching artifact evidence and an updated signing path are still required. No source alignment check establishes native compilation, Apple signing or store acceptance.

## Candidate settings

| Setting | Value |
| --- | --- |
| Display name | Numina |
| Proposed bundle identifier | `xyz.numinalabs.app` — unregistered/unverified |
| Version / build | 4.0.0 / 6 |
| Deployment target | iOS / iPadOS 15.0+ |
| Implementation | SwiftUI, WebKit; Apple system frameworks only |
| Signing | Disabled; no team, certificate, profile, or key supplied |

For an update to an existing store app, its existing bundle identifier must be used. This proposed value is not evidence that an app record exists or that the identifier is available. Build 5 must also be checked against any existing release history.

## Included behavior

- Opens the hosted workspace with first-party HTTPS navigation restricted to the exact `numinalabs.xyz` host and default HTTPS port. Subframes may use HTTPS. External top-level HTTPS, telephone and email links ask before opening the system handler. Other schemes and plain HTTP navigation are canceled. External form POST bodies are never forwarded into a browser URL.
- Contains native back, workspace, reload, browser, privacy and support controls. The native System Status sheet observes the existing web view: page response code/time, navigation completion and categorized failures. Its previous independent URLSession probes were removed. Native rows support the iOS 15 deployment target. First-party new-window links reuse the same web view. WebKit performs normal certificate validation; there are no transport exceptions or certificate bypasses.
- Shows loading and page/network failure screens with retry. Retry loads a page with GET, without automatically repeating a submission. This does not provide offline private records, offline sign-in or queued transactions. Errors returned inside the hosted app's own JavaScript remain the hosted app's responsibility.
- Uses WebKit's persistent website-data store for its own cookies/cache. It has no analytics SDK, native JavaScript bridge, credential reader, push registration, native payment code, wallet integration, camera access or microphone access.
- Opens the existing `/privacy` and `/contact` pages from the native menu. No privacy claim about the hosted service is inferred from the absence of a native analytics SDK.

## Singular runtime and quantum wiring

The native Frontier and Runtime & Quantum controls load `/frontier` and `/frontier#runtime-metrics` in the existing WKWebView. All first-party destinations derive from one origin in AppConfiguration.swift. The hosted telemetry-ui.js remains the metrics client and uses the existing owner-only `GET /api/ops/v1/telemetry` handler. That response already contains HTTP measurements, `quantum.workload` and `quantum.ibm`; no parallel mobile backend, duplicate telemetry store or new credential path was introduced.

Native page observations are memory-only and retain only allowlisted public route names, never URL query strings or arbitrary private resource paths. They describe page transport, not JavaScript API outcomes. Runtime metrics retain their process-local, ephemeral scope. The implemented measurement backend is a classical state-vector simulator. IBM configuration or catalog discovery must not be presented as a hardware execution receipt.

Opening System Status starts no request. Opening the shared runtime panel does not automatically run a circuit, discover hardware, change capacity or move funds. The hosted Read runtime metrics button retains its existing authorization checks. The explicit Continue Runtime & Quantum in Browser control opens the same panel in the user's browser; it does not transfer a native session or return browser credentials to the app.

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

## Signing document package

See `Signing/README.md`. The package preserves the existing CSR and provides templates only; actual Apple team/certificate/profile values remain required. The legacy signing script rejects historical or uncompiled current-source inputs. Repackage with `python scripts/package-ios-source.py` after source changes; this updates source evidence only, never native build evidence.

## Procurement usage

Procurement is disabled by default (`procurement_usage: false`). Read https://numinalabs.xyz/api/control/v2/manifest for the current live capability gate and https://numinalabs.xyz/v4/release/manifest for the shared application release. A release manifest or historical owner statement does not authorize a purchase. Each procurement request requires request-bound owner or delegated approval, a signed budget reservation, and signed provider access under the current procurement policy. A completed payment requires its matching provider receipt. The hosted workspace reads the shared release; source packages do not establish native compilation, signing, store publication, or procurement execution. Historical binaries retain their separately recorded build identities.
