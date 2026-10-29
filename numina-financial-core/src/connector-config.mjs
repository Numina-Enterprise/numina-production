const BOFA_ENDPOINT = 'https://api.developer.bankofamerica.com/cashpro/sandbox/v1';
const PROJECT = 'project-0317d6c9-e943-409e-83f';

export const CONNECTOR_MODE = 'READ_ONLY';

export const DEFAULT_CONNECTOR_CONFIG = Object.freeze({
  mode: CONNECTOR_MODE,
  bank: {
    provider: 'bofa-cashpro',
    endpoint: BOFA_ENDPOINT,
    tokenEndpointEnv: 'BOFA_CASHPRO_TOKEN_URL',
    clientIdEnv: 'BOFA_CASHPRO_CLIENT_ID',
    operatingAccountEnv: 'BOFA_OPERATING_ACCOUNT_ID',
    reserveAccountEnv: 'BOFA_RESERVE_ACCOUNT_ID',
    clientCertRef: `secret://gcp-kms/${PROJECT}/secrets/bofa-cashpro-mtls-cert`,
    privateKeyRef: `secret://gcp-kms/${PROJECT}/secrets/bofa-cashpro-mtls-key`,
    clientSecretRef: `secret://gcp-kms/${PROJECT}/secrets/bofa-cashpro-client-secret`,
  },
  stripe: {
    environment: 'test',
    accountIdEnv: 'STRIPE_ACCOUNT_ID',
    accountId: 'acct_1UEEPnQdJat0efmT',
    restrictedApiKeyRef: `secret://gcp-kms/${PROJECT}/secrets/stripe-restricted-api-key`,
    webhookSecretRef: `secret://gcp-kms/${PROJECT}/secrets/stripe-webhook-signing-secret`,
    webhookEndpoint: 'https://xyz.numinalabs.app/api/webhooks/stripe',
    apiVersion: '2026-09-30.endive',
  },
  hsm: {
    projectId: PROJECT,
    location: 'us-central1',
    keyRing: 'numina-treasury-keyring',
    authorityKey: `projects/${PROJECT}/locations/us-central1/keyRings/numina-treasury-keyring/cryptoKeys/authority-skott34-ed25519/cryptoKeyVersions/1`,
    guardianKey: `projects/${PROJECT}/locations/us-central1/keyRings/numina-treasury-keyring/cryptoKeys/guardian-ed25519/cryptoKeyVersions/1`,
    algorithm: 'ED25519',
  },
  ncua: {
    mode: 'SIMULATION_EXPORT',
    form: '5300',
    schedule: 'J',
    ombControlNumber: '3133-0004',
    submissionEnabled: false,
  },
  settlement: {
    endpoint: `${BOFA_ENDPOINT}/payments`,
    rails: ['RTP', 'FEDWIRE', 'NACHA_ACH'],
    allowSettlementSubmission: false,
  },
});

export function loadConnectorConfig(env = process.env) {
  const config = structuredClone(DEFAULT_CONNECTOR_CONFIG);
  if (env.NUMINA_CONNECTOR_MODE && env.NUMINA_CONNECTOR_MODE !== CONNECTOR_MODE) throw new Error('CONNECTOR_MODE_MUST_REMAIN_READ_ONLY');
  config.bank.clientId = env[config.bank.clientIdEnv] || null;
  config.bank.tokenEndpoint = env[config.bank.tokenEndpointEnv] || null;
  config.bank.operatingAccountId = env[config.bank.operatingAccountEnv] || null;
  config.bank.reserveAccountId = env[config.bank.reserveAccountEnv] || null;
  config.stripe.accountId = env[config.stripe.accountIdEnv] || config.stripe.accountId;
  config.settlement.allowSettlementSubmission = false;
  return config;
}

export function assertReadOnlyConfig(config) {
  if (config.mode !== CONNECTOR_MODE) throw new Error('CONNECTOR_MODE_MUST_REMAIN_READ_ONLY');
  if (config.settlement.allowSettlementSubmission !== false || config.ncua.submissionEnabled !== false) throw new Error('EXTERNAL_WRITES_DISABLED');
  return true;
}
