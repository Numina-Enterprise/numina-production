import crypto from 'node:crypto';
import { parseMonetaryToUnits } from './money.mjs';
import { canonicalizeJson, publicKeyFingerprint, signedMessage, verifyEd25519Signature } from './security-utils.mjs';

/**
 * ISO 20022 & BAI2 Banking Reconciliation Engine
 * Ingests Bank of America CashPro statements (camt.053 / camt.052 / BAI2)
 * Reconciles into BigInt integer units.
 */
export class BankingReconciliationEngine {
  constructor(treasuryEngine, scheduleJManager, { trustedSourceKeys = {} } = {}) {
    if (!treasuryEngine?.clusterRoot || !scheduleJManager?.clusterState) throw new Error('CLUSTER_STATE_CONTEXT_REQUIRED');
    this.treasury = treasuryEngine;
    this.scheduleJ = scheduleJManager;
    this.trustedSourceKeys = { ...trustedSourceKeys };
    this.processedStatements = new Set();
    this.reconciledEntries = [];
  }

  /** Ingest a normalized, signed statement envelope; XML parsing is intentionally out of scope. */
  ingestCamt053Statement(statement) {
    const { sourceAttestation, statementId, accountId, openingBalance, closingBalance, entries } = statement;

    if (!statementId || this.processedStatements.has(statementId)) {
      throw new Error(`DUPLICATE_OR_INVALID_STATEMENT: ${statementId}`);
    }
    if (!sourceAttestation?.provider || !sourceAttestation.publicKey || !sourceAttestation.signature) throw new Error('BANK_SOURCE_ATTESTATION_REQUIRED');
    const trustedKey = this.trustedSourceKeys[sourceAttestation.provider];
    if (!trustedKey || publicKeyFingerprint(sourceAttestation.publicKey) !== publicKeyFingerprint(trustedKey)) throw new Error('BANK_SOURCE_KEY_NOT_TRUSTED');
    const sourcePayload = { schema: 'numina.bank-statement-source.v1', statementId, accountId, openingBalance, closingBalance, entries };
    verifyEd25519Signature({
      publicKey: sourceAttestation.publicKey,
      signatureBase64: sourceAttestation.signature,
      message: signedMessage('NUMINA-BANK-STATEMENT-V1', sourcePayload),
      expectedFingerprint: publicKeyFingerprint(trustedKey),
      label: 'BANK_SOURCE',
    });
    if (!Array.isArray(entries)) throw new Error('STATEMENT_ENTRIES_REQUIRED');

    const openingUnits = parseMonetaryToUnits(openingBalance);
    const closingUnits = parseMonetaryToUnits(closingBalance);

    let calculatedClosing = openingUnits;
    const verifiedEntries = [];

    for (const entry of entries) {
      if (!entry || typeof entry.entryId !== 'string' || !entry.entryId || typeof entry.bookingDate !== 'string' || !entry.bookingDate) throw new Error('INVALID_ENTRY_IDENTITY');
      const entryUnits = parseMonetaryToUnits(entry.amount);
      if (entry.creditDebitIndicator === 'CRDT') {
        calculatedClosing += entryUnits;
      } else if (entry.creditDebitIndicator === 'DBIT') {
        calculatedClosing -= entryUnits;
      } else {
        throw new Error(`INVALID_INDICATOR: ${entry.creditDebitIndicator}`);
      }

      verifiedEntries.push({
        entryId: entry.entryId,
        bookingDate: entry.bookingDate,
        amountUnits: entryUnits,
        creditDebitIndicator: entry.creditDebitIndicator,
        rail: entry.paymentRail || 'ACH', // RTP, FedNow, Fedwire, NACHA
        reference: entry.reference,
      });
    }

    if (calculatedClosing !== closingUnits) {
      throw new Error(
        `RECONCILIATION_BALANCE_MISMATCH: Calculated ${calculatedClosing} != Reported ${closingUnits}`
      );
    }

    const entriesForHash = verifiedEntries.map((entry) => ({ ...entry, amountUnits: entry.amountUnits.toString() })).sort((a, b) => a.entryId.localeCompare(b.entryId));
    const statementHash = crypto.createHash('sha256').update(canonicalizeJson({
      schema: 'numina.camt053.statement.v1',
      clusterStateRoot: this.treasury.clusterRoot,
      statementId,
      accountId,
      openingUnits: openingUnits.toString(),
      closingUnits: closingUnits.toString(),
      entries: entriesForHash,
    })).digest('hex');

    const result = {
      statementId,
      accountId,
      statementHash,
      openingUnits,
      closingUnits,
      netMovementUnits: closingUnits - openingUnits,
      entriesCount: verifiedEntries.length,
      entries: verifiedEntries,
      sourceProvider: sourceAttestation.provider,
      reconciledAt: this.treasury.now(),
      status: 'RECONCILED_AND_VERIFIED',
    };

    this.processedStatements.add(statementId);
    this.reconciledEntries.push(result);
    return result;
  }
}
