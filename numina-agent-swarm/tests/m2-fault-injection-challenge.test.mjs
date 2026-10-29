// tests/m2-fault-injection-challenge.test.mjs
// Milestone 2 Empirical Fault Injection Challenge Suite
// Authored by: Fault Injection Challenger (Milenger M2 2)
// Coverage:
// 1. State Root Drift Fault Injection (Swarm Dispatcher, Mesh Router, Smart Contracts, Treasury Context)
// 2. Sprint GID Poisoning (Forbidden GID 1219187222788173 rejection across Dispatcher & Mesh Router)
// 3. Type Coercion Fault Injection (Floats, booleans, empty strings into financial functions)
// 4. Null/Undefined & Prototype Fault Injection (getBalance, getNonce, executeTask, assertPermittedRunnerEnvironment)

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AutonomousSwarmDispatcher,
  CLUSTER_STATE_ROOT,
  SPRINT_GID,
  FORBIDDEN_SPRINT_GIDS
} from '../src/swarm-dispatcher.mjs';

import {
  MeshRouter,
  detectAnomaliesAndDrift,
  canonicalizeJson
} from '../../numina-doc-alignment/src/numina-mesh-router.mjs';

import {
  parseMonetaryToUnits,
  parseMinorUnits
} from '../../numina-financial-core/src/money.mjs';

import {
  RWATokenizationEngine,
  QUALIFIED_RWA_ASSET_TYPES
} from '../../numina-financial-core/src/rwa-tokenization-engine.mjs';

import {
  NuminaTreasuryEngine,
  computeClusterStateRoot,
  createClusterStateContext,
  publicKeyFingerprint,
  buildProviderAttestationPayload
} from '../../numina-financial-core/src/treasury-engine.mjs';

import {
  StripeTreasuryBridge
} from '../../numina-financial-core/src/stripe-treasury-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('▶ ▶ Milestone 2 Empirical Fault Injection Challenge Suite', async (t) => {

  // =========================================================================
  // SECTION 1: State Root Drift Fault Injection
  // =========================================================================
  await t.test('FAULT-INJECTION-1: State Root Drift Fault Injection (Mesh Router, Dispatcher, Contracts)', async () => {
    // 1.1 Swarm Dispatcher State Root Drift Rejection
    // Mutate first byte, last byte, and interior byte
    const mutatedRoots = [
      '82' + CLUSTER_STATE_ROOT.slice(2),
      CLUSTER_STATE_ROOT.slice(0, 62) + (CLUSTER_STATE_ROOT.endsWith('cd') ? 'ce' : 'cd'),
      CLUSTER_STATE_ROOT.slice(0, 32) + '00000000' + CLUSTER_STATE_ROOT.slice(40),
      '0'.repeat(64),
      'f'.repeat(64)
    ];

    for (const driftedRoot of mutatedRoots) {
      assert.throws(() => {
        new AutonomousSwarmDispatcher({ clusterStateRoot: driftedRoot });
      }, /STATE_ROOT_MISMATCH/, `Dispatcher must reject drifted root: ${driftedRoot}`);
    }

    // 1.2 Mesh Router State Root Drift Rejection & Auto-Quarantine
    const router = new MeshRouter({ manifestSha256: CLUSTER_STATE_ROOT });
    const canonicalRouterRoot = router.currentClusterStateRoot;
    const mutatedRouterRoot = '82' + canonicalRouterRoot.slice(2);

    // activateAllDefinedRooms must reject drifted attestedStateRoot
    assert.throws(() => {
      router.activateAllDefinedRooms({
        authoritySignatureHex: '00'.repeat(64),
        guardianSignatureHex: '00'.repeat(64),
        attestedStateRoot: mutatedRouterRoot,
        attestedManifestSha256: router.manifestSha256
      });
    }, /ATTESTATION_STATE_ROOT_MISMATCH/);

    // routeChannelMessage must detect drift, throw STATE_ROOT_DRIFT_DETECTED, and quarantine channel
    router.channelStates['C_NUMINA'].status = 'CHANNEL_ACTIVE_VERIFIED';
    assert.throws(() => {
      router.routeChannelMessage({
        channelId: 'C_NUMINA',
        expectedClusterStateRoot: mutatedRouterRoot,
      });
    }, /STATE_ROOT_DRIFT_DETECTED/);
    assert.equal(
      router.channelStates['C_NUMINA'].status,
      'CHANNEL_QUARANTINED_BY_DEFAULT',
      'Channel must be quarantined upon state root drift'
    );

    // 1.3 Financial Core Cluster State Context Drift Rejection
    const authorityKey = crypto.generateKeyPairSync('ed25519');
    const guardianKey = crypto.generateKeyPairSync('ed25519');
    const clusterStatePayload = {
      schema: 'numina.cluster-state.v1',
      identity: 'NUMINA',
      authorizedSupplyUnits: '1500000000000000000000',
      parity: '1:1 USD/USDC/USDG',
      stages: ['COMMITTED_UNSETTLED', 'PROVENANCE_ATTESTED', 'COMMITTED_SETTLED', 'FAIL_CLOSED_QUARANTINED'],
      signers: {
        authorityKeypin: publicKeyFingerprint(authorityKey.publicKey),
        guardianKeypin: publicKeyFingerprint(guardianKey.publicKey),
      },
    };
    const validClusterRoot = computeClusterStateRoot(clusterStatePayload);
    const driftedClusterRoot = '82' + validClusterRoot.slice(2);
    assert.throws(() => {
      createClusterStateContext(clusterStatePayload, driftedClusterRoot);
    }, /CLUSTER_STATE_ROOT_MISMATCH/);

    // 1.4 Smart Contract Sol State Root Invariant
    const contractPath = path.resolve(__dirname, '../../numina-smart-contracts/contracts/NuminaTreasuryReserve.sol');
    const solContent = fs.readFileSync(contractPath, 'utf8');
    const canonicalHexLiteral = `0x${CLUSTER_STATE_ROOT}`;
    assert.ok(solContent.includes(canonicalHexLiteral), 'Solidity contract must bind to canonical CLUSTER_STATE_ROOT');
    assert.ok(!solContent.includes(`0x82${CLUSTER_STATE_ROOT.slice(2)}`), 'Solidity contract must not contain drifted root');
  });

  // =========================================================================
  // SECTION 2: Sprint GID Poisoning
  // =========================================================================
  await t.test('FAULT-INJECTION-2: Sprint GID Poisoning Injection & Boundary Defense', () => {
    const forbiddenGid = '1219187222788173';

    // 2.1 Swarm Dispatcher instantiation rejection
    assert.throws(() => {
      new AutonomousSwarmDispatcher({ sprintGid: forbiddenGid });
    }, /FORBIDDEN_SPRINT_GID/);

    // 2.2 Swarm Dispatcher rejection of any forbidden GID from list
    for (const fgid of FORBIDDEN_SPRINT_GIDS) {
      assert.throws(() => {
        new AutonomousSwarmDispatcher({ sprintGid: fgid });
      }, /FORBIDDEN_SPRINT_GID/);
    }

    // 2.3 Mesh Router Anomaly Detection on Forbidden GID in payload
    const anomalyPayload = detectAnomaliesAndDrift(`Action on sprint task GID ${forbiddenGid} approved`);
    assert.equal(anomalyPayload.clean, false);
    assert.equal(anomalyPayload.anomalyType, 'FORBIDDEN_ASANA_GID');

    // 2.4 Mesh Router Anomaly Detection on Forbidden GID in routing context
    const anomalyContext = detectAnomaliesAndDrift('Valid status update', { asanaSprintGid: forbiddenGid });
    assert.equal(anomalyContext.clean, false);
    assert.equal(anomalyContext.anomalyType, 'FORBIDDEN_ASANA_GID');
  });

  // =========================================================================
  // SECTION 3: Type Coercion Fault Injection
  // =========================================================================
  await t.test('FAULT-INJECTION-3: Type Coercion Fault Injection (Floats, Booleans, Empty Strings)', () => {
    // 3.1 money.mjs: parseMonetaryToUnits rejection
    const invalidMonetaryValues = [
      10.5, 0.1, 1.0000001, 100, // numbers (floats & ints)
      false, true,               // booleans
      '', '   ',                 // empty / whitespace
      '10.5000001',              // > 6 decimal places
      '-10.50',                  // negative string
      'abc', 'NaN', 'null',      // garbage strings
      null, undefined, NaN, Infinity,
      {}, []
    ];
    for (const val of invalidMonetaryValues) {
      assert.throws(
        () => parseMonetaryToUnits(val),
        /MONEY_STRING_REQUIRED|INVALID_MONETARY_VALUE/,
        `parseMonetaryToUnits must reject: ${val}`
      );
    }

    // 3.2 money.mjs: parseMinorUnits rejection
    const invalidMinorUnits = [
      10.5, 0.1, 1.0000001,      // floats
      '10.5', '0.1',             // float strings
      false, true,               // booleans
      'false', 'true',           // boolean strings
      '', '   ',                 // empty / whitespace strings
      -100, -100n, '-100',       // negative values
      null, undefined, NaN, Infinity, 'None', '012',
      {}, []
    ];
    for (const val of invalidMinorUnits) {
      assert.throws(
        () => parseMinorUnits(val),
        /INVALID_MINOR_UNITS|NEGATIVE_MINOR_UNITS/,
        `parseMinorUnits must reject: ${val}`
      );
    }

    // 3.3 rwa-tokenization-engine.mjs: formatUsdFromMicro non-BigInt rejection
    const rwaEngine = new RWATokenizationEngine();
    const badMicroInputs = [10.5, 0.1, 100, false, true, '', '   ', '100', null, undefined, {}, []];
    for (const val of badMicroInputs) {
      assert.throws(() => rwaEngine.formatUsdFromMicro(val), TypeError);
    }

    // 3.4 rwa-tokenization-engine.mjs: registerInstitutionalAsset type enforcement
    const badUnitsMicro = [10.5, 0.1, 100, false, true, '', '   ', '100', 0n, -100n, null, undefined, {}, []];
    for (const val of badUnitsMicro) {
      assert.throws(() => {
        rwaEngine.registerInstitutionalAsset({
          assetId: 'test-bad-units',
          assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
          unitsMicro: val,
          navUsdMicro: 1_000_000n
        });
      }, TypeError, `registerInstitutionalAsset must reject unitsMicro: ${val}`);
    }

    // 3.5 treasury-engine.mjs: initiateSettlement amountUnits type coercion rejection
    const authority = crypto.generateKeyPairSync('ed25519');
    const guardian = crypto.generateKeyPairSync('ed25519');
    const clusterStatePayload = {
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
    const root = computeClusterStateRoot(clusterStatePayload);
    const clusterState = createClusterStateContext(clusterStatePayload, root);
    const treasury = new NuminaTreasuryEngine({ clusterState });

    const badAmounts = [
      false, true,               // booleans
      '', '   ',                 // empty / whitespace
      10.5, 0.1, 100,            // numbers
      '10.5',                    // float string
      '0', 0n, -100n, '-100',    // non-positive
      '100evil',                 // malformed suffix
      null, undefined, {}, []
    ];
    let counter = 1;
    for (const b of badAmounts) {
      assert.throws(() => {
        treasury.initiateSettlement({
          idempotencyKey: `nusd:fault-test-${counter++}`,
          fromAccount: 'TREASURY_VAULT',
          toAccount: 'RECIPIENT_TEST',
          amountUnits: b,
          proofHash: crypto.createHash('sha256').update('proof').digest('hex')
        });
      }, /INVALID_AMOUNT/, `initiateSettlement must reject amountUnits: ${b}`);
    }

    // 3.6 treasury-engine.mjs: buildProviderAttestationPayload amountUnits validation
    for (const b of [false, true, '', '   ', 10.5, 0.1, 100, '10.5', '100evil', null, undefined, {}, []]) {
      assert.throws(() => {
        buildProviderAttestationPayload({
          clusterRoot: root,
          provider: 'STRIPE_TREASURY',
          reference: 'ref_123',
          amountUnits: b,
          statementHash: 'a'.repeat(64)
        });
      }, /PROVIDER_AMOUNT_INVALID/);
    }

    // 3.7 stripe-treasury-bridge.mjs: verifyWebhookSignature strict timestamp validation
    const bridge = new StripeTreasuryBridge(treasury, 'whsec_test_secret_sample');
    const badHeaders = [
      't=1700.5,v1=abc',
      't=1700evil,v1=abc',
      't=false,v1=abc',
      't=true,v1=abc',
      't=,v1=abc',
      'v1=abc',
      't=-1700,v1=abc'
    ];
    for (const h of badHeaders) {
      assert.throws(() => {
        bridge.verifyWebhookSignature({ payload: '{}', signatureHeader: h });
      }, /STRIPE_HEADER_MALFORMED/);
    }
  });

  // =========================================================================
  // SECTION 4: Null/Undefined & Prototype Fault Injection
  // =========================================================================
  await t.test('FAULT-INJECTION-4: Null/Undefined & Prototype Fault Injection', async () => {
    const authority = crypto.generateKeyPairSync('ed25519');
    const guardian = crypto.generateKeyPairSync('ed25519');
    const clusterStatePayload = {
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
    const root = computeClusterStateRoot(clusterStatePayload);
    const clusterState = createClusterStateContext(clusterStatePayload, root);
    const treasury = new NuminaTreasuryEngine({ clusterState });
    const swarm = new AutonomousSwarmDispatcher();

    // 4.1 getBalance & getNonce null/undefined/prototype rejection with TypeError
    const badAccountIds = [
      null, undefined, '', '   ',
      123, true, false,
      Object.prototype, {}, [],
      { toString: () => 'TREASURY_VAULT' }
    ];
    for (const bad of badAccountIds) {
      assert.throws(() => treasury.getBalance(bad), TypeError);
      assert.throws(() => treasury.getNonce(bad), TypeError);
    }

    // 4.2 assertPermittedRunnerEnvironment null/undefined/prototype rejection
    const nullishRunners = [null, undefined, '', false, 0];
    for (const nr of nullishRunners) {
      assert.throws(() => swarm.assertPermittedRunnerEnvironment(nr), TypeError);
    }

    const forbiddenRunners = [
      'self-hosted',
      'SELF-HOSTED',
      'self-hosted-runner',
      ['ubuntu-latest', 'self-hosted'],
      ['ubuntu-latest', null],
      ['ubuntu-latest', undefined],
      ['ubuntu-latest', 123],
      Object.prototype,
      {}
    ];
    for (const fr of forbiddenRunners) {
      assert.throws(
        () => swarm.assertPermittedRunnerEnvironment(fr),
        /DENY_SELF_HOSTED_RUNNERS_VIOLATION/
      );
    }

    // 4.3 executeTask null/undefined/prototype rejection with TypeError
    const badDivisions = [
      null,
      undefined,
      '',
      'None',
      123,
      false,
      true,
      {},
      { id: null, room: 'room', task: 'task' },
      { id: 'id', room: null, task: 'task' },
      { id: 'id', room: 'room', task: null },
      { id: undefined, room: 'room', task: 'task' },
      { id: 'id', room: undefined, task: 'task' },
      { id: 'id', room: 'room', task: undefined },
      { id: '', room: 'room', task: 'task' },
      { id: '   ', room: 'room', task: 'task' },
      { id: 'id', room: '', task: 'task' },
      { id: 'id', room: '   ', task: 'task' },
      { id: 'id', room: 'room', task: '' },
      { id: 'id', room: 'room', task: '   ' },
      Object.create(null)
    ];
    for (const bd of badDivisions) {
      await assert.rejects(async () => swarm.executeTask(bd), TypeError);
    }

    // 4.4 canonicalizeJson prototype pollution protection
    const pollutedPayloads = [
      JSON.parse('{"__proto__": {"injected": true}}'),
      JSON.parse('{"constructor": {"injected": true}}'),
      JSON.parse('{"prototype": {"injected": true}}')
    ];
    for (const payload of pollutedPayloads) {
      assert.throws(() => canonicalizeJson(payload), /PROTOTYPE_POLLUTION_KEY_REJECTED/);
    }
  });

});
