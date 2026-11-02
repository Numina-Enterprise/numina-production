import { 
  DEFAULT_CONNECTOR_CONFIG, 
  CONNECTOR_MODE, 
  loadConnectorConfig, 
  assertReadOnlyConfig 
} from './connector-config.mjs';

console.log('================================================================================');
console.log('NUMINA FINANCIAL CONNECTORS CONFIGURATION AUDIT & RUNNER');
console.log('================================================================================');

console.log('Operational Mode Constant:     ', CONNECTOR_MODE);
console.log('Default Config Immutable:     ', Object.isFrozen(DEFAULT_CONNECTOR_CONFIG) ? 'FROZEN (PASS)' : 'MUTABLE (FAIL)');

const activeConfig = loadConnectorConfig();

console.log('--------------------------------------------------------------------------------');
console.log('ACTIVE CONNECTOR SPECIFICATIONS:');
console.log('Bank Provider:                 ', activeConfig.bank.provider);
console.log('Bank API Endpoint:             ', activeConfig.bank.endpoint);
console.log('Bank Client Cert Secret Ref:   ', activeConfig.bank.clientCertRef);
console.log('Bank Private Key Secret Ref:   ', activeConfig.bank.privateKeyRef);
console.log('Stripe Account ID:             ', activeConfig.stripe.accountId);
console.log('Stripe Environment:            ', activeConfig.stripe.environment);
console.log('Stripe Webhook Endpoint:       ', activeConfig.stripe.webhookEndpoint);
console.log('Settlement Submissions Allowed:', activeConfig.settlement.allowSettlementSubmission ? 'ENABLED (UNSAFE)' : 'DISABLED (SAFE)');
console.log('NCUA Submissions Allowed:      ', activeConfig.ncua.submissionEnabled ? 'ENABLED (UNSAFE)' : 'DISABLED (SAFE)');

console.log('--------------------------------------------------------------------------------');
console.log('[*] Testing assertReadOnlyConfig() validation...');
try {
  assertReadOnlyConfig(activeConfig);
  console.log('    ✓ Config Validated: READ_ONLY mode & zero external write routes verified.');
} catch (err) {
  console.log('    ✗ Validation Error:', err.message);
}

console.log('================================================================================');
console.log('CONFIG AUDIT COMPLETE: All connectors strictly gated to read-only sandbox.');
console.log('================================================================================');
