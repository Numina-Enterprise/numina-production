import crypto from 'node:crypto';

function normalize(value) {
  if (typeof value === 'bigint') throw new Error('CANONICAL_BIGINT_MUST_BE_STRING');
  if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isSafeInteger(value))) {
    throw new Error('CANONICAL_UNSAFE_NUMBER');
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

export function canonicalizeJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function publicKeyFingerprint(publicKey) {
  const key = publicKey?.type === 'public' ? publicKey : crypto.createPublicKey(publicKey);
  return sha256Hex(key.export({ type: 'spki', format: 'der' }));
}

function decodeBase64(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label}_ENCODING_INVALID`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.toString('base64') !== value) throw new Error(`${label}_ENCODING_INVALID`);
  return decoded;
}

export function verifyEd25519Signature({ publicKey, signatureBase64, message, expectedFingerprint, label }) {
  let key;
  try {
    key = crypto.createPublicKey(publicKey);
  } catch {
    throw new Error(`${label}_PUBLIC_KEY_INVALID`);
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`${label}_ALGORITHM_INVALID`);
  if (publicKeyFingerprint(key) !== expectedFingerprint) throw new Error(`${label}_KEYPIN_MISMATCH`);
  const signature = decodeBase64(signatureBase64, label);
  if (!crypto.verify(null, Buffer.from(message), key, signature)) throw new Error(`${label}_SIGNATURE_INVALID`);
  return true;
}

export function signedMessage(domain, payload) {
  return `${domain}\n${canonicalizeJson(payload)}`;
}

export function computeClusterStateRoot(payload) {
  return sha256Hex(canonicalizeJson(payload));
}

export function createClusterStateContext(payload, expectedRoot) {
  if (!payload || typeof payload !== 'object') throw new Error('CLUSTER_STATE_PAYLOAD_REQUIRED');
  if (typeof expectedRoot !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRoot)) {
    throw new Error('CLUSTER_STATE_ROOT_REQUIRED');
  }
  const root = computeClusterStateRoot(payload);
  if (root !== expectedRoot) throw new Error('CLUSTER_STATE_ROOT_MISMATCH');
  return Object.freeze({ payload: structuredClone(payload), root });
}
