// tests/m2-empirical-challenger.test.mjs
// Milestone 2 Empirical Challenger Test Suite: Financial Rails & Type Safety
// Tests:
// 1. Pure BigInt Formatting Oracle vs IEEE-754 Float Precision Loss at 1.5Q Scale
// 2. Comprehensive Type Mutation & Coercion Fuzzing (57 Mutation Cases) across money.mjs and treasury-engine.mjs
// 3. Null/Undefined/Whitespace Account Boundary Verification
// 4. Stripe Treasury Bridge Timestamp Strict Numeric Parsing

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseMonetaryToUnits, parseMinorUnits } from '../src/money.mjs';
import { RWATokenizationEngine } from '../src/rwa-tokenization-engine.mjs';
import {
  NuminaTreasuryEngine,
  computeClusterStateRoot,
  createClusterStateContext,
  publicKeyFingerprint,
  buildProviderAttestationPayload
} from '../src/treasury-engine.mjs';
import { StripeTreasuryBridge } from '../src/stripe-treasury-bridge.mjs';

// Independent mathematical oracle for USD formatting from micro-units
function oracleFormatUsd(micro) {
  if (typeof micro !== 'bigint') {
    throw new TypeError('Oracle requires BigInt');
  }
  const isNeg = micro < 0n;
  const abs = isNeg ? -micro : micro;
  const whole = abs / 1_000_000n;
  const rem = abs % 1_000_000n;
  const centsNum = rem / 10_000n;
  const centsStr = centsNum < 10n ? '0' + centsNum.toString() : centsNum.toString();

  // Add commas to whole
  const wholeStr = whole.toString();
  let withCommas = '';
  const len = wholeStr.length;
  for (let i = 0; i < len; i++) {
    if (i > 0 && (len - i) % 3 === 0) {
      withCommas += ',';
    }
    withCommas += wholeStr[i];
  }
  return `${isNeg ? '-' : ''}$${withCommas}.${centsStr}`;
}

test('▶ ▶ Milestone 2 Empirical Challenge: Financial Core & Type Safety', async (t) => {
  const engine = new RWATokenizationEngine();

  await t.test('CHALLENGE-1: Pure BigInt Formatting Oracle vs IEEE-754 Float at 1.5Q Scale', async () => {
    // 1.1 Deterministic boundary testing across positive, negative, zero, and micro boundaries
    const boundaryCases = [
      { micro: 0n, expected: '$0.00' },
      { micro: 1n, expected: '$0.00' }, // fractional micro-cent truncates to 00
      { micro: 9_999n, expected: '$0.00' },
      { micro: 10_000n, expected: '$0.01' },
      { micro: 50_000n, expected: '$0.05' },
      { micro: 990_000n, expected: '$0.99' },
      { micro: 1_000_000n, expected: '$1.00' },
      { micro: 1_000_000_000n, expected: '$1,000.00' },
      { micro: 1_000_000_000_000n, expected: '$1,000,000.00' },
      { micro: 1_000_000_000_000_000n, expected: '$1,000,000,000.00' },
      { micro: 1_000_000_000_000_000_000n, expected: '$1,000,000,000,000.00' },
      { micro: 1_500_000_000_000_000_000_000n, expected: '$1,500,000,000,000,000.00' },
      { micro: 1_500_000_000_000_000_010_000n, expected: '$1,500,000,000,000,000.01' },
      { micro: 1_500_000_000_000_000_500_000n, expected: '$1,500,000,000,000,000.50' },
      { micro: 1_500_000_000_000_000_990_000n, expected: '$1,500,000,000,000,000.99' },
      { micro: -10_000n, expected: '-$0.01' },
      { micro: -1_000_000n, expected: '-$1.00' },
      { micro: -1_500_000_000_000_000_000_000n, expected: '-$1,500,000,000,000,000.00' },
      { micro: -1_500_000_000_000_000_500_000n, expected: '-$1,500,000,000,000,000.50' }
    ];

    for (const { micro, expected } of boundaryCases) {
      const actual = engine.formatUsdFromMicro(micro);
      const oracle = oracleFormatUsd(micro);
      assert.equal(actual, expected, `Failed on micro=${micro}`);
      assert.equal(actual, oracle, `Engine format diverged from oracle on micro=${micro}`);
    }

    // 1.2 Generator Harness: Fuzz 100 pseudo-random values around 1.5Q scale
    const base15Q = 1_500_000_000_000_000_000_000n;
    for (let i = 0; i < 100; i++) {
      const offsetCents = BigInt(Math.floor(Math.random() * 100_000_000) - 50_000_000);
      const testValue = base15Q + offsetCents * 10_000n;
      const engineResult = engine.formatUsdFromMicro(testValue);
      const oracleResult = oracleFormatUsd(testValue);
      assert.equal(engineResult, oracleResult, `Fuzzed generator mismatch at ${testValue}`);
    }

    // 1.3 Empirical Proof: IEEE-754 Float Precision Failure Demonstration
    // At 1 cent ($0.01 = 10_000n micro-units):
    const target1Cent = base15Q + 10_000n;
    const floatVal1 = Number(target1Cent);
    const floatLoss1 = BigInt(floatVal1) - target1Cent;
    assert.notEqual(floatLoss1, 0n, 'IEEE-754 float conversion MUST lose precision at 1.5Q scale');

    // Float-based division loses the 1 cent entirely ($0.00 formatted)
    const floatFormatted1Cent = (Number(target1Cent) / 1_000_000).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
    assert.equal(floatFormatted1Cent, '$1,500,000,000,000,000.00', 'Float formatting erased the 1 cent');
    // BigInt formatter preserves exact 1 cent
    assert.equal(engine.formatUsdFromMicro(target1Cent), '$1,500,000,000,000,000.01');

    // At 25 cents ($0.25 = 250_000n micro-units):
    const target25Cents = base15Q + 250_000n;
    const floatFormatted25Cents = (Number(target25Cents) / 1_000_000).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
    // Float corrupts 25 cents into 20 cents
    assert.equal(floatFormatted25Cents, '$1,500,000,000,000,000.20', 'Float formatting corrupted 25 cents to 20 cents');
    // BigInt formatter preserves exact 25 cents
    assert.equal(engine.formatUsdFromMicro(target25Cents), '$1,500,000,000,000,000.25');

    // At 99 cents ($0.99 = 990_000n micro-units):
    const target99Cents = base15Q + 990_000n;
    const floatFormatted99Cents = (Number(target99Cents) / 1_000_000).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });
    // Float corrupts 99 cents into $1.00
    assert.equal(floatFormatted99Cents, '$1,500,000,000,000,001.00', 'Float formatting rounded 99 cents up to $1.00');
    // BigInt formatter preserves exact 99 cents
    assert.equal(engine.formatUsdFromMicro(target99Cents), '$1,500,000,000,000,000.99');
  });

  await t.test('CHALLENGE-2: 57-Case Type Mutation & Coercion Fuzzing Harness', async () => {
    // 57 distinct JavaScript mutation inputs
    const mutationMatrix = [
      // 1-4: Nullish and booleans
      { label: 'null', val: null },
      { label: 'undefined', val: undefined },
      { label: 'true', val: true },
      { label: 'false', val: false },
      // 5-17: Numbers
      { label: 'number 0', val: 0 },
      { label: 'number -0', val: -0 },
      { label: 'number 1', val: 1 },
      { label: 'number -1', val: -1 },
      { label: 'number 1.5', val: 1.5 },
      { label: 'number -1.5', val: -1.5 },
      { label: 'number 0.000001', val: 0.000001 },
      { label: 'number 1e6', val: 1e6 },
      { label: 'number NaN', val: NaN },
      { label: 'number Infinity', val: Infinity },
      { label: 'number -Infinity', val: -Infinity },
      { label: 'number MAX_SAFE_INTEGER', val: Number.MAX_SAFE_INTEGER },
      { label: 'number unsafe integer', val: Number.MAX_SAFE_INTEGER + 100 },
      // 18-38: Strings
      { label: 'empty string', val: '' },
      { label: 'whitespace string', val: '   ' },
      { label: 'string "0"', val: '0' },
      { label: 'string "00"', val: '00' },
      { label: 'string "01"', val: '01' },
      { label: 'string "100"', val: '100' },
      { label: 'string "-100"', val: '-100' },
      { label: 'string "100.50"', val: '100.50' },
      { label: 'string "100.500000"', val: '100.500000' },
      { label: 'string "100.5000001"', val: '100.5000001' },
      { label: 'string "1e6"', val: '1e6' },
      { label: 'string "0x10"', val: '0x10' },
      { label: 'string "0b10"', val: '0b10' },
      { label: 'string "0o10"', val: '0o10' },
      { label: 'string "100n"', val: '100n' },
      { label: 'string "100_000"', val: '100_000' },
      { label: 'string "None"', val: 'None' },
      { label: 'string "null"', val: 'null' },
      { label: 'string "undefined"', val: 'undefined' },
      { label: 'string "NaN"', val: 'NaN' },
      { label: 'string "Infinity"', val: 'Infinity' },
      // 39-40: Symbols
      { label: 'symbol test', val: Symbol('test') },
      { label: 'symbol for money', val: Symbol.for('money') },
      // 41-48: Objects, Arrays, Functions
      { label: 'empty object', val: {} },
      { label: 'object with val', val: { value: 100 } },
      { label: 'object with toString', val: { toString: () => '100' } },
      { label: 'object with valueOf', val: { valueOf: () => 100 } },
      { label: 'empty array', val: [] },
      { label: 'array with number', val: [100] },
      { label: 'array with string', val: ['100'] },
      { label: 'function', val: () => {} },
      // 49-52: BigInts
      { label: 'bigint 0n', val: 0n },
      { label: 'bigint -100n', val: -100n },
      { label: 'bigint 100n', val: 100n },
      { label: 'bigint 1.5Q', val: 1_500_000_000_000_000_000_000n },
      // 53-57: Other complex structures
      { label: 'Date object', val: new Date() },
      { label: 'RegExp object', val: new RegExp('100') },
      { label: 'Map object', val: new Map() },
      { label: 'Set object', val: new Set() },
      { label: 'Uint8Array', val: new Uint8Array([1, 2, 3]) }
    ];

    assert.equal(mutationMatrix.length, 57, 'Must test exactly 57 mutation cases');

    // Setup treasury engine context for settlement fuzzing
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

    for (const { label, val } of mutationMatrix) {
      // 2.1 parseMinorUnits: Only non-negative BigInt, non-negative safe integers, and canonical base-10 strings pass
      const isCanonicalIntString = typeof val === 'string' && /^(?:0|[1-9]\d*)$/.test(val);
      const isNonNegSafeInt = typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
      const isNonNegBigInt = typeof val === 'bigint' && val >= 0n;

      if (isCanonicalIntString || isNonNegSafeInt || isNonNegBigInt) {
        assert.doesNotThrow(() => parseMinorUnits(val), `parseMinorUnits should accept valid ${label}`);
      } else {
        assert.throws(() => parseMinorUnits(val), /INVALID_MINOR_UNITS|NEGATIVE_MINOR_UNITS/, `parseMinorUnits must reject ${label}`);
      }

      // 2.2 initiateSettlement amountUnits: Strictly rejects numbers, booleans, floats, non-canon strings, objects
      const isPositiveBigInt = typeof val === 'bigint' && val > 0n;
      const isPositiveIntString = typeof val === 'string' && /^[1-9]\d*$/.test(val);

      if (isPositiveBigInt || isPositiveIntString) {
        assert.doesNotThrow(() => {
          treasury.initiateSettlement({
            idempotencyKey: `nusd:fuzz-${Math.random().toString(36).slice(2, 12)}`,
            fromAccount: 'TREASURY_VAULT',
            toAccount: 'RECIPIENT_TEST',
            amountUnits: val,
            proofHash: crypto.createHash('sha256').update('proof').digest('hex')
          });
        }, `initiateSettlement should accept positive BigInt or canonical string integer for ${label}`);
      } else {
        assert.throws(() => {
          treasury.initiateSettlement({
            idempotencyKey: `nusd:fuzz-${Math.random().toString(36).slice(2, 12)}`,
            fromAccount: 'TREASURY_VAULT',
            toAccount: 'RECIPIENT_TEST',
            amountUnits: val,
            proofHash: crypto.createHash('sha256').update('proof').digest('hex')
          });
        }, /INVALID_AMOUNT/, `initiateSettlement MUST throw INVALID_AMOUNT on ${label}`);
      }

      // 2.3 buildProviderAttestationPayload amountUnits: Accepts only non-negative BigInt or canonical string integer
      if (isNonNegBigInt || isCanonicalIntString) {
        assert.doesNotThrow(() => {
          buildProviderAttestationPayload({
            clusterRoot: root,
            provider: 'BOFA_CASHPRO',
            reference: 'REF-001',
            amountUnits: val,
            statementHash: crypto.createHash('sha256').update('stmt').digest('hex')
          });
        }, `buildProviderAttestationPayload should accept ${label}`);
      } else {
        assert.throws(() => {
          buildProviderAttestationPayload({
            clusterRoot: root,
            provider: 'BOFA_CASHPRO',
            reference: 'REF-001',
            amountUnits: val,
            statementHash: crypto.createHash('sha256').update('stmt').digest('hex')
          });
        }, /PROVIDER_AMOUNT_INVALID/, `buildProviderAttestationPayload MUST reject ${label}`);
      }
    }
  });

  await t.test('CHALLENGE-3: Null, Undefined & Whitespace Account Boundaries in Treasury Engine', async () => {
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

    const badAccountIds = [
      null,
      undefined,
      '',
      '   ',
      '\t\n',
      123,
      true,
      false,
      {},
      [],
      Symbol('acc')
    ];

    for (const bad of badAccountIds) {
      assert.throws(() => treasury.getBalance(bad), TypeError, `getBalance must throw TypeError for ${String(bad)}`);
      assert.throws(() => treasury.getNonce(bad), TypeError, `getNonce must throw TypeError for ${String(bad)}`);
    }

    // Valid account lookup returns BigInt without coercion
    assert.equal(typeof treasury.getBalance('TREASURY_VAULT'), 'bigint');
    assert.equal(typeof treasury.getNonce('TREASURY_VAULT'), 'bigint');
    assert.equal(treasury.getBalance('TREASURY_VAULT'), 1_500_000_000_000_000_000_000n);
    assert.equal(treasury.getNonce('TREASURY_VAULT'), 0n);
  });

  await t.test('CHALLENGE-4: Stripe Treasury Bridge Strict Numeric Timestamp Parsing', async () => {
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

    // Permissive parseInt vulnerabilities: '1700000000evil', '1700.5', '1700_000'
    const adversarialTimestamps = [
      't=1700000000evil,v1=abc',
      't=1700.50,v1=abc',
      't=-1700000000,v1=abc',
      't=0x1700,v1=abc',
      't=1700_000,v1=abc',
      't=,v1=abc',
      'v1=abc',
      't=NaN,v1=abc',
      't=Infinity,v1=abc'
    ];

    for (const header of adversarialTimestamps) {
      assert.throws(() => {
        bridge.verifyWebhookSignature({
          payload: '{"test":true}',
          signatureHeader: header
        });
      }, /STRIPE_HEADER_MALFORMED/, `Header ${header} must fail closed`);
    }
  });
});
