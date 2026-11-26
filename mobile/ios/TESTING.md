# Numina iOS native tests

This Xcode project includes two XCTest targets in the shared `Numina` scheme. Tests are separate from the production app target and do not include signing material, native payment code, or treasury operations.

## Run on an authorized Mac

1. Open `mobile/ios/Numina.xcodeproj` in Xcode and choose the shared `Numina` scheme.
2. Choose an iPhone Simulator and use **Product → Test**, or run the equivalent command at the repository root:

```sh
xcrun simctl list devices available
xcodebuild -project mobile/ios/Numina.xcodeproj \
  -scheme Numina \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=REPLACE_WITH_SIMULATOR_UDID' \
  -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
```

The application deployment target remains iOS 15. The XCTest bundles target iOS 17 or later because the Xcode 27 XCTest frameworks require it. Tests run on simulators; they do not generate a signed IPA or provide App Store release approval.

## Coverage

- `NuminaTests/NuminaSecurityTests.swift`: exact HTTPS origin and default port, sign-in route classification, diagnostic-route redaction, external URL scheme allowlist.
- `NuminaUITests/NuminaNavigationUITests.swift`: native Workspace/Services/Frontier controls, selection after the hosted page responds, System Status sheet presentation and dismissal.

UI tests navigate to the public hosted Numina workspace and require network access. They do not authenticate, transfer credentials, invoke privileged APIs, or verify payments. Hosted page availability can affect these integration tests.

## Recorded local validation

On 2026-10-12, Xcode 27.0 on a Mac ran the shared scheme on an **iPhone 17 simulator with iOS 27.0**: **6 tests passed, 0 failed, 0 skipped**. The unsigned Release iOS device configuration also compiled successfully. The application bundle remained `xyz.numinalabs.app`, version `4.0.0`, build `6`.

This is simulator test and compilation evidence only; native OAuth session handoff, physical device validation, signing, and App Store review remain separate release gates. A passing navigation test does not establish hosted API outcomes or independent provider verification.

## CI policy

This repository enforces a recorded GitHub Actions runner inventory and execution targets. **Do not add or redirect workflows or runner targets solely to run these tests.** The suite can be rerun in Xcode on an authorized Mac; automation needs a separately approved change consistent with the existing runner policy.
