import crypto from 'node:crypto';
import { canonicalizeJson, sha256Hex, signedMessage, verifyEd25519Signature } from './security-utils.mjs';

/**
 * NCUA Schedule J Regulatory Ledger (91 FR 64699, OMB 3133-0004)
 * Covers Accounts J-01 to J-26.
 */
export class NCUAScheduleJManager {
  constructor({ clusterState, now = Date.now } = {}) {
    if (!clusterState?.root || !clusterState.payload?.signers) throw new Error('CLUSTER_STATE_CONTEXT_REQUIRED');
    if (typeof now !== 'function') throw new Error('CLOCK_REQUIRED');
    this.clusterState = clusterState;
    this.now = now;
    this.accounts = new Map();
    this.initializeAccounts();
  }

  initializeAccounts() {
    // Accounts J-01 to J-08: Reserve Custody
    for (let i = 1; i <= 8; i++) {
      const id = `J-${String(i).padStart(2, '0')}`;
      this.accounts.set(id, {
        id,
        category: 'RESERVE_CUSTODY',
        name: `Custodial Cash Reserve Account ${id}`,
        institution: 'Bank of America Commercial Banking',
        balanceUnits: 0n,
        digest: null,
        promoted: false,
      });
    }

    // Accounts J-09 to J-17: Key Custody
    for (let i = 9; i <= 17; i++) {
      const id = `J-${String(i).padStart(2, '0')}`;
      this.accounts.set(id, {
        id,
        category: 'KEY_CUSTODY',
        name: `HSM / Multi-Sig Custodial Key Store ${id}`,
        institution: 'FIPS 140-3 Hardware Security Module',
        balanceUnits: 0n,
        digest: null,
        promoted: false,
      });
    }

    // Accounts J-18 to J-22: Permitted-Issuer Exposure Limits
    for (let i = 18; i <= 22; i++) {
      const id = `J-${String(i).padStart(2, '0')}`;
      this.accounts.set(id, {
        id,
        category: 'PERMITTED_ISSUER_EXPOSURE',
        name: `Permitted-Issuer Reserve Limit ${id}`,
        institution: 'Qualified Institution',
        balanceUnits: 0n,
        digest: null,
        promoted: false,
      });
    }

    // Accounts J-23 to J-26: Balance-Sheet Stablecoins and Backing Assets
    for (let i = 23; i <= 26; i++) {
      const id = `J-${String(i).padStart(2, '0')}`;
      this.accounts.set(id, {
        id,
        category: 'BALANCE_SHEET_ASSETS',
        name: `Audited Reserve Backing Asset ${id}`,
        institution: 'NUSD Reserve Portfolio',
        balanceUnits: 0n,
        digest: null,
        promoted: false,
      });
    }
  }

  getAccount(id) {
    const acc = this.accounts.get(id);
    if (!acc) throw new Error(`INVALID_SCHEDULE_J_ACCOUNT: ${id}`);
    return acc;
  }

  /** Promote only exact source bytes with dual Ed25519 signatures from pinned keys. */
  promoteAccount({ id, balanceUnits, sourceBytes, sourceDigest, authorityPublicKey, authoritySignature, guardianPublicKey, guardianSignature }) {
    const acc = this.getAccount(id);
    if (typeof balanceUnits !== 'bigint' || balanceUnits < 0n) throw new Error('SCHEDULE_J_BALANCE_INVALID');
    if (!(typeof sourceBytes === 'string' || Buffer.isBuffer(sourceBytes) || sourceBytes instanceof Uint8Array)) throw new Error('SCHEDULE_J_SOURCE_BYTES_REQUIRED');
    const computedDigest = sha256Hex(sourceBytes);
    if (sourceDigest !== computedDigest) throw new Error('SCHEDULE_J_DIGEST_MISMATCH');
    if (!/^[a-f0-9]{64}$/.test(sourceDigest)) throw new Error('SCHEDULE_J_DIGEST_ERROR');
    const payload = { schema: 'numina.schedule-j-promotion.v1', clusterStateRoot: this.clusterState.root, id, balanceUnits: balanceUnits.toString(), sourceDigest };
    const message = signedMessage('NUMINA-SCHEDULE-J-PROMOTION-V1', payload);
    const authorityPin = this.clusterState.payload.signers.authorityKeypin;
    const guardianPin = this.clusterState.payload.signers.guardianKeypin;
    verifyEd25519Signature({ publicKey: authorityPublicKey, signatureBase64: authoritySignature, message, expectedFingerprint: authorityPin, label: 'AUTHORITY' });
    verifyEd25519Signature({ publicKey: guardianPublicKey, signatureBase64: guardianSignature, message, expectedFingerprint: guardianPin, label: 'GUARDIAN' });

    acc.balanceUnits = balanceUnits;
    acc.digest = sourceDigest;
    acc.authoritySignature = authoritySignature;
    acc.guardianSignature = guardianSignature;
    acc.promoted = true;
    acc.promotedAt = this.now();
    acc.stateRoot = this.clusterState.root;

    return acc;
  }

  generateReportPackage() {
    const reportAccounts = [];
    let totalCustodyUnits = 0n;

    for (const [id, acc] of this.accounts.entries()) {
      reportAccounts.push({
        id: acc.id,
        category: acc.category,
        name: acc.name,
        institution: acc.institution,
        balanceUnits: acc.balanceUnits.toString(),
        promoted: acc.promoted,
        digest: acc.digest,
      });
      if (acc.promoted) {
        totalCustodyUnits += acc.balanceUnits;
      }
    }

    const payload = {
      specification: 'NCUA Schedule J (91 FR 64699, OMB 3133-0004)',
      clusterRoot: this.clusterState.root,
      authority: 'skott34-ed25519',
      accountsCount: reportAccounts.length,
      totalPromotedBalanceUnits: totalCustodyUnits.toString(),
      accounts: reportAccounts,
    };

    const reportHash = crypto.createHash('sha256').update(canonicalizeJson(payload)).digest('hex');

    return {
      reportHash,
      totalPromotedBalanceUnits: totalCustodyUnits,
      payload,
    };
  }
}
