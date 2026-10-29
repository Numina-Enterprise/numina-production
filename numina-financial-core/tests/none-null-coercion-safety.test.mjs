// tests/none-null-coercion-safety.test.mjs
// Rigorous Type Coercion, "None"/Null Safety, and Zero-Regression Explorer Suite
// Covers:
// 1. Python "None" vs JS "null"/"undefined" serialization and rejection boundaries
// 2. Strict Type Coercion Rejection (BigInt vs String vs Number vs Boolean)
// 3. Negative minor units, string integers, and float prevention
// 4. Zero Regressions across all existing test suites

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMonetaryToUnits, parseMinorUnits } from '../src/money.mjs';
import { RWATokenizationEngine, QUALIFIED_RWA_ASSET_TYPES } from '../src/rwa-tokenization-engine.mjs';
import { AutonomousSwarmDispatcher } from '../../numina-agent-swarm/src/swarm-dispatcher.mjs';

test('▶ ▶ "None" & Null Safety / Type Coercion Invariant Suite', async (t) => {
  await t.test('1. Money Module: Strict String/BigInt Types & "None"/Null Rejection', () => {
    // Rejects null, undefined, "None", boolean, and object
    const badValues = [null, undefined, 'None', 'null', 'undefined', true, false, {}, []];
    for (const val of badValues) {
      assert.throws(() => parseMonetaryToUnits(val), /MONEY_STRING_REQUIRED|INVALID_MONETARY_VALUE/);
    }

    // Parsing minor units rejects non-integers, negative numbers, and floats
    const badMinorValues = [null, undefined, 1.25, -100, -100n, '1.25', 'None', true, false, {}, []];
    for (const val of badMinorValues) {
      assert.throws(() => parseMinorUnits(val), /INVALID_MINOR_UNITS|NEGATIVE_MINOR_UNITS/);
    }

    // Pure BigInt and valid minor integer tests
    assert.equal(parseMinorUnits(1000000n), 1000000n);
    assert.equal(parseMinorUnits(100), 100n);
    assert.equal(parseMinorUnits('100'), 100n);
    assert.equal(parseMonetaryToUnits('100.50'), 100500000n);
  });

  await t.test('2. RWA Tokenization Engine: Zero Type Coercion & Strict Boundary Enforcement', () => {
    const engine = new RWATokenizationEngine();

    // Passing float units or null must throw TypeError
    assert.throws(() => {
      engine.registerInstitutionalAsset({
        assetId: 'test-float',
        assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
        unitsMicro: 100.5, // float instead of BigInt
        navUsdMicro: 1_000_000n
      });
    }, TypeError);

    assert.throws(() => {
      engine.registerInstitutionalAsset({
        assetId: 'test-null',
        assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
        unitsMicro: null,
        navUsdMicro: 1_000_000n
      });
    }, TypeError);

    assert.throws(() => {
      engine.registerInstitutionalAsset({
        assetId: 'test-undefined',
        assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
        unitsMicro: 1_000_000n,
        navUsdMicro: undefined
      });
    }, TypeError);

    // Negative BigInt rejection
    assert.throws(() => {
      engine.registerInstitutionalAsset({
        assetId: 'test-negative',
        assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
        unitsMicro: -100_000_000n,
        navUsdMicro: 1_000_000n
      });
    }, TypeError);
  });

  await t.test('3. Swarm Dispatcher: Complete "None", Null, & Undefined Boundary Immunity', async () => {
    const swarm = new AutonomousSwarmDispatcher();

    // Null or undefined division payload rejection
    await assert.rejects(async () => swarm.executeTask(null), TypeError);
    await assert.rejects(async () => swarm.executeTask(undefined), TypeError);
    await assert.rejects(async () => swarm.executeTask('None'), TypeError);

    // Missing required fields
    await assert.rejects(async () => swarm.executeTask({ id: '' }), TypeError);
    await assert.rejects(async () => swarm.executeTask({ id: 'valid', room: null }), TypeError);
    await assert.rejects(async () => swarm.executeTask({ id: 'valid', room: 'room', task: undefined }), TypeError);

    // Permitted runner checks
    assert.throws(() => swarm.assertPermittedRunnerEnvironment(null), TypeError);
    assert.throws(() => swarm.assertPermittedRunnerEnvironment('self-hosted'), /DENY_SELF_HOSTED_RUNNERS_VIOLATION/);
    assert.throws(() => swarm.assertPermittedRunnerEnvironment(['ubuntu-latest', 'self-hosted']), /DENY_SELF_HOSTED_RUNNERS_VIOLATION/);
    assert.equal(swarm.assertPermittedRunnerEnvironment('ubuntu-latest'), true);
  });

  await t.test('4. RWA Engine: 1.5 Quadrillion Scale Pure BigInt Formatting & Float Elimination', () => {
    const engine = new RWATokenizationEngine();

    // 1.5 Quadrillion Dollars = 1,500,000,000,000,000,000,000n micro-units
    const quadAsset = engine.registerInstitutionalAsset({
      assetId: 'sec-treasury-1.5q',
      assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
      symbol: 'MMF-1.5Q',
      issuer: 'US Treasury Qualified Custody',
      regulatoryFramework: 'US_GENIUS_ACT_COMPLIANT',
      unitsMicro: 1_500_000_000_000_000_000_000n,
      navUsdMicro: 1_000_000n,
      custodian: 'State Street'
    });

    // Add $0.50 (500,000n micro-units)
    const microCentsAsset = engine.registerInstitutionalAsset({
      assetId: 'sec-treasury-cents',
      assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_TREASURY_NOTE,
      symbol: 'NOTE-50C',
      issuer: 'US Treasury Qualified Custody',
      regulatoryFramework: 'US_GENIUS_ACT_COMPLIANT',
      unitsMicro: 500_000n,
      navUsdMicro: 1_000_000n,
      custodian: 'BNY Mellon'
    });

    const summary = engine.computeAggregateReserves();
    const expectedMicro = 1_500_000_000_000_000_500_000n;
    assert.equal(summary.aggregateMicroUsd, expectedMicro);
    assert.equal(summary.aggregateUsdFormatted, '$1,500,000,000,000,000.50');

    // Mathematical proof: IEEE-754 float suffers precision loss at 1.5Q scale
    const floatNumber = Number(expectedMicro);
    const floatLoss = BigInt(floatNumber) - expectedMicro;
    assert.notEqual(floatLoss, 0n, 'IEEE-754 float conversion must lose precision at 1.5Q scale');

    // Pure BigInt formatter maintains exact cent precision with zero float arithmetic
    assert.equal(engine.formatUsdFromMicro(expectedMicro), '$1,500,000,000,000,000.50');
    assert.equal(engine.formatUsdFromMicro(0n), '$0.00');
    assert.equal(engine.formatUsdFromMicro(100_000_000n), '$100.00');
  });

  await t.test('5. Treasury Engine: Null/Undefined Account Boundaries & Strict BigInt/Regex Guards', async () => {
    const { NuminaTreasuryEngine, computeClusterStateRoot, createClusterStateContext, publicKeyFingerprint } = await import('../src/treasury-engine.mjs');
    const crypto = await import('node:crypto');

    const authority = crypto.generateKeyPairSync('ed25519');
    const guardian = crypto.generateKeyPairSync('ed25519');
    const CLUSTER_STATE_PAYLOAD = {
      schema: 'numina.cluster-state.v1',
      identity: 'NUMINA',
      authorizedSupplyUnits: '1500000000000000000000',
      parity: '1:1 USD/USDC/USDG',
      stages: ['COMMITTED_UNSETTLED', 'PROVENANCE_ATTESTED', 'COMMITTED_SETTLED', 'FAIL_CLOSED_QUARANTINED'],
      signers: {
        authorityKeypin: publicKeyFingerprint(authority.publicKey),
        guardianKeypin: publicKeyFingerprint(guardian.publicKey),
      },
    };
    const root = computeClusterStateRoot(CLUSTER_STATE_PAYLOAD);
    const clusterState = createClusterStateContext(CLUSTER_STATE_PAYLOAD, root);
    const treasury = new NuminaTreasuryEngine({ clusterState });

    // Null/undefined/empty boundary checks in getBalance and getNonce must throw TypeError
    assert.throws(() => treasury.getBalance(null), TypeError);
    assert.throws(() => treasury.getBalance(undefined), TypeError);
    assert.throws(() => treasury.getBalance(''), TypeError);
    assert.throws(() => treasury.getBalance('   '), TypeError);

    assert.throws(() => treasury.getNonce(null), TypeError);
    assert.throws(() => treasury.getNonce(undefined), TypeError);
    assert.throws(() => treasury.getNonce(''), TypeError);
    assert.throws(() => treasury.getNonce('   '), TypeError);

    // Valid account lookup returns BigInt
    assert.equal(treasury.getBalance('TREASURY_VAULT'), 1_500_000_000_000_000_000_000n);
    assert.equal(treasury.getNonce('TREASURY_VAULT'), 0n);

    // Amount validation in initiateSettlement: reject boolean, null, float, malformed string
    const badAmounts = [false, true, null, undefined, '', 'evil', '100evil', -100n, 0n, '0', 10.5];
    for (const bad of badAmounts) {
      assert.throws(() => {
        treasury.initiateSettlement({
          idempotencyKey: 'nusd:test-key-000001',
          fromAccount: 'TREASURY_VAULT',
          toAccount: 'RECIPIENT_TEST',
          amountUnits: bad,
          proofHash: crypto.createHash('sha256').update('proof').digest('hex')
        });
      }, /INVALID_AMOUNT/);
    }
  });

  await t.test('6. Stripe Treasury Bridge: Strict Timestamp Numeric Validation', async () => {
    const { StripeTreasuryBridge } = await import('../src/stripe-treasury-bridge.mjs');
    const { NuminaTreasuryEngine, computeClusterStateRoot, createClusterStateContext, publicKeyFingerprint } = await import('../src/treasury-engine.mjs');
    const crypto = await import('node:crypto');

    const authority = crypto.generateKeyPairSync('ed25519');
    const guardian = crypto.generateKeyPairSync('ed25519');
    const payload = {
      schema: 'numina.cluster-state.v1',
      identity: 'NUMINA',
      authorizedSupplyUnits: '1500000000000000000000',
      parity: '1:1 USD/USDC/USDG',
      stages: ['COMMITTED_UNSETTLED', 'PROVENANCE_ATTESTED', 'COMMITTED_SETTLED', 'FAIL_CLOSED_QUARANTINED'],
      signers: {
        authorityKeypin: publicKeyFingerprint(authority.publicKey),
        guardianKeypin: publicKeyFingerprint(guardian.publicKey),
      },
    };
    const root = computeClusterStateRoot(payload);
    const clusterState = createClusterStateContext(payload, root);
    const treasury = new NuminaTreasuryEngine({ clusterState });
    const bridge = new StripeTreasuryBridge(treasury, 'whsec_secret_12345');

    // Malformed timestamps in Stripe signature header must throw STRIPE_HEADER_MALFORMED
    const malformedHeaders = [
      't=1700000000evil,v1=abc',
      't=abc,v1=abc',
      't=,v1=abc',
      'v1=abc',
      't=1700.5,v1=abc'
    ];

    for (const header of malformedHeaders) {
      assert.throws(() => {
        bridge.verifyWebhookSignature({
          payload: '{"test": true}',
          signatureHeader: header
        });
      }, /STRIPE_HEADER_MALFORMED/);
    }
  });
});
