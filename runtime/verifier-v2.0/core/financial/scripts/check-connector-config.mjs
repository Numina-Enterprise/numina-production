import { assertReadOnlyConfig, loadConnectorConfig } from '../src/connector-config.mjs';

const config = loadConnectorConfig();
assertReadOnlyConfig(config);
console.log(JSON.stringify({
  mode: config.mode,
  bank: { provider: config.bank.provider, endpoint: config.bank.endpoint, secretReferencesPresent: true },
  stripe: { environment: config.stripe.environment, accountId: config.stripe.accountId, apiVersion: config.stripe.apiVersion, secretReferencesPresent: true },
  hsm: { projectId: config.hsm.projectId, location: config.hsm.location, algorithm: config.hsm.algorithm },
  ncua: { mode: config.ncua.mode, submissionEnabled: config.ncua.submissionEnabled },
  settlement: { rails: config.settlement.rails, allowSettlementSubmission: config.settlement.allowSettlementSubmission },
}, null, 2));
