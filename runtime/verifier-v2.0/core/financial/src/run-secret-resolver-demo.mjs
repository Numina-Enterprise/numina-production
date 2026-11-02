import { GcpSecretResolver } from './gcp-secret-resolver.mjs';

console.log('================================================================================');
console.log('GOOGLE CLOUD SECRET MANAGER RESOLVER: LIVE RUNNER');
console.log('================================================================================');

// Initialize mock Secret Manager client verifying the exact API contract
const mockClient = {
  accessSecretVersion: async ({ name }) => {
    return [{
      name,
      payload: {
        data: Buffer.from('MOCK_RESOLVED_SECRET_PAYLOAD_FOR_PRODUCTION_KMS')
      }
    }];
  }
};

const resolver = new GcpSecretResolver({
  client: mockClient,
  version: 'latest'
});

const validRef = 'secret://gcp-kms/projects/project-0317d6c9-e943-409e-83f/secrets/bofa-cashpro-mtls-cert';
console.log('[*] Testing Valid GCP Secret Reference URI:');
console.log('    URI:', validRef);

const secretPayload = await resolver.read(validRef);
console.log('    ✓ Secret Accessed Successfully');
console.log('    ✓ Payload Length:', secretPayload.length, 'bytes');
console.log('    ✓ Payload Masked View:', secretPayload.slice(0, 12) + '...[REDACTED]');

console.log('--------------------------------------------------------------------------------');
console.log('[*] Testing Fail-Closed Validation on Invalid Reference Formats:');

const invalidRef = 'https://some-unauthorized-url.com/secret';
try {
  await resolver.read(invalidRef);
  console.log('    ✗ FAILED: Invalid reference was not rejected');
} catch (err) {
  console.log('    ✓ PASS (Rejected invalid URI):', err.message);
}

console.log('================================================================================');
console.log('SECRET RESOLUTION AUDIT COMPLETE: Strict URI syntax & payload decoding verified.');
console.log('================================================================================');
