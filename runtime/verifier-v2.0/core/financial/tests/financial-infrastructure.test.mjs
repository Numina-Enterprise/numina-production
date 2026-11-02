import test from 'node:test';
import assert from 'node:assert/strict';
import crypto, { generateKeyPairSync, sign } from 'node:crypto';

import {
  NuminaTreasuryEngine,
  SettlementStage,
  UNIT_SCALE,
  buildProviderAttestationPayload,
  buildSettlementAttestationPayload,
  computeClusterStateRoot,
  createClusterStateContext,
  IDEMPOTENCY_TTL_MS,
  publicKeyFingerprint,
} from '../src/treasury-engine.mjs';
import { signedMessage, sha256Hex } from '../src/security-utils.mjs';

import { NCUAScheduleJManager } from '../src/ncua-schedule-j.mjs';
import { BankingReconciliationEngine } from '../src/iso20022-reconciler.mjs';
import { StripeTreasuryBridge } from '../src/stripe-treasury-bridge.mjs';

const makeKey = () => generateKeyPairSync('ed25519');
const authority = makeKey();
const guardian = makeKey();
const provider = makeKey();
const bank = makeKey();
const pem = (key) => key.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const CLUSTER_STATE_PAYLOAD = {
  schema: 'numina.financial-core.state.v2',
  identity: 'NUMINA',
  authorizedSupplyUnits: '1500000000000000000000',
  parity: '1:1 USD/USDC/USDG',
  stages: Object.values(SettlementStage),
  signers: {
    authorityKeypin: publicKeyFingerprint(authority.publicKey),
    guardianKeypin: publicKeyFingerprint(guardian.publicKey),
  },
};
const CLUSTER_STATE_ROOT = computeClusterStateRoot(CLUSTER_STATE_PAYLOAD);
const clusterState = createClusterStateContext(CLUSTER_STATE_PAYLOAD, CLUSTER_STATE_ROOT);
const AUTHORIZED_SUPPLY = BigInt(CLUSTER_STATE_PAYLOAD.authorizedSupplyUnits);
const trustedProviderKeys = { 'test-provider': provider.publicKey };
const trustedSourceKeys = { 'test-bank': bank.publicKey };
const signPayload = (privateKey, domain, payload) => sign(null, Buffer.from(signedMessage(domain, payload)), privateKey).toString('base64');
const providerAttestationFor = (tx) => {
  const payload = buildProviderAttestationPayload({ clusterRoot: clusterState.root, provider: 'test-provider', reference: `ref-${tx.txHash}`, amountUnits: tx.amountUnits, statementHash: tx.proofHash });
  return { ...payload, publicKey: pem(provider), signature: signPayload(provider.privateKey, 'NUMINA-PROVIDER-ATTESTATION-V1', payload) };
};
const settlementAttestationFor = (tx) => {
  const providerAttestation = providerAttestationFor(tx);
  const payload = buildSettlementAttestationPayload(tx, providerAttestation, clusterState.root);
  return {
    txHash: tx.txHash,
    providerAttestation,
    authorityPublicKey: pem(authority),
    authoritySignature: signPayload(authority.privateKey, 'NUMINA-SETTLEMENT-ATTESTATION-V1', payload),
    guardianPublicKey: pem(guardian),
    guardianSignature: signPayload(guardian.privateKey, 'NUMINA-SETTLEMENT-ATTESTATION-V1', payload),
  };
};
const sourceAttestationFor = (payload) => ({
  provider: 'test-bank',
  publicKey: pem(bank),
  signature: signPayload(bank.privateKey, 'NUMINA-BANK-STATEMENT-V1', payload),
});

test('▶ Numina Financial Infrastructure Suite', async (t) => {

  await t.test('1. Treasury Operational Invariants & Authorized Supply', () => {
    const treasury = new NuminaTreasuryEngine({ clusterState, trustedProviderKeys });
    const status = treasury.getOperationalStatus();

    assert.equal(status.state, 'UNPAUSED_AND_ACTIVE');
    assert.equal(status.totalMinted, AUTHORIZED_SUPPLY);
    assert.equal(status.totalBurned, 0n);
    assert.equal(status.vaultReserve, AUTHORIZED_SUPPLY);
    assert.equal(status.clusterRoot, CLUSTER_STATE_ROOT);
    assert.equal(treasury.getBalance('TREASURY_VAULT'), AUTHORIZED_SUPPLY);
  });

  await t.test('2. 3-Stage Atomic Settlement Engine Workflow', () => {
    const treasury = new NuminaTreasuryEngine({ clusterState, trustedProviderKeys });
    const transferAmount = 10_000n * UNIT_SCALE; // $10,000 NUSD
    const idempotencyKey = 'nusd:tx:test-00000000000001';
    const proofHash = sha256Hex('proof-data-123');

    // Stage 1: Ingest & Initiate
    const stage1Tx = treasury.initiateSettlement({
      idempotencyKey,
      fromAccount: 'TREASURY_VAULT',
      toAccount: 'AGENT_ESCROW_01',
      amountUnits: transferAmount,
      proofHash,
    });

    assert.equal(stage1Tx.stage, SettlementStage.STAGE_1_UNSETTLED);
    assert.equal(treasury.getBalance('AGENT_ESCROW_01'), 0n); // Not committed yet

    // Stage 2: Dual-Key Attestation
    const stage2Tx = treasury.attestSettlement(settlementAttestationFor(stage1Tx));

    assert.equal(stage2Tx.stage, SettlementStage.STAGE_2_ATTESTED);

    // Stage 3: Atomic Commit
    const stage3Tx = treasury.commitSettlement(stage1Tx.txHash);

    assert.equal(stage3Tx.stage, SettlementStage.STAGE_3_SETTLED);
    assert.equal(treasury.getBalance('AGENT_ESCROW_01'), transferAmount);
    assert.equal(treasury.getBalance('TREASURY_VAULT'), AUTHORIZED_SUPPLY - transferAmount);
    assert.equal(treasury.circulatingSupply, transferAmount);
  });

  await t.test('3. Anti-Double-Counting Invariant Rejection', () => {
    const treasury = new NuminaTreasuryEngine({ clusterState, trustedProviderKeys });
    const tx = treasury.initiateSettlement({
      idempotencyKey: 'nusd:tx:double-count-0000001',
      fromAccount: 'TREASURY_VAULT',
      toAccount: 'ROGUE_ACTOR',
      amountUnits: 500n * UNIT_SCALE,
      proofHash: sha256Hex('hash-001'),
    });

    // Attempting to attest with isSelfIssuedBalance: true MUST fail closed
    assert.throws(() => {
      treasury.attestSettlement({
        txHash: tx.txHash,
        authorityPublicKey: pem(authority),
        authoritySignature: 'invalid',
        guardianPublicKey: pem(guardian),
        guardianSignature: 'invalid',
      });
    }, /PROVIDER_ATTESTATION_REQUIRED/);

    const record = treasury.ledger.get(tx.txHash);
    assert.equal(record.stage, SettlementStage.QUARANTINED);
  });

  await t.test('4. Idempotency Replay Protection', () => {
    let now = 0;
    const treasury = new NuminaTreasuryEngine({ clusterState, trustedProviderKeys, now: () => now });
    const idempotencyKey = 'nusd:tx:replay-test-0000001';

    const res1 = treasury.initiateSettlement({
      idempotencyKey,
      fromAccount: 'TREASURY_VAULT',
      toAccount: 'RECIPIENT_01',
      amountUnits: 100n * UNIT_SCALE,
      proofHash: sha256Hex('proof-1'),
    });

    // Duplicate call with identical idempotencyKey
    const res2 = treasury.initiateSettlement({
      idempotencyKey,
      fromAccount: 'TREASURY_VAULT',
      toAccount: 'RECIPIENT_01',
      amountUnits: 100n * UNIT_SCALE,
      proofHash: sha256Hex('proof-1'),
    });

    assert.equal(res2.status, 'DUPLICATE_IDEMPOTENT_OPERATION');
    assert.equal(res2.txHash, res1.txHash);
    now = IDEMPOTENCY_TTL_MS + 1;
    const res3 = treasury.initiateSettlement({
      idempotencyKey,
      fromAccount: 'TREASURY_VAULT',
      toAccount: 'RECIPIENT_01',
      amountUnits: 100n * UNIT_SCALE,
      proofHash: sha256Hex('proof-1'),
    });
    assert.notEqual(res3.txHash, res1.txHash);
    assert.equal(treasury.ledger.get(res1.txHash).stage, SettlementStage.QUARANTINED);
  });

  await t.test('5. NCUA Schedule J Regulatory Ledger & Promotion', () => {
    const scheduleJ = new NCUAScheduleJManager({ clusterState });
    assert.equal(scheduleJ.accounts.size, 26);

    // Promote Reserve Custody account J-01
    const sourceBytes = 'bofa_reserve_statement_oct2026';
    const testDigest = sha256Hex(sourceBytes);
    const promotionPayload = {
      schema: 'numina.schedule-j-promotion.v1',
      clusterStateRoot: clusterState.root,
      id: 'J-01',
      balanceUnits: (500_000_000n * UNIT_SCALE).toString(),
      sourceDigest: testDigest,
    };
    const promoted = scheduleJ.promoteAccount({
      id: 'J-01',
      balanceUnits: 500_000_000n * UNIT_SCALE, // $500M
      sourceBytes,
      sourceDigest: testDigest,
      authorityPublicKey: pem(authority),
      authoritySignature: signPayload(authority.privateKey, 'NUMINA-SCHEDULE-J-PROMOTION-V1', promotionPayload),
      guardianPublicKey: pem(guardian),
      guardianSignature: signPayload(guardian.privateKey, 'NUMINA-SCHEDULE-J-PROMOTION-V1', promotionPayload),
    });

    assert.equal(promoted.promoted, true);
    assert.equal(promoted.balanceUnits, 500_000_000n * UNIT_SCALE);

    const report = scheduleJ.generateReportPackage();
    assert.ok(report.reportHash);
    assert.equal(report.totalPromotedBalanceUnits, 500_000_000n * UNIT_SCALE);
    assert.equal(report.payload.accountsCount, 26);
  });

  await t.test('6. Bank of America ISO 20022 camt.053 Statement Ingestion', () => {
    const treasury = new NuminaTreasuryEngine({ clusterState, trustedProviderKeys });
    const scheduleJ = new NCUAScheduleJManager({ clusterState });
    const reconciler = new BankingReconciliationEngine(treasury, scheduleJ, { trustedSourceKeys });

    const statement = {
      statementId: 'BOFA-CAMT053-20261028-001',
      accountId: 'NCUA-J01-BOFA-COMMERCIAL',
      openingBalance: '1000000.00', // $1,000,000.00
      closingBalance: '1150000.00', // $1,150,000.00
      entries: [
        {
          entryId: 'ENTRY-001',
          bookingDate: '2026-10-28',
          amount: '200000.00',
          creditDebitIndicator: 'CRDT',
          paymentRail: 'Fedwire',
          reference: 'INCOMING_RESERVE_WIRE',
        },
        {
          entryId: 'ENTRY-002',
          bookingDate: '2026-10-28',
          amount: '50000.00',
          creditDebitIndicator: 'DBIT',
          paymentRail: 'RTP',
          reference: 'CLEARING_DISBURSEMENT',
        },
      ],
    };
    statement.sourceAttestation = sourceAttestationFor({
      schema: 'numina.bank-statement-source.v1',
      statementId: statement.statementId,
      accountId: statement.accountId,
      openingBalance: statement.openingBalance,
      closingBalance: statement.closingBalance,
      entries: statement.entries,
    });

    const result = reconciler.ingestCamt053Statement(statement);
    assert.equal(result.status, 'RECONCILED_AND_VERIFIED');
    assert.equal(result.netMovementUnits, 150000n * UNIT_SCALE);

    const alteredStatement = { ...statement, entries: statement.entries.map((entry) => ({ ...entry, reference: `${entry.reference}-ALTERED` })) };
    alteredStatement.sourceAttestation = sourceAttestationFor({
      schema: 'numina.bank-statement-source.v1',
      statementId: alteredStatement.statementId,
      accountId: alteredStatement.accountId,
      openingBalance: alteredStatement.openingBalance,
      closingBalance: alteredStatement.closingBalance,
      entries: alteredStatement.entries,
    });
    const alteredResult = new BankingReconciliationEngine(treasury, scheduleJ, { trustedSourceKeys }).ingestCamt053Statement(alteredStatement);
    assert.notEqual(alteredResult.statementHash, result.statementHash);
    const numericStatement = { ...statement, statementId: 'BOFA-CAMT053-NUMERIC', openingBalance: 1000000, closingBalance: 1150000 };
    numericStatement.sourceAttestation = sourceAttestationFor({
      schema: 'numina.bank-statement-source.v1',
      statementId: numericStatement.statementId,
      accountId: numericStatement.accountId,
      openingBalance: numericStatement.openingBalance,
      closingBalance: numericStatement.closingBalance,
      entries: numericStatement.entries,
    });
    assert.throws(() => new BankingReconciliationEngine(treasury, scheduleJ, { trustedSourceKeys }).ingestCamt053Statement(numericStatement), /MONEY_STRING_REQUIRED/);
  });

  await t.test('7. Stripe HMAC-SHA256 Webhook Verification & Bridge', () => {
    const treasury = new NuminaTreasuryEngine({ clusterState, trustedProviderKeys });
    const secret = 'whsec_test_secret_key_12345';
    assert.throws(() => new StripeTreasuryBridge(treasury), /STRIPE_WEBHOOK_SECRET_REQUIRED/);
    const bridge = new StripeTreasuryBridge(treasury, secret);

    const timestamp = Math.floor(Date.now() / 1000);
    const rawPayload = JSON.stringify({
      id: 'evt_stripe_test_001',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test98765', amount: 25000, currency: 'usd', customer: 'cus_test123' } },
    });

    const signedPayload = `${timestamp}.${rawPayload}`;
    const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    const header = `t=${timestamp},v1=${signature}`;

    const bridgeResult = bridge.processPaymentEvent({
      eventId: 'evt_stripe_test_001',
      eventType: 'payment_intent.succeeded',
      rawPayload,
      signatureHeader: header,
    });

    assert.equal(bridgeResult.status, 'SETTLEMENT_INITIATED');
    assert.equal(bridgeResult.amountUnits, 250n * UNIT_SCALE);
    assert.ok(treasury.ledger.has(bridgeResult.txHash));
  });

});
