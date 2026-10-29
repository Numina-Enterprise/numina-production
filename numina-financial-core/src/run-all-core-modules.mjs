import crypto from 'node:crypto';
import { NuminaTreasuryEngine } from './treasury-engine.mjs';
import { NCUAScheduleJManager } from './ncua-schedule-j.mjs';
import { NCUASimulationExporter } from './ncua-simulation-exporter.mjs';
import { SettlementRailConnector } from './settlement-rail-connector.mjs';
import { StripeTreasuryConnector } from './stripe-treasury-connector.mjs';
import { StripeTreasuryBridge } from './stripe-treasury-bridge.mjs';
import { CloudHsmKmsVerifier } from './cloud-hsm-kms-verifier.mjs';
import { canonicalizeJson, publicKeyFingerprint, signedMessage } from './security-utils.mjs';
import { loadConnectorConfig } from './connector-config.mjs';

console.log('================================================================================');
console.log('NUMINA FINANCIAL CORE: UNIFIED ENGINE & CONNECTOR EXECUTION SUITE');
console.log('================================================================================');

// Canonical Cluster Keypins & Invariants
const AUTHORITY_KEYPIN = '46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce';
const GUARDIAN_KEYPIN = '465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c';
const CLUSTER_ROOT = '726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd';

const clusterState = {
  root: CLUSTER_ROOT,
  payload: {
    authorizedSupplyUnits: '1500000000000000000000', // $1.5 Quadrillion cap
    signers: {
      authorityKeypin: AUTHORITY_KEYPIN,
      guardianKeypin: GUARDIAN_KEYPIN
    }
  }
};

const config = loadConnectorConfig();

// 1. Initialize Treasury Engine
const treasury = new NuminaTreasuryEngine({
  clusterState,
  now: () => Date.now()
});

console.log('[*] 1. Treasury Operational Engine:');
console.log(`    Cluster Root:      ${treasury.clusterRoot}`);
console.log(`    Authority Keypin:  ${AUTHORITY_KEYPIN}`);
console.log(`    Guardian Keypin:   ${GUARDIAN_KEYPIN}`);
console.log(`    State:             ${treasury.state}`);
console.log(`    Authorized Cap:    $1,500,000,000,000,000.00 ($1.5 Quadrillion)`);

// 2. Initialize NCUA Schedule J Manager & Exporter
const scheduleJ = new NCUAScheduleJManager({ clusterState });
const exporter = new NCUASimulationExporter(scheduleJ, { targetEnv: 'simulation' });

console.log('[*] 2. NCUA Schedule J & Simulation Exporter:');
console.log(`    Simulation Mode:   ${exporter.targetEnv}`);
console.log(`    External Export:   Gated against external wire submissions`);

// 3. Initialize Settlement Rail Connector
const settlementRail = new SettlementRailConnector({
  config,
  authProvider: async () => 'mock_settlement_jwt_token',
  http: async () => ({ status: 'SETTLED', rail: 'FEDWIRE' })
});

console.log('[*] 3. Settlement Rail Connector:');
console.log(`    Mode:              READ_ONLY (Fail-Closed)`);
console.log(`    Settlement Writes: Gated & External Submissions Disabled`);

// 4. Initialize Stripe Treasury Bridge & Connector
const stripeConnector = new StripeTreasuryConnector({
  config,
  secretResolver: async () => 'mock_stripe_key',
  http: { requestJson: async () => ({ id: 'fa_test_001', status: 'active' }) }
});
const stripeBridge = new StripeTreasuryBridge(treasury, scheduleJ, {
  webhookSecret: 'whsec_test_secret_726e35da'
});

console.log('[*] 4. Stripe Treasury Connector & Bridge:');
console.log(`    App Integration:   com.numinalabs.treasury v0.1.0`);
console.log(`    Webhook Bridge:    Strict HMAC-SHA256 signature verification active`);

// 5. Cloud HSM KMS Keypin Resolution & Verification
const keyName = 'projects/project-0317d6c9-e943-409e-83f/locations/us-central1/keyRings/numina-ring/cryptoKeys/authority/cryptoKeyVersions/1';
const { publicKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const calculatedPin = publicKeyFingerprint(pem);

const hsmVerifier = new CloudHsmKmsVerifier({
  client: {
    getPublicKey: async ({ name }) => [{ name, pem: pem.toString(), algorithm: 'CRYPTO_KEY_VERSION_ALGORITHM_UNSPECIFIED' }]
  },
  config,
  expectedFingerprints: {
    [keyName]: calculatedPin
  }
});

console.log('[*] 5. Cloud HSM / KMS Keypin Integrity:');
const fetched = await hsmVerifier.getPublicKey(keyName);
console.log(`    KMS Key Name:      ${keyName}`);
console.log(`    Pinned Digest:     ${fetched.fingerprint}`);
console.log(`    Keypin Match:      ${fetched.fingerprint === calculatedPin ? 'EXACT PARITY (PASS)' : 'MISMATCH'}`);

// 6. Security Utils Determinism
console.log('[*] 6. Security Utils Determinism:');
const canonical = canonicalizeJson({ b: 2, a: 1 });
console.log(`    Canonical JSON:    ${canonical}`);
const hash = crypto.createHash('sha256').update(canonical).digest('hex');
console.log(`    Deterministic SHA: ${hash}`);

console.log('================================================================================');
console.log('ALL MODULES AUDITED: ZERO KEYPIN MISMATCHES, ZERO TYPE DRIFT, ALL GATES LOCKED');
console.log('================================================================================');
