import crypto from 'node:crypto';
import { BankingReconciliationEngine } from './iso20022-reconciler.mjs';
import { signedMessage } from './security-utils.mjs';

console.log('================================================================================');
console.log('ISO 20022 BANKING RECONCILIATION ENGINE: LIVE RUNNER');
console.log('================================================================================');

// Generate an Ed25519 keypair for trusted bank attestation
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const bankPubKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

const mockTreasury = {
  clusterRoot: '726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd',
  now: () => '2026-10-28T21:23:45.000Z'
};

const mockScheduleJ = {
  clusterState: { root: '726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd' }
};

const reconciler = new BankingReconciliationEngine(mockTreasury, mockScheduleJ, {
  trustedSourceKeys: {
    'bofa-cashpro': bankPubKeyPem
  }
});

console.log('[*] Cluster State Root: ', reconciler.treasury.clusterRoot);
console.log('[*] Trusted Bank Source:', 'bofa-cashpro (Ed25519 Signed Envelope)');

const statementPayload = {
  statementId: 'STMT-BOFA-2026-10-28-001',
  accountId: 'BOFA-NUMINA-ESCROW-001',
  openingBalance: '350000000.00',
  closingBalance: '400000000.00',
  entries: [
    {
      entryId: 'FEDWIRE-IN-9872134',
      bookingDate: '2026-10-28',
      amount: '50000000.00',
      creditDebitIndicator: 'CRDT',
      paymentRail: 'Fedwire',
      reference: 'Institutional Liquidity Influx'
    }
  ]
};

const messageToSign = signedMessage('NUMINA-BANK-STATEMENT-V1', {
  schema: 'numina.bank-statement-source.v1',
  ...statementPayload
});

const signature = crypto.sign(null, Buffer.from(messageToSign), privateKey).toString('base64');

const signedEnvelope = {
  ...statementPayload,
  sourceAttestation: {
    provider: 'bofa-cashpro',
    publicKey: bankPubKeyPem,
    signature
  }
};

console.log('--------------------------------------------------------------------------------');
console.log('[*] Ingesting & Reconciling Signed camt.053 Statement...');
const result = reconciler.ingestCamt053Statement(signedEnvelope);

console.log('    ✓ Reconciled Status:    ', result.status);
console.log('    ✓ Statement Hash:       ', result.statementHash);
console.log('    ✓ Opening Balance Units:', result.openingUnits.toString(), 'n');
console.log('    ✓ Closing Balance Units:', result.closingUnits.toString(), 'n');
console.log('    ✓ Net Movement Units:   ', result.netMovementUnits.toString(), 'n (+$50,000,000.00)');
console.log('    ✓ Verified Entries:     ', result.entriesCount);

console.log('--------------------------------------------------------------------------------');
console.log('[*] Testing Anti-Replay Idempotency Protection...');
try {
  reconciler.ingestCamt053Statement(signedEnvelope);
  console.log('    ✗ FAILED: Duplicate statement was not blocked');
} catch (err) {
  console.log('    ✓ PASS (Replay Blocked):', err.message);
}

console.log('================================================================================');
console.log('RECONCILIATION AUDIT COMPLETE: Pure BigInt arithmetic & Ed25519 attestation verified.');
console.log('================================================================================');
