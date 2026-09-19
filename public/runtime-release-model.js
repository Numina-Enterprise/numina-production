import {PINNED_RUNTIME_PUBLIC_KEY,PINNED_RUNTIME_KEY_ID,EXPECTED_RELEASE,RELEASE_ARTIFACT_TYPE} from './runtime-contract.js';
export {PINNED_RUNTIME_PUBLIC_KEY,PINNED_RUNTIME_KEY_ID,EXPECTED_RELEASE,RELEASE_ARTIFACT_TYPE};
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
  const value = name => records[name]?.phase === 'ok' ? records[name].data : null;
  const manifestResponse = value('manifest');
  const manifest = object(manifestResponse?.manifest) ? manifestResponse.manifest : manifestResponse;
  const manifestReceipt = await verifyRuntimeReceipt(manifestResponse, pinnedKey);
  const attestation = await verifyRuntimeReceipt(value('attestation'), pinnedKey);
  const control = value('control');
  const controlReceipt = await verifyRuntimeReceipt(control, pinnedKey);
  const manifestRelease=manifest?.release??manifest;
  const manifestMatches=Boolean(object(manifest)&&manifest.root==='NUMINA'&&manifest.identity==='NUMINA'&&manifest.authority==='NUMINA'&&manifest.source==='NUMINA'&&manifest.evidence==='NUMINA'&&manifest.provider==='NUMINA'&&manifest.provider_verification===true&&releaseIdentityMatches(manifestRelease))||releaseIdentityMatches(manifest);
  const declarationProjection=attestation.envelope?.payload;
  const declaration=declarationProjection?.payload??declarationProjection;
  const declarationWrapper = value('attestation');
  const declarationBound = !Object.hasOwn(declarationWrapper || {}, 'attestation') ||
    equalJson(declarationWrapper.attestation, declaration);
  // Bind the entire displayed descriptor, not only the known release pins. A
  // matching build hash does not authenticate an additional unsigned claim.
  const manifestDeclarationBound = object(declaration?.manifest)
    ? equalJson(manifest, declaration.manifest)
    : object(manifest) && object(declaration) && Object.entries(manifest).every(([field, entry]) =>
      Object.hasOwn(declaration, field) && equalJson(entry, declaration[field]));
  const manifestEnvelopeBound = !object(manifestResponse?.manifest) || Boolean(
    manifestReceipt.valid && manifestReceipt.envelope.artifact_type === 'NUMINA_MANIFEST' &&
    equalJson(manifest, manifestReceipt.envelope.payload));
  // Both the legacy declaration and the current singular projection are signed.
  const declarationRelease=object(declaration?.release)?declaration.release:declaration;
  const releaseSignatureValid=attestation.valid&&attestation.envelope.artifact_type===RELEASE_ARTIFACT_TYPE&&
    releaseIdentityMatches(declarationRelease)&&(declaration.environment??'production')==='production'&&declarationBound&&
    manifestDeclarationBound&&manifestEnvelopeBound;
  // Exact binding is required. The legacy route carries a NUMINA manifest, never an independent state.
  const controlManifest = control?.manifest;
  const controlPayload = object(controlManifest?.payload) ? controlManifest.payload : controlManifest;
  const controlManifestBound = Boolean(controlReceipt.valid && ['NUMINA_CONTROL_MANIFEST','NUMINA_CONTROL_STATE'].includes(controlReceipt.envelope.artifact_type) &&
    object(control) && object(controlPayload) && ['numina.control-manifest.v1','numina.control-state.v1'].includes(controlPayload.schema) &&
    controlPayload.release === EXPECTED_RELEASE.production_version && equalJson(controlManifest, controlReceipt.envelope.payload));
  const statusResponse=value('status'),supply=value('supply');
  const status=object(statusResponse?.status)?statusResponse.status:statusResponse;
  const statusPayload=object(status?.payload)?status.payload:status,statusRelease=object(statusPayload?.release)?statusPayload.release:statusPayload;
  const statusReceipt=await verifyRuntimeReceipt(statusResponse,pinnedKey);
  const runtimeStatusMatches=Boolean(releaseIdentityMatches(statusRelease)&&(object(statusResponse?.status)
    ?statusReceipt.valid&&statusReceipt.envelope.artifact_type==='NUMINA_PRODUCTION_STATUS'&&equalJson(status,statusReceipt.envelope.payload)
    :statusPayload.frozen_core?.valid===true&&statusPayload.frozen_core?.manifest_root===EXPECTED_RELEASE.frozen_core_manifest_root));
  const supplyEvidence=supply?.payload?.evidence??supply?.evidence??supply;
  const supplyReceipt=await verifyRuntimeReceipt(supply?.payload??supply,pinnedKey);
  const supplyEnvelopeBound=!Object.hasOwn(supply?.payload??supply??{},'receipt')||Boolean(
    supplyReceipt.valid&&supplyReceipt.envelope.artifact_type==='NUMINA_SUPPLY_CHAIN_EVIDENCE'&&equalJson(supplyEvidence,supplyReceipt.envelope.payload));
  const supplyIdentityMatches=Boolean(supplyEnvelopeBound&&supplyEvidence?.valid===true&&['spdx_sbom_sha256','slsa_provenance_sha256'].every(field=>supplyEvidence[field]===EXPECTED_RELEASE[field]));
  return {
    manifest, release:manifestRelease, status:statusPayload, supply:supplyEvidence, manifestMatches, attestation,
    releaseDeclarationVerified: Boolean(manifestMatches && releaseSignatureValid),
    runtimeStatusMatches, supplyIdentityMatches, controlReceipt, controlManifestBound,
    key: attestation.valid ? attestation.key : controlReceipt.valid ? controlReceipt.key : null
  };
}
