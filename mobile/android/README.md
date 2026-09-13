# Numina OS 2.0 — Android source candidate

This is a concrete Android Gradle project for the existing Numina workspace at https://numinalabs.xyz/app. It uses Google's Android Browser Helper 2.7.3 to launch a Trusted Web Activity, with the normal browser fallback. It does not embed a WebView, signing key, billing SDK, custody wallet or token transaction mechanism. The hosted application's current access and payment rules still apply.

**Status: source prepared; an actual unsigned release build was attempted and failed. No APK or AAB was produced.** Nothing was signed, installed on a device or submitted. No tests were run, as requested.

The initial Windows environment lacked a discoverable JDK, Gradle or Android SDK. The official JDK 17.0.20.1, Gradle 8.13 and Android command-line tools were then downloaded with SHA-256 verification into the mobile workspace; SDK platform 36/build-tools 35.0.0 were installed, and Gradle added platform-tools 37.0.1. Compilation reached `:app:compileReleaseJavaWithJavac` and failed with `java.nio.file.AccessDeniedException` while Java resolved JAR paths. Both reported JAR files are readable ordinary files; Java's path-resolution implementation walks ancestor directories, and the sandbox denies metadata access to the `C:\Users\sam` ancestor. TEMP resolves beneath that same ancestor. Permission for a separate build directory was not granted; no permission bypass, ACL change or relocation occurred. The actual failed build log and record accompany the final package.

| Field | Candidate value |
| --- | --- |
| Native display version | 2.0.0 |
| Native build/version code | 1 |
| Proposed package ID | xyz.numinalabs.app |
| Minimum Android SDK | 23 |
| Compile / target SDK | 36 |
| Android Gradle Plugin | 8.13.2 |
| Gradle / JDK | 8.13 / 17 |
| Browser integration | com.google.androidbrowserhelper:androidbrowserhelper:2.7.3 |

The package ID is a proposed code setting, not a store-issued identity. Confirm it against the actual Play/Samsung record before signing; future updates must preserve the real package identity and use an acceptable increasing version code. The application release 2.0.0 does not rename the separately observed rc22 backend dependency.

## Build the release artifacts

Use a build environment in which Java can resolve every directory in the project, SDK and dependency paths. Install JDK 17, Gradle 8.13, Android command-line tools, SDK platform 36 and compatible build tools if absent. Accept Android's licenses in that environment. Set the SDK location through `ANDROID_HOME` or a local, uncommitted `local.properties`. Open this directory in Android Studio or run the following from this directory:

```text
gradle --no-daemon :app:bundleRelease :app:assembleRelease
```

These are build tasks, not a test command. No Gradle wrapper JAR is included because it was not generated or downloaded here. The expected output paths, **not existing files**, are `app/build/outputs/bundle/release/app-release.aab` and `app/build/outputs/apk/release/app-release-unsigned.apk`. The project deliberately has no release signing configuration. An unsigned APK is not installable, and the AAB must be signed appropriately before upload. Use the owner's actual keystore/signing arrangement through Android Studio's signed-bundle workflow; do not use a debug key or an invented identity for production.

Publish Digital Asset Links only after obtaining the final package ID and actual store **app-signing** certificate SHA-256. The incomplete `assetlinks.configuration.json` is not a publishable asset-links file. Without valid association, the browser displays its normal Custom Tab interface. No browser verification bypass is included. The launcher accepts only HTTPS `/app` paths on `numinalabs.xyz`; other explicit launch URLs fall back to the workspace home.

## Remaining release work

Resolve the actual filesystem permission/build-host blocker, complete compilation, establish actual signing ownership, complete domain association and publisher/store records, then perform the separately authorized native-device and store review steps. No native authentication, device behavior or store acceptance has been verified. The browser supplies the existing sign-in context; the source route `/signin-with-chatgpt?return_to=...` is not a new native OAuth integration. Consulting checkout, digital-service billing classification, privacy/deletion disclosures, accessibility and account review access remain store-specific checks. This candidate must not be presented as a token wallet or as enabling NUSD execution.

The browser dependency is Apache-2.0 licensed; it is referenced as a Maven dependency, not vendored. Its resolved transitive dependencies and notices must be included in the actual native build inventory. The copied Numina icon retains the source application's unresolved ownership status; this package does not certify IP title.

Primary references, checked 2026-09-12: [Android Browser Helper release](https://github.com/GoogleChrome/android-browser-helper/releases/tag/android-browser-helper-2.7.3), [TWA architecture and domain association](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start), [AGP 8.13 compatibility](https://developer.android.com/build/releases/agp-8-13-0-release-notes), [official launcher implementation](https://github.com/GoogleChrome/android-browser-helper/blob/android-browser-helper-2.7.3/androidbrowserhelper/src/main/java/com/google/androidbrowserhelper/trusted/LauncherActivity.java).
