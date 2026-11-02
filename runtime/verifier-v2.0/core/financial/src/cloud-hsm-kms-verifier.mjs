import crypto from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { publicKeyFingerprint } from './security-utils.mjs';
import { assertReadOnlyConfig, loadConnectorConfig } from './connector-config.mjs';

export class CloudHsmKmsVerifier {
  constructor({ client = new KeyManagementServiceClient(), config = loadConnectorConfig(), expectedFingerprints = {}, allowSigning = false } = {}) {
    assertReadOnlyConfig(config);
    this.client = client;
    this.config = config;
    this.expectedFingerprints = { ...expectedFingerprints };
    this.allowSigning = allowSigning === true && process.env.NUMINA_ENABLE_HSM_SIGNING === 'true';
  }

  async getPublicKey(keyName) {
    const [response] = await this.client.getPublicKey({ name: keyName });
    if (!response?.pem) throw new Error('HSM_PUBLIC_KEY_MISSING');
    const fingerprint = publicKeyFingerprint(response.pem);
    const expected = this.expectedFingerprints[keyName];
    if (expected && fingerprint !== expected) throw new Error('HSM_KEYPIN_MISMATCH');
    return { keyName, pem: response.pem, fingerprint, algorithm: response.algorithm || 'UNKNOWN' };
  }

  async verify(keyName, message, signature) {
    const publicKey = await this.getPublicKey(keyName);
    const key = crypto.createPublicKey(publicKey.pem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('HSM_ED25519_REQUIRED');
    const signatureBytes = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'base64');
    return crypto.verify(null, Buffer.from(message), key, signatureBytes);
  }

  async sign(keyName, message) {
    if (!this.allowSigning) throw new Error('HSM_SIGNING_DISABLED_READ_ONLY');
    const [response] = await this.client.asymmetricSign({ name: keyName, data: Buffer.from(message) });
    if (!response?.signature) throw new Error('HSM_SIGNATURE_MISSING');
    return Buffer.from(response.signature);
  }
}
