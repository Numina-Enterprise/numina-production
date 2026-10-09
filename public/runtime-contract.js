// Verified rc27 runtime mechanics. Identity, source, evidence, journal, runtime and artifact all resolve to NUMINA.
export const RUNTIME_ORIGIN = 'https://numinalabs.xyz';
export const RUNTIME_VERSION = '1.9.0-rc27';
export const EXPECTED_RELEASE = Object.freeze({
  "singular": true,
  "identity": "NUMINA",
  "build_identity": "NUMINA",
  "all_builds_are_numina": true,
  "non_numina_builds_allowed": false,
  "canonical_source": "NUMINA",
  "source_of_truth": "NUMINA",
  "square_root": "NUMINA",
  "update_direction": "ROOT_TO_LEAVES",
  "canonical_repository": "NUMINA",
  "canonical_repository_role": "CANONICAL_ROOT_REPOSITORY",
  "canonical_repository_authoritative": true,
  "canonical_branch": "main",
  "release": "core-v1.8+prod-v1.9.0-rc27",
  "core": "NUMINA",
  "core_version": "1.8.0",
  "frozen_core_manifest_root": "5852f48baa66036cbac5351f3df4805c8e3a103ce014a4508a9e7d3d6eba5b67",
  "production_version": "1.9.0-rc27",
  "environment": "FRONTIER",
  "final_build": "/final-build.json",
  "final_manifest": "/final-manifest.json",
  "compatibility": {
    "release": "core-v1.8+prod-v1.9.0-rc27",
    "core_version": "1.8.0",
    "frozen_core_manifest_root": "5852f48baa66036cbac5351f3df4805c8e3a103ce014a4508a9e7d3d6eba5b67"
  },
  "production_files_root": "2bd0774d33070735791c6f971cf76e826124577a96667488498bc45288ca0aba",
  "build_id": "424f660e35e6f48f72cb53d6c0241702c35358dac48322477343b9103178113e",
  "core_conformance_artifact_sha256": "ed9656ba60eb89f4bbce85d8693c462eb64062af423cc4b48f6b5db20d7bc18f",
  "spdx_sbom_sha256": "9ac9a4e66f3c0ffa7e9f0b2a3e20b130f04dfef8a00046c732e98d0b6b37b86c",
  "slsa_provenance_sha256": "5160279973835620912f3fbb742892ad129417e40760218cc7135da75a2bf1bc"
});
export const PINNED_RUNTIME_PUBLIC_KEY = 'UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=';
export const PINNED_RUNTIME_KEY_ID = '3a2fe594a7e10458ae89683f';
export const RELEASE_ARTIFACT_TYPE = 'NUMINA_RELEASE_ATTESTATION';
