// Current runtime evidence is separate from the preserved rc20 release artifacts.
export const PINNED_RUNTIME_PUBLIC_KEY = 'UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=';
export const PINNED_RUNTIME_KEY_ID = '3a2fe594a7e10458ae89683f';
export const EXPECTED_RELEASE = Object.freeze({
  release: 'core-v1.8+prod-v1.9.0-rc22',
  core_version: '1.8.0',
  production_version: '1.9.0-rc22',
  frozen_core_manifest_root: '5852f48baa66036cbac5351f3df4805c8e3a103ce014a4508a9e7d3d6eba5b67',
  production_files_root: '347823a607fe7d3b03b22699f302d76cfd5b30c25a030b44e8ac9eda1114e357',
  release_sha256: '38f0d78c92cf3df0591802db2d262658fc6fc8bd9cac9b387262528d1b8bbb52'
});
export const RELEASE_ARTIFACT_TYPE = 'NUMINA_DEPLOYMENT_ATTESTATION';
const encoder = new TextEncoder();
const spkiPrefix = Uint8Array.from([0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  throw new TypeError('Unsupported canonical JSON value');
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const result = Uint8Array.from(atob(value), character => character.charCodeAt(0));
    return btoa(String.fromCharCode(...result)) === value ? result : null;
  } catch { return null; }
}

export function rawPublicKey(value) {
  const bytes = decodeBase64(value);
  if (bytes?.length === 32) return bytes;
  if (bytes?.length === 44 && spkiPrefix.every((byte, index) => bytes[index] === byte)) return bytes.slice(12);
  return null;
}

export function releaseIdentityMatches(value) {
  return object(value) && Object.entries(EXPECTED_RELEASE).every(([field, expected]) => value[field] === expected);
}

export function receiptEnvelope(value) {
  if (!object(value)) return null;
  if (Object.hasOwn(value, 'artifact_type')) return value;
  return object(value.receipt) ? value.receipt : null;
}

// The preimage is canonical {artifact_type, key_id, payload}; the public key is not its own trust anchor.
export async function verifyRuntimeReceipt(value, pinnedKey = PINNED_RUNTIME_PUBLIC_KEY) {
  const invalid = reason => ({valid: false, reason, envelope: null, key: null});
  const pinned = decodeBase64(pinnedKey);
  if (pinned?.length !== 32) return invalid('A runtime signing-key pin has not been established.');
  const envelope = receiptEnvelope(value);
  if (!envelope || envelope.algorithm !== 'Ed25519' || typeof envelope.artifact_type !== 'string' ||
      !envelope.artifact_type || !object(envelope.payload)) return invalid('The receipt format is not recognized.');
  const advertised = rawPublicKey(envelope.public_key);
  if (!advertised || !pinned.every((byte, index) => byte === advertised[index])) return invalid('The receipt key does not match the pinned key.');
  try {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pinned)), byte => byte.toString(16).padStart(2, '0')).join('');
    const keyId = digest.slice(0, 24);
    if (envelope.key_id !== keyId) return invalid('The receipt key identifier does not match the pinned key.');
    const signature = decodeBase64(envelope.signature);
    if (signature?.length !== 64) return invalid('The receipt signature is malformed.');
    const key = await crypto.subtle.importKey('raw', pinned, {name: 'Ed25519'}, false, ['verify']);
    const preimage = {artifact_type: envelope.artifact_type, key_id: envelope.key_id, payload: envelope.payload};
    const valid = await crypto.subtle.verify('Ed25519', key, signature, encoder.encode(canonical(preimage)));
    if (!valid) return invalid('The receipt signature did not verify.');
    return {valid: true, reason: null, envelope, key: {algorithm: 'Ed25519', key_id: keyId, public_key: pinnedKey, format: 'raw'}};
  } catch { return invalid('The receipt signature could not be checked.'); }
}

function equalJson(left, right) {
  try { return canonical(left) === canonical(right); } catch { return false; }
}

export async function assessRuntimeEvidence(records, {pinnedKey = PINNED_RUNTIME_PUBLIC_KEY} = {}) {
  const value = name => records[name]?.state === 'ok' ? records[name].data : null;
  const manifest = value('manifest');
  const attestation = await verifyRuntimeReceipt(value('attestation'), pinnedKey);
  const control = value('control');
  const controlReceipt = await verifyRuntimeReceipt(control, pinnedKey);
  const manifestMatches = releaseIdentityMatches(manifest);
  const declaration = attestation.envelope?.payload;
  const declarationWrapper = value('attestation');
  const declarationBound = !Object.hasOwn(declarationWrapper || {}, 'attestation') ||
    equalJson(declarationWrapper.attestation, declaration);
  // rc22 signs a declaration of the release name. It does not sign the manifest digest fields.
  const releaseSignatureValid = attestation.valid && attestation.envelope.artifact_type === RELEASE_ARTIFACT_TYPE &&
    declaration?.schema === 'numina.deployment-attestation.v1' && declaration.release === EXPECTED_RELEASE.release &&
    declaration.runtime_surface === 'live-serverless-control-plane' && declarationBound;
  // Exact binding is required. A signature over unrelated state is not proof of the displayed state.
  const controlStateBound = Boolean(controlReceipt.valid && controlReceipt.envelope.artifact_type === 'NUMINA_CONTROL_STATE' &&
    object(control) && Object.hasOwn(control, 'state') && control.state?.schema === 'numina.control-state.v1' &&
    control.state.release === EXPECTED_RELEASE.production_version && equalJson(control.state, controlReceipt.envelope.payload));
  const status = value('status'), supply = value('supply');
  const runtimeStatusMatches = Boolean(status && ['release','core_version','production_version','release_sha256'].every(field =>
    status[field] === EXPECTED_RELEASE[field]) && status.frozen_core?.manifest_root === EXPECTED_RELEASE.frozen_core_manifest_root);
  const supplyIdentityMatches = Boolean(supply && ['release','release_sha256','production_files_root'].every(field =>
    supply[field] === EXPECTED_RELEASE[field]));
  return {
    manifest, manifestMatches, attestation,
    releaseDeclarationVerified: Boolean(manifestMatches && releaseSignatureValid),
    runtimeStatusMatches, supplyIdentityMatches, controlReceipt, controlStateBound,
    key: attestation.valid ? attestation.key : controlReceipt.valid ? controlReceipt.key : null
  };
}
