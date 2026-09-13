# Numina release identities

The public identity record pins separate Android release and upload certificates for `xyz.numinalabs.app`. Android APKs use the release identity; app bundles use the upload identity for eventual Google Play enrollment. The website's Digital Asset Links file binds the owned production domain to the direct-distribution release certificate. Google Play may assign its own app-signing certificate after enrollment; add that exact issued certificate to the domain association at that time.

Private keys and randomly generated passwords are stored only in the repository's encrypted GitHub Actions secret `NUMINA_RELEASE_SIGNING_VAULT`. They are not committed or saved as local plaintext. The manual signed-release workflow writes temporary credential files only in the ephemeral runner, confirms their public certificate fingerprints, signs, verifies the artifacts, and deletes the temporary files. Protect repository administration and the secret store. A key rotation or recovery is a separate owner-authorized operation; never generate replacement keys during a routine build.

The iOS file is a certificate-signing request. Its private key is retained in the same encrypted vault. Apple must issue the distribution certificate after the organization's developer enrollment; the CSR is not an Apple certificate or App Store approval. No iOS signing or store submission is claimed.

The signed Android build performs compilation, packaging, signature and alignment verification. It runs no application tests and submits nothing to an app store.

Android release build 34780729273 completed on 2026-09-13 with verified APK and AAB signatures. Public artifacts and SHA-256 digests are recorded in `docs/android-signed-build-record-v2.json`. Google Play publication and physical-device installation remain unverified.
