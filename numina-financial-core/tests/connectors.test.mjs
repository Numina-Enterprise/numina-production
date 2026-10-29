import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { BofACashProConnector } from '../src/bofa-cashpro-connector.mjs';
import { parseCamt053 } from '../src/camt-parser.mjs';
import { CloudHsmKmsVerifier } from '../src/cloud-hsm-kms-verifier.mjs';
import { loadConnectorConfig } from '../src/connector-config.mjs';
import { GcpSecretResolver } from '../src/gcp-secret-resolver.mjs';
import { NCUASimulationExporter } from '../src/ncua-simulation-exporter.mjs';
import { SettlementRailConnector } from '../src/settlement-rail-connector.mjs';
import { StripeTreasuryConnector } from '../src/stripe-treasury-connector.mjs';
import { publicKeyFingerprint } from '../src/security-utils.mjs';

const XML = `<?xml version="1.0"?><Document><BkToCstmrStmt><Stmt><Id>S1</Id><Acct><Id><Othr><Id>A1</Id></Othr></Id></Acct><Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="USD">1.00</Amt></Bal><Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="USD">1.50</Amt></Bal><Ntry><NtryRef>E1</NtryRef><Amt Ccy="USD">0.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-28</Dt></BookgDt><AddtlNtryInf>R1</AddtlNtryInf></Ntry></Stmt></BkToCstmrStmt></Document>`;

const config = loadConnectorConfig({ BOFA_CASHPRO_CLIENT_ID: 'client', BOFA_CASHPRO_TOKEN_URL: 'https://sandbox.invalid/oauth/token', STRIPE_ACCOUNT_ID: 'acct_test' });

test('connector configuration is sandbox and read-only', () => {
  assert.equal(config.mode, 'READ_ONLY');
  assert.equal(config.settlement.allowSettlementSubmission, false);
  assert.equal(config.ncua.submissionEnabled, false);
});

test('GCP secret references resolve through Secret Manager without exposing values', async () => {
  let requestedName;
  const resolver = new GcpSecretResolver({ client: { accessSecretVersion: async ({ name }) => { requestedName = name; return [{ payload: { data: Buffer.from('secret-value') } }]; } } });
  assert.equal(await resolver.read('secret://gcp-kms/projects/project-1/secrets/example'), 'secret-value');
  assert.equal(requestedName, 'projects/project-1/secrets/example/versions/latest');
});

test('camt.053 parser preserves fixed-point decimal strings', () => {
  const statement = parseCamt053(XML);
  assert.equal(statement.statementId, 'S1');
  assert.equal(statement.openingBalance, '1.00');
  assert.equal(statement.entries[0].amount, '0.50');
});

test('CashPro connector uses mTLS secrets and only reads statements', async () => {
  const calls = [];
  const connector = new BofACashProConnector({
    config,
    secretResolver: async (reference) => `secret-for-${reference}`,
    clientAssertionProvider: async () => 'signed-client-assertion',
    http: {
      requestJson: async (url) => { calls.push(['json', url]); return { access_token: 'token', expires_in: 600 }; },
      requestText: async (url, options) => { calls.push(['text', url, options.method || 'GET']); return { status: 200, body: Buffer.from(XML), headers: {} }; },
    },
  });
  const statement = await connector.listStatements('A1');
  assert.equal(statement.statementId, 'S1');
  assert.equal(calls[0][0], 'json');
  assert.equal(calls[1][0], 'text');
});

test('Stripe connector verifies raw webhooks and exposes read methods only', async () => {
  const fakeEvent = { id: 'evt_1', type: 'received_credit.created' };
  const client = {
    webhooks: { constructEvent: (body, signature, secret) => { assert.equal(body.toString(), 'raw'); assert.equal(signature, 'sig'); assert.equal(secret, 'whsec_test'); return fakeEvent; } },
    treasury: {
      financialAccounts: { retrieve: async (id) => ({ id }) },
      transactions: { list: async (params) => params },
    },
    paymentIntents: { retrieve: async (id) => ({ id }) },
  };
  const connector = new StripeTreasuryConnector({ client, webhookSecret: 'whsec_test', config });
  assert.deepEqual(connector.verifyWebhook(Buffer.from('raw'), 'sig'), fakeEvent);
  assert.deepEqual(await connector.retrieveFinancialAccount('fa_123'), { id: 'fa_123' });
  assert.equal((await connector.listTransactions('fa_123')).financial_account, 'fa_123');
});

test('Cloud KMS verifier checks Ed25519 public-key fingerprints and keeps signing gated', async () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyName = config.hsm.authorityKey;
  const client = { getPublicKey: async () => [{ pem, algorithm: 'EC_SIGN_ED25519' }], asymmetricSign: async () => { throw new Error('must not sign'); } };
  const verifier = new CloudHsmKmsVerifier({ client, config, expectedFingerprints: { [keyName]: publicKeyFingerprint(pem) } });
  const message = Buffer.from('kms-probe');
  const signature = crypto.sign(null, message, pair.privateKey);
  assert.equal(await verifier.verify(keyName, message, signature), true);
  await assert.rejects(() => verifier.sign(keyName, message), /HSM_SIGNING_DISABLED_READ_ONLY/);
});

test('NCUA export is simulation-only and settlement writes are rejected', async () => {
  const exporter = new NCUASimulationExporter({ config, signer: { sign: async () => Buffer.from('signature') } });
  const accounts = Array.from({ length: 26 }, (_, index) => ({ id: `J-${String(index + 1).padStart(2, '0')}`, category: 'SIMULATION', balanceUnits: '0', promoted: false, digest: null }));
  const result = await exporter.export({ payload: { clusterRoot: 'a'.repeat(64), accounts } }, { keyName: config.hsm.authorityKey });
  assert.equal(result.mode, 'SIMULATION_EXPORT');
  assert.equal(result.submissionEnabled, false);
  assert.throws(() => exporter.submit(), /SIMULATION_ONLY/);
  const settlement = new SettlementRailConnector({ config, authProvider: async () => 'token', http: async () => ({ ok: true }) });
  assert.throws(() => settlement.submitTransfer(), /DRY_RUN_REJECTED_BY_GATE/);
});
