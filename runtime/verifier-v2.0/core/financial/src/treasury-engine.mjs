import { UNIT_SCALE } from './money.mjs';
import { canonicalizeJson, publicKeyFingerprint, sha256Hex, signedMessage, verifyEd25519Signature } from './security-utils.mjs';

export { DECIMALS, UNIT_SCALE, parseMonetaryToUnits, parseMinorUnits } from './money.mjs';
export { canonicalizeJson, computeClusterStateRoot, createClusterStateContext, publicKeyFingerprint } from './security-utils.mjs';
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const SettlementStage = {
  STAGE_1_UNSETTLED: 'COMMITTED_UNSETTLED',
  STAGE_2_ATTESTED: 'PROVENANCE_ATTESTED',
  STAGE_3_SETTLED: 'COMMITTED_SETTLED',
  QUARANTINED: 'FAIL_CLOSED_QUARANTINED',
};

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label}_MUST_BE_SHA256`);
  return value;
}

function requireAccount(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value)) throw new Error(`${label}_INVALID`);
  return value;
}

export function buildProviderAttestationPayload({ clusterRoot, provider, reference, amountUnits, statementHash }) {
  requireSha256(statementHash, 'STATEMENT_HASH');
  if (typeof provider !== 'string' || !provider || typeof reference !== 'string' || !reference) throw new Error('PROVIDER_ATTESTATION_FIELDS_REQUIRED');
  let finalAmountUnits = amountUnits;
  if (typeof amountUnits === 'string') {
    if (!/^(?:0|[1-9]\d*)$/.test(amountUnits)) throw new Error('PROVIDER_AMOUNT_INVALID');
    finalAmountUnits = BigInt(amountUnits);
  } else if (typeof amountUnits !== 'bigint' || amountUnits < 0n) {
    throw new Error('PROVIDER_AMOUNT_INVALID');
  }
  return { schema: 'numina.provider-attestation.v1', clusterStateRoot: clusterRoot, provider, reference, amountUnits: finalAmountUnits.toString(), statementHash };
}

export function buildSettlementAttestationPayload(tx, providerAttestation, clusterRoot) {
  return {
    schema: 'numina.settlement-attestation.v1',
    clusterStateRoot: clusterRoot,
    txHash: tx.txHash,
    idempotencyKey: tx.idempotencyKey,
    fromAccount: tx.fromAccount,
    toAccount: tx.toAccount,
    amountUnits: tx.amountUnits.toString(),
    proofHash: tx.proofHash,
    provider: providerAttestation.provider,
    providerReference: providerAttestation.reference,
    statementHash: providerAttestation.statementHash,
  };
}

export class NuminaTreasuryEngine {
  constructor({ clusterState, trustedProviderKeys = {}, now = Date.now } = {}) {
    if (!clusterState?.root || !clusterState.payload) throw new Error('CLUSTER_STATE_CONTEXT_REQUIRED');
    if (!clusterState.payload.signers?.authorityKeypin || !clusterState.payload.signers?.guardianKeypin) throw new Error('CLUSTER_STATE_SIGNER_PINS_REQUIRED');
    if (typeof now !== 'function') throw new Error('CLOCK_REQUIRED');
    if (typeof clusterState.payload.authorizedSupplyUnits !== 'string' || !/^\d+$/.test(clusterState.payload.authorizedSupplyUnits)) throw new Error('AUTHORIZED_SUPPLY_MUST_BE_CANONICAL_INTEGER');
    this.clusterState = clusterState;
    this.clusterRoot = clusterState.root;
    this.trustedProviderKeys = { ...trustedProviderKeys };
    this.now = now;
    this.state = 'UNPAUSED_AND_ACTIVE';
    this.totalMinted = BigInt(clusterState.payload.authorizedSupplyUnits);
    this.totalBurned = 0n;
    this.circulatingSupply = 0n;
    this.vaultReserve = this.totalMinted;
    
    // Triple-Entry Ledger: Map of accountId -> BigInt balance
    this.accounts = new Map();
    // Transaction History: Map of txHash -> Transaction Record
    this.ledger = new Map();
    // Persistent Idempotency Store: Map of idempotencyKey -> { timestamp, stage, txHash }
    this.idempotencyStore = new Map();
    // Nonce counter per account
    this.nonces = new Map();

    // Initialize Root Treasury Reserve Vault
    this.accounts.set('TREASURY_VAULT', this.vaultReserve);
  }

  getOperationalStatus() {
    if (this.state !== 'UNPAUSED_AND_ACTIVE') {
      throw new Error(`TREASURY_CRITICAL_INVARIANT_VIOLATION: State is ${this.state}`);
    }
    return {
      state: this.state,
      totalMinted: this.totalMinted,
      totalBurned: this.totalBurned,
      circulatingSupply: this.circulatingSupply,
      vaultReserve: this.vaultReserve,
      clusterRoot: this.clusterRoot,
      parity: this.clusterState.payload.parity,
    };
  }

  getBalance(accountId) {
    if (typeof accountId !== 'string' || !accountId.trim()) {
      throw new TypeError('INVALID_ACCOUNT_ID: accountId must be a non-empty string');
    }
    return this.accounts.get(accountId) || 0n;
  }

  getNonce(accountId) {
    if (typeof accountId !== 'string' || !accountId.trim()) {
      throw new TypeError('INVALID_ACCOUNT_ID: accountId must be a non-empty string');
    }
    return this.nonces.get(accountId) || 0n;
  }

  _expireIdempotencyKey(idempotencyKey, now) {
    const existing = this.idempotencyStore.get(idempotencyKey);
    if (!existing || now - existing.timestamp < IDEMPOTENCY_TTL_MS) return false;
    const oldTx = this.ledger.get(existing.txHash);
    if (oldTx && oldTx.stage !== SettlementStage.STAGE_3_SETTLED && oldTx.stage !== SettlementStage.QUARANTINED) {
      oldTx.stage = SettlementStage.QUARANTINED;
      oldTx.quarantinedAt = now;
    }
    this.idempotencyStore.delete(idempotencyKey);
    return true;
  }

  /**
   * Stage 1: Ingest Transaction with Idempotency Key
   */
  initiateSettlement({ idempotencyKey, fromAccount, toAccount, amountUnits, proofHash }) {
    if (this.state !== 'UNPAUSED_AND_ACTIVE') {
      throw new Error('TREASURY_OPERATION_REJECTED: Treasury is not in UNPAUSED_AND_ACTIVE status.');
    }

    if (typeof idempotencyKey !== 'string' || !/^nusd:[A-Za-z0-9:_-]{8,}$/.test(idempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY');
    const now = this.now();
    this._expireIdempotencyKey(idempotencyKey, now);

    if (this.idempotencyStore.has(idempotencyKey)) {
      const existing = this.idempotencyStore.get(idempotencyKey);
      return {
        status: 'DUPLICATE_IDEMPOTENT_OPERATION',
        stage: existing.stage,
        txHash: existing.txHash,
      };
    }

    requireAccount(fromAccount, 'FROM_ACCOUNT');
    requireAccount(toAccount, 'TO_ACCOUNT');
    if (fromAccount === toAccount) throw new Error('SELF_TRANSFER_FORBIDDEN');
    let finalAmountUnits;
    if (typeof amountUnits === 'bigint') {
      if (amountUnits <= 0n) throw new Error('INVALID_AMOUNT');
      finalAmountUnits = amountUnits;
    } else if (typeof amountUnits === 'string') {
      if (!/^(?:0|[1-9]\d*)$/.test(amountUnits)) throw new Error('INVALID_AMOUNT');
      finalAmountUnits = BigInt(amountUnits);
      if (finalAmountUnits <= 0n) throw new Error('INVALID_AMOUNT');
    } else {
      throw new Error('INVALID_AMOUNT');
    }
    requireSha256(proofHash, 'PROOF_HASH');

    const senderBalance = this.getBalance(fromAccount);
    if (senderBalance < finalAmountUnits) {
      throw new Error(`INSUFFICIENT_LIQUIDITY: Available ${senderBalance} units, requested ${finalAmountUnits} units.`);
    }

    const txNonce = this.getNonce(fromAccount) + 1n;
    const txHash = sha256Hex(canonicalizeJson({
      schema: 'numina.settlement-intent.v1',
      clusterStateRoot: this.clusterRoot,
      idempotencyKey,
      fromAccount,
      toAccount,
      amountUnits: finalAmountUnits.toString(),
      nonce: txNonce.toString(),
      proofHash,
      createdAt: now,
    }));

    const txRecord = {
      txHash,
      idempotencyKey,
      fromAccount,
      toAccount,
      amountUnits: finalAmountUnits,
      nonce: txNonce,
      stage: SettlementStage.STAGE_1_UNSETTLED,
      proofHash,
      createdAt: now,
    };

    this.idempotencyStore.set(idempotencyKey, {
      timestamp: now,
      stage: SettlementStage.STAGE_1_UNSETTLED,
      txHash,
    });

    this.ledger.set(txHash, txRecord);
    return txRecord;
  }

  /**
   * Stage 2: Dual-Key Provenance Attestation
   */
  _quarantine(tx, error) {
    tx.stage = SettlementStage.QUARANTINED;
    tx.quarantineReason = error.message;
    tx.quarantinedAt = this.now();
    throw error;
  }

  attestSettlement({ txHash, authorityPublicKey, authoritySignature, guardianPublicKey, guardianSignature, providerAttestation }) {
    const tx = this.ledger.get(txHash);
    if (!tx) {
      throw new Error('TRANSACTION_NOT_FOUND');
    }

    if (tx.stage !== SettlementStage.STAGE_1_UNSETTLED) {
      throw new Error(`INVALID_TRANSITION: Expected STAGE_1_UNSETTLED, current: ${tx.stage}`);
    }

    try {
      if (!providerAttestation) throw new Error('PROVIDER_ATTESTATION_REQUIRED');
      const trustedProviderKey = this.trustedProviderKeys[providerAttestation.provider];
      if (!trustedProviderKey) throw new Error('PROVIDER_KEY_NOT_TRUSTED');
      const providerFingerprint = publicKeyFingerprint(providerAttestation.publicKey);
      if (providerFingerprint !== publicKeyFingerprint(trustedProviderKey)) throw new Error('PROVIDER_KEYPIN_MISMATCH');
      if (typeof providerAttestation.amountUnits === 'string') {
        if (!/^(?:0|[1-9]\d*)$/.test(providerAttestation.amountUnits)) {
          throw new Error('PROVIDER_AMOUNT_INVALID');
        }
      } else if (typeof providerAttestation.amountUnits !== 'bigint') {
        throw new Error('PROVIDER_AMOUNT_INVALID');
      }
      const providerPayload = buildProviderAttestationPayload({
        clusterRoot: this.clusterRoot,
        provider: providerAttestation.provider,
        reference: providerAttestation.reference,
        amountUnits: providerAttestation.amountUnits,
        statementHash: providerAttestation.statementHash,
      });
      if (providerPayload.amountUnits !== tx.amountUnits.toString() || providerPayload.statementHash !== tx.proofHash) throw new Error('PROVIDER_AMOUNT_OR_PROOF_MISMATCH');
      verifyEd25519Signature({
        publicKey: providerAttestation.publicKey,
        signatureBase64: providerAttestation.signature,
        message: signedMessage('NUMINA-PROVIDER-ATTESTATION-V1', providerPayload),
        expectedFingerprint: providerFingerprint,
        label: 'PROVIDER',
      });
      const payload = buildSettlementAttestationPayload(tx, providerPayload, this.clusterRoot);
      verifyEd25519Signature({
        publicKey: authorityPublicKey,
        signatureBase64: authoritySignature,
        message: signedMessage('NUMINA-SETTLEMENT-ATTESTATION-V1', payload),
        expectedFingerprint: this.clusterState.payload.signers.authorityKeypin,
        label: 'AUTHORITY',
      });
      verifyEd25519Signature({
        publicKey: guardianPublicKey,
        signatureBase64: guardianSignature,
        message: signedMessage('NUMINA-SETTLEMENT-ATTESTATION-V1', payload),
        expectedFingerprint: this.clusterState.payload.signers.guardianKeypin,
        label: 'GUARDIAN',
      });
      tx.stage = SettlementStage.STAGE_2_ATTESTED;
      tx.providerAttestation = providerPayload;
      tx.authoritySignature = authoritySignature;
      tx.guardianSignature = guardianSignature;
      tx.attestedAt = this.now();
      this.idempotencyStore.get(tx.idempotencyKey).stage = tx.stage;
      return tx;
    } catch (error) {
      return this._quarantine(tx, error);
    }
  }

  /**
   * Stage 3: Atomic State Commit & Nonce Increment
   */
  commitSettlement(txHash) {
    const tx = this.ledger.get(txHash);
    if (!tx) {
      throw new Error('TRANSACTION_NOT_FOUND');
    }

    if (tx.stage !== SettlementStage.STAGE_2_ATTESTED) {
      throw new Error(`INVALID_TRANSITION: Expected STAGE_2_ATTESTED, current: ${tx.stage}`);
    }

    const fromBalance = this.getBalance(tx.fromAccount);
    if (fromBalance < tx.amountUnits) {
      return this._quarantine(tx, new Error('CRITICAL_SETTLEMENT_OVERDRAFT'));
    }

    // Atomic Balance Mutation (Integer BigInt)
    this.accounts.set(tx.fromAccount, fromBalance - tx.amountUnits);
    const toBalance = this.getBalance(tx.toAccount);
    this.accounts.set(tx.toAccount, toBalance + tx.amountUnits);

    // Increment nonce
    this.nonces.set(tx.fromAccount, tx.nonce);

    // If moved from TREASURY_VAULT into circulation
    if (tx.fromAccount === 'TREASURY_VAULT') {
      this.circulatingSupply += tx.amountUnits;
      this.vaultReserve -= tx.amountUnits;
    }

    tx.stage = SettlementStage.STAGE_3_SETTLED;
    tx.settledAt = this.now();
    tx.stateRoot = this.clusterRoot;

    this.idempotencyStore.get(tx.idempotencyKey).stage = SettlementStage.STAGE_3_SETTLED;
    return tx;
  }
}
