// Required runtime identity. These values are deployment expectations, not observations.
export const RUNTIME_ORIGIN = 'https://numina-production.vercel.app';
export const RUNTIME_VERSION = '1.9.0-rc26';
export const EXPECTED_RELEASE = Object.freeze({
  release: 'core-v1.8+prod-v1.9.0-rc26',
  core_version: '1.8.0',
  production_version: RUNTIME_VERSION,
  frozen_core_manifest_root: '5852f48baa66036cbac5351f3df4805c8e3a103ce014a4508a9e7d3d6eba5b67'
});
// Preserve the established production signing identity across the upgrade.
export const PINNED_RUNTIME_PUBLIC_KEY = 'UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=';
export const PINNED_RUNTIME_KEY_ID = '3a2fe594a7e10458ae89683f';
export const RELEASE_ARTIFACT_TYPE = 'NUMINA_RELEASE_ATTESTATION';
