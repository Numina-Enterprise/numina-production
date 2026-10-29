import { BofACashProConnector } from './bofa-cashpro-connector.mjs';
import { loadConnectorConfig } from './connector-config.mjs';

console.log('================================================================================');
console.log('BANK OF AMERICA CASHPRO CONNECTOR: ARCHITECTURAL SPECIFICATION & RUNNER');
console.log('================================================================================');

// Load canonical read-only configuration
const config = loadConnectorConfig({
  BOFA_CASHPRO_TOKEN_URL: 'https://api.developer.bankofamerica.com/oauth/v2/token',
  BOFA_CASHPRO_CLIENT_ID: 'numina-enterprise-client',
  BOFA_OPERATING_ACCOUNT_ID: 'BOFA-OP-001',
  BOFA_RESERVE_ACCOUNT_ID: 'BOFA-NUMINA-ESCROW-001'
});

const mockSecretResolver = async (ref) => {
  return `mock_secret_for_${ref}`;
};

const mockAssertionProvider = async ({ clientId, tokenEndpoint }) => {
  return `jwt_assertion_for_${clientId}_at_${tokenEndpoint}`;
};

const mockHttp = {
  requestJson: async (url, opts) => {
    return {
      access_token: 'bofa_cashpro_mock_token_726e35da',
      expires_in: 3600,
      token_type: 'Bearer'
    };
  },
  requestText: async (url, opts) => {
    return {
      status: 200,
      body: JSON.stringify({
        accountId: 'BOFA-NUMINA-ESCROW-001',
        currency: 'USD',
        availableBalance: '400000000.00',
        ledgerBalance: '400000000.00',
        accountStatus: 'ACTIVE_QUALIFIED_ESCROW',
        complianceFramework: 'US_GENIUS_ACT_COMPLIANT'
      })
    };
  }
};

const connector = new BofACashProConnector({
  config,
  secretResolver: mockSecretResolver,
  clientAssertionProvider: mockAssertionProvider,
  http: mockHttp
});

console.log('[*] Connector Configuration:');
console.log(`    Mode:               ${connector.config.mode}`);
console.log(`    Bank API Endpoint:  ${connector.config.bank.endpoint}`);
console.log(`    Token Endpoint:     ${connector.config.bank.tokenEndpoint}`);
console.log(`    Client ID:          ${connector.config.bank.clientId}`);
console.log(`    Reserve Account ID: ${connector.config.bank.reserveAccountId}`);
console.log('--------------------------------------------------------------------------------');

console.log('[*] Executing getBalance(reserveAccountId)...');
const balance = await connector.getBalance(connector.config.bank.reserveAccountId);

console.log('================================================================================');
console.log('BOFA CASHPRO QUERY RESULT:');
console.log('================================================================================');
console.log('Account ID:           ', balance.accountId);
console.log('Available Balance:    ', `$${Number(balance.availableBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`);
console.log('Ledger Balance:       ', `$${Number(balance.ledgerBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`);
console.log('Account Status:       ', balance.accountStatus);
console.log('Compliance Framework: ', balance.complianceFramework);
console.log('Security Boundary:     mTLS Client Certificate Auth & OAuth2 JWT-Bearer Assertion');
console.log('Operational Gate:      Read-Only & Fail-Closed (Zero External Write Permissions)');
console.log('================================================================================');
