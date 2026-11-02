import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const SECRET_REF = /^secret:\/\/gcp-kms\/projects\/([^/]+)\/secrets\/([^/]+)$/;

export class GcpSecretResolver {
  constructor({ client = new SecretManagerServiceClient(), version = 'latest' } = {}) {
    this.client = client;
    this.version = version;
  }

  async read(reference) {
    const match = String(reference || '').match(SECRET_REF);
    if (!match) throw new Error('GCP_SECRET_REFERENCE_INVALID');
    const [, projectId, secretId] = match;
    const [response] = await this.client.accessSecretVersion({ name: `projects/${projectId}/secrets/${secretId}/versions/${this.version}` });
    const data = response?.payload?.data;
    if (!data) throw new Error('GCP_SECRET_PAYLOAD_MISSING');
    return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
  }
}
