// Expected identity of the running rc22 dependency; frontier control v2 is separately versioned.
export const RUNTIME_ORIGIN = 'https://numina-production.vercel.app';
export const RUNTIME_VERSION = '1.9.0-rc22';
export const EXPECTED_RELEASE = Object.freeze({
  release: 'core-v1.8+prod-v1.9.0-rc22',
  core_version: '1.8.0',
  production_version: RUNTIME_VERSION,
  frozen_core_manifest_root: '5852f48baa66036cbac5351f3df4805c8e3a103ce014a4508a9e7d3d6eba5b67',
  production_files_root: '347823a607fe7d3b03b22699f302d76cfd5b30c25a030b44e8ac9eda1114e357',
  release_sha256: '38f0d78c92cf3df0591802db2d262658fc6fc8bd9cac9b387262528d1b8bbb52'
});
export const PINNED_RUNTIME_PUBLIC_KEY = 'UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=';
export const PINNED_RUNTIME_KEY_ID = '3a2fe594a7e10458ae89683f';
export const RELEASE_ARTIFACT_TYPE = 'NUMINA_DEPLOYMENT_ATTESTATION';
