import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConnectorConfig, DEFAULT_CONNECTOR_CONFIG } from '../src/connector-config.mjs';

console.log('================================================================================');
console.log('NUMINA FINANCIAL CORE — STAGING ENVIRONMENT VALIDATION');
console.log('Timestamp: ' + new Date().toISOString());
console.log('================================================================================');

let passedChecks = 0;
let totalChecks = 0;

function check(name, condition, detail = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`[PASS] ${name}${detail ? ' - ' + detail : ''}`);
  } else {
    console.log(`[FAIL] ${name}${detail ? ' - ' + detail : ''}`);
  }
}

// 1. Connector Mode
const config = loadConnectorConfig();
check('Connector Mode is strictly READ_ONLY', config.mode === 'READ_ONLY', config.mode);
check('Settlement write submissions disabled', config.settlement.allowSettlementSubmission === false);
check('NCUA submission disabled', config.ncua.submissionEnabled === false, config.ncua.mode);

// 2. Google Application Default Credentials (ADC)
const adcPath = path.join(os.homedir(), 'AppData', 'Roaming', 'gcloud', 'application_default_credentials.json');
const adcExists = fs.existsSync(adcPath);
check('Google Application Default Credentials (ADC) present', adcExists, adcPath);

// 3. Vault Reference Schema Validation
const vaultPattern = /^secret:\/\/gcp-kms\/project-0317d6c9-e943-409e-83f\/secrets\/[a-z0-9-]+$/;
check('BofA Client Cert Secret Reference valid', vaultPattern.test(config.bank.clientCertRef));
check('BofA Private Key Secret Reference valid', vaultPattern.test(config.bank.privateKeyRef));
check('Stripe Restricted Key Secret Reference valid', vaultPattern.test(config.stripe.restrictedApiKeyRef));
check('Stripe Webhook Secret Reference valid', vaultPattern.test(config.stripe.webhookSecretRef));

// 4. HSM Cloud KMS Configuration
check('Cloud KMS project pinned', config.hsm.projectId === 'project-0317d6c9-e943-409e-83f');
check('Cloud KMS keyRing pinned', config.hsm.keyRing === 'numina-treasury-keyring');
check('Cloud KMS algorithm pinned to ED25519', config.hsm.algorithm === 'ED25519');

// 5. Environment Leak Defense (Zero Secrets in Environment)
const forbiddenEnvKeys = [
  'STRIPE_SECRET_KEY',
  'STRIPE_API_KEY',
  'BOFA_PRIVATE_KEY',
  'ED25519_PRIVATE_KEY',
  'SEED_PHRASE'
];
const leakedKeys = forbiddenEnvKeys.filter(k => Boolean(process.env[k]));
check('Zero plaintext secrets detected in process environment', leakedKeys.length === 0,
      leakedKeys.length === 0 ? 'Clean' : `VIOLATION: ${leakedKeys.join(', ')}`);

console.log('================================================================================');
console.log(`VALIDATION RESULT: ${passedChecks}/${totalChecks} CHECKS PASSED`);
console.log('Status: READ-ONLY STAGING HARNESS READY');
console.log('================================================================================');

if (passedChecks !== totalChecks) {
  process.exit(1);
}
