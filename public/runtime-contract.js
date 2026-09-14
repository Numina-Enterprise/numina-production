// Verified rc26 production identity; Numina's application and journal retain their own identities.
export const RUNTIME_ORIGIN = 'https://numina-production.vercel.app';
export const RUNTIME_VERSION = '1.9.0-rc26';
export const EXPECTED_RELEASE = Object.freeze({
  "release": "core-v1.8+prod-v1.9.0-rc26",
  "core_version": "1.8.0",
  "production_version": "1.9.0-rc26",
  "frozen_core_manifest_root": "5852f48baa66036cbac5351f3df4805c8e3a103ce014a4508a9e7d3d6eba5b67",
  "production_files_root": "0890f3a837d26ee445b5ad9d311387e119ee564949a439cfe325b47fb32762fd",
  "build_id": "1e43b674cf71438f128b6bc3ed02a45349ac382a992c3899ba847ee6e89dbb8f",
  "core_conformance_artifact_sha256": "ed9656ba60eb89f4bbce85d8693c462eb64062af423cc4b48f6b5db20d7bc18f",
  "spdx_sbom_sha256": "4d82e19d0e0badb0ea095119fc25d42ae7441e3ef59655344b5c208c654eca50",
  "slsa_provenance_sha256": "0ba04c4cf1fd8e54fc8616cf2755adc4e9ceae20a2644731e270294259bb7f38"
});
export const PINNED_RUNTIME_PUBLIC_KEY = 'UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=';
export const PINNED_RUNTIME_KEY_ID = '3a2fe594a7e10458ae89683f';
export const RELEASE_ARTIFACT_TYPE = 'NUMINA_RELEASE_ATTESTATION';
