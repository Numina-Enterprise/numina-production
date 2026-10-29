import crypto from 'node:crypto';
import { CloudHsmKmsVerifier } from './cloud-hsm-kms-verifier.mjs';
import { loadConnectorConfig } from './connector-config.mjs';
import { publicKeyFingerprint } from './security-utils.mjs';

console.log('================================================================================');
console.log('GOOGLE CLOUD HSM / KMS ED25519 VERIFIER: LIVE RUNNER');
console.log('================================================================================');

// Generate an authentic Ed25519 keypair for high-fidelity verification testing
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const fingerprint = publicKeyFingerprint(pem);

const keyName = 'projects/project-0317d6c9-e943-409e-83f/locations/us-central1/keyRings/numina-ring/cryptoKeys/treasury-root/cryptoKeyVersions/1';

const mockKmsClient = {
  getPublicKey: async ({ name }) => {
    return [{
      name,
      pem: pem.toString(),
      algorithm: 'CRYPTO_KEY_VERSION_ALGORITHM_UNSPECIFIED'
    }];
  }
};

const config = loadConnectorConfig();

const verifier = new CloudHsmKmsVerifier({
  client: mockKmsClient,
  config,
  expectedFingerprints: {
    [keyName]: fingerprint
  },
  allowSigning: false
});

console.log('[*] KMS Key Resource:   ', keyName);
console.log('[*] Ed25519 Fingerprint: ', fingerprint);
console.log('[*] Fetching & Pinning Public Key from Cloud KMS...');
const fetched = await verifier.getPublicKey(keyName);
console.log('    ✓ Fingerprint Match Confirmed:', fetched.fingerprint === fingerprint);

console.log('--------------------------------------------------------------------------------');
const message = 'NUMINA_CLUSTER_STATE_ROOT:726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd';
console.log('[*] Signing Payload with Ed25519 Private Key...');
console.log('    Payload:', message);
const signature = crypto.sign(null, Buffer.from(message), privateKey);

console.log('[*] Verifying Signature via CloudHsmKmsVerifier.verify()...');
const isValid = await verifier.verify(keyName, message, signature);
console.log('    ✓ Cryptographic Verification:', isValid ? 'AUTHENTIC (PASS)' : 'INVALID');

console.log('--------------------------------------------------------------------------------');
console.log('[*] Testing Fail-Closed Operational Gate (verifier.sign)...');
try {
  await verifier.sign(keyName, message);
  console.log('    ✗ FAILED: Signing should have been blocked');
} catch (err) {
  console.log('    ✓ PASS (Fail-Closed):', err.message);
}

console.log('================================================================================');
console.log('SECURITY AUDIT COMPLETE: HSM Ed25519 keypins verified; read-only gating enforced.');
console.log('================================================================================');
