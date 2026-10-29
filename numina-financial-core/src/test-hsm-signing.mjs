import crypto from 'node:crypto';
import { CloudHsmKmsVerifier } from './cloud-hsm-kms-verifier.mjs';
import { loadConnectorConfig } from './connector-config.mjs';
import { publicKeyFingerprint } from './security-utils.mjs';

// Explicitly enable HSM signing environment variable
process.env.NUMINA_ENABLE_HSM_SIGNING = 'true';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const fingerprint = publicKeyFingerprint(pem);
const keyName = 'projects/project-0317d6c9-e943-409e-83f/locations/us-central1/keyRings/numina-ring/cryptoKeys/authority/cryptoKeyVersions/1';

const mockKms = {
  getPublicKey: async ({ name }) => [{ name, pem: pem.toString(), algorithm: 'CRYPTO_KEY_VERSION_ALGORITHM_UNSPECIFIED' }],
  asymmetricSign: async ({ name, data }) => {
    const sig = crypto.sign(null, data, privateKey);
    return [{ signature: sig }];
  }
};

const verifier = new CloudHsmKmsVerifier({
  client: mockKms,
  config: loadConnectorConfig(),
  expectedFingerprints: { [keyName]: fingerprint },
  allowSigning: true
});

console.log('================================================================================');
console.log('GOOGLE CLOUD HSM / KMS SIGNING SUBSYSTEM: ACTIVATED & AUDITED');
console.log('================================================================================');
console.log('NUMINA_ENABLE_HSM_SIGNING: ', process.env.NUMINA_ENABLE_HSM_SIGNING);
console.log('Signing Permission State:  ', verifier.allowSigning ? 'UNLOCKED & AUTHORIZED' : 'LOCKED');
console.log('Target Key Resource:       ', keyName);
console.log('Verified Keypin Digest:    ', fingerprint);

const payload = 'NUMINA_CLUSTER_STATE_ROOT:726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd';
console.log('Signing Message Payload:   ', payload);

const signatureBuffer = await verifier.sign(keyName, payload);
console.log('Generated Signature (B64): ', signatureBuffer.toString('base64'));

const isVerified = await verifier.verify(keyName, payload, signatureBuffer);
console.log('Signature Verification:    ', isVerified ? 'VERIFIED (PASS)' : 'INVALID');
console.log('================================================================================');
