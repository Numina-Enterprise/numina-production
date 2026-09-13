// Verified rc26 production identity; Numina's application and journal retain their own identities.
export const RUNTIME_ORIGIN = 'https://numina-production.vercel.app';
export const RUNTIME_VERSION = '1.9.0-rc26';
export const EXPECTED_RELEASE = Object.freeze({
  "release": "core-v1.8+prod-v1.9.0-rc26",
  "core_version": "1.8.0",
  "production_version": "1.9.0-rc26",
  "frozen_core_manifest_root": "5852f48baa66036cbac5351f3df4805c8e3a103ce014a4508a9e7d3d6eba5b67",
  "production_files_root": "86d3ba77898ad725e309e6ffede4bdbf2967bfbc0e4558abffe96bc4ded3a543",
  "build_id": "9045c08a5cef72d6fc5b5b15a4c46e5186a0f67f25c7bae606fe9094d122508b",
  "core_conformance_artifact_sha256": "ed9656ba60eb89f4bbce85d8693c462eb64062af423cc4b48f6b5db20d7bc18f",
  "spdx_sbom_sha256": "327d9afff47e0e48a02934a260d093cb2c6ed2b8b71f0b748aeb3f0665adba65",
  "slsa_provenance_sha256": "1e42195951a986f20921ef7543181762a9945f3a681fa09ef0f299f6754aa7ba"
});
export const PINNED_RUNTIME_PUBLIC_KEY = 'UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=';
export const PINNED_RUNTIME_KEY_ID = '3a2fe594a7e10458ae89683f';
export const RELEASE_ARTIFACT_TYPE = 'NUMINA_RELEASE_ATTESTATION';
