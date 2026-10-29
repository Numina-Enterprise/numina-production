import crypto from 'node:crypto';
import { NuminaTreasuryEngine, buildProviderAttestationPayload, buildSettlementAttestationPayload, SettlementStage } from './treasury-engine.mjs';
import { publicKeyFingerprint, signedMessage } from './security-utils.mjs';

console.log('================================================================================');
console.log('ADVANCING NUMINA TREASURY ENGINE: FULL 3-STAGE ATOMIC CYCLE EXECUTION');
console.log('================================================================================');

// 1. Generate Sovereign Cryptographic Signers
const authority = crypto.generateKeyPairSync('ed25519');
const guardian = crypto.generateKeyPairSync('ed25519');
const bankProvider = crypto.generateKeyPairSync('ed25519');

const authorityPem = authority.publicKey.export({ type: 'spki', format: 'pem' });
const guardianPem = guardian.publicKey.export({ type: 'spki', format: 'pem' });
const bankProviderPem = bankProvider.publicKey.export({ type: 'spki', format: 'pem' });

const authorityKeypin = publicKeyFingerprint(authorityPem);
const guardianKeypin = publicKeyFingerprint(guardianPem);
const CLUSTER_ROOT = '726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd';

const clusterState = {
  root: CLUSTER_ROOT,
  payload: {
    authorizedSupplyUnits: '1500000000000000000000', // $1.5 Quadrillion cap
    signers: {
      authorityKeypin,
      guardianKeypin
    }
  }
};

const treasury = new NuminaTreasuryEngine({
  clusterState,
  trustedProviderKeys: {
    'bofa-cashpro': bankProviderPem
  },
  now: () => Date.now()
});

console.log('[*] Treasury Engine Initialized:');
console.log(`    Cluster Root:      ${treasury.clusterRoot}`);
console.log(`    Vault Reserve:     $${(treasury.vaultReserve / 1_000_000n).toLocaleString()} NUSD`);
console.log(`    Circulating:       $${(treasury.circulatingSupply / 1_000_000n).toLocaleString()} NUSD`);
console.log('--------------------------------------------------------------------------------');

// Seed operational accounts
const initialAllocation = 100_000_000_000_000n; // $100M in micro-units
treasury.accounts.set('TREASURY_VAULT', treasury.vaultReserve);
treasury.accounts.set('OPERATING_RESERVE_A', initialAllocation);
treasury.accounts.set('INSTITUTIONAL_SETTLEMENT_B', 0n);

console.log('[*] Pre-Settlement Balances:');
console.log(`    OPERATING_RESERVE_A:         $${(treasury.getBalance('OPERATING_RESERVE_A') / 1_000_000n).toLocaleString()} USD`);
console.log(`    INSTITUTIONAL_SETTLEMENT_B:  $${(treasury.getBalance('INSTITUTIONAL_SETTLEMENT_B') / 1_000_000n).toLocaleString()} USD`);

// STAGE 1: INITIATE SETTLEMENT
console.log('--------------------------------------------------------------------------------');
console.log('[*] STAGE 1: INITIATING SETTLEMENT...');
const statementHash = crypto.createHash('sha256').update('BOFA_STMT_20261028_BATCH_001').digest('hex');
const settlementAmount = 25_000_000_000_000n; // $25,000,000.00 USD

const tx = treasury.initiateSettlement({
  idempotencyKey: 'nusd:settlement:advance:20261028:001',
  fromAccount: 'OPERATING_RESERVE_A',
  toAccount: 'INSTITUTIONAL_SETTLEMENT_B',
  amountUnits: settlementAmount,
  proofHash: statementHash
});

console.log(`    ✓ Stage 1 Complete:        Status = ${tx.stage}`);
console.log(`    ✓ Transaction Hash:        ${tx.txHash}`);
console.log(`    ✓ Nonce Assigned:          ${tx.nonce}`);

// STAGE 2: DUAL-KEY PROVENANCE ATTESTATION
console.log('--------------------------------------------------------------------------------');
console.log('[*] STAGE 2: ATTESTING DUAL-KEY PROVENANCE & BANK PROOF...');

const providerPayload = buildProviderAttestationPayload({
  clusterRoot: CLUSTER_ROOT,
  provider: 'bofa-cashpro',
  reference: 'FEDWIRE-TX-998811',
  amountUnits: settlementAmount,
  statementHash
});

const providerSignature = crypto.sign(
  null,
  Buffer.from(signedMessage('NUMINA-PROVIDER-ATTESTATION-V1', providerPayload)),
  bankProvider.privateKey
).toString('base64');

const settlementAttestationPayload = buildSettlementAttestationPayload(tx, providerPayload, CLUSTER_ROOT);
const settlementMsg = Buffer.from(signedMessage('NUMINA-SETTLEMENT-ATTESTATION-V1', settlementAttestationPayload));

const authoritySig = crypto.sign(null, settlementMsg, authority.privateKey).toString('base64');
const guardianSig = crypto.sign(null, settlementMsg, guardian.privateKey).toString('base64');

const attestedTx = treasury.attestSettlement({
  txHash: tx.txHash,
  authorityPublicKey: authorityPem,
  authoritySignature: authoritySig,
  guardianPublicKey: guardianPem,
  guardianSignature: guardianSig,
  providerAttestation: {
    provider: 'bofa-cashpro',
    publicKey: bankProviderPem,
    signature: providerSignature,
    reference: 'FEDWIRE-TX-998811',
    amountUnits: settlementAmount,
    statementHash
  }
});

console.log(`    ✓ Stage 2 Complete:        Status = ${attestedTx.stage}`);
console.log(`    ✓ Provider Attestation:    Validated (bofa-cashpro)`);
console.log(`    ✓ Authority Signature:     Verified (Keypin: ${authorityKeypin.slice(0, 16)}...)`);
console.log(`    ✓ Guardian Signature:      Verified (Keypin: ${guardianKeypin.slice(0, 16)}...)`);

// STAGE 3: ATOMIC COMMIT
console.log('--------------------------------------------------------------------------------');
console.log('[*] STAGE 3: COMMITTING ATOMIC BALANCE MUTATION...');

const committedTx = treasury.commitSettlement(tx.txHash);

console.log(`    ✓ Stage 3 Complete:        Status = ${committedTx.stage}`);
console.log(`    ✓ Cluster State Root:      ${committedTx.stateRoot}`);
console.log(`    ✓ Settled Timestamp:       ${committedTx.settledAt}`);

console.log('--------------------------------------------------------------------------------');
console.log('[*] Post-Settlement Balances:');
console.log(`    OPERATING_RESERVE_A:         $${(treasury.getBalance('OPERATING_RESERVE_A') / 1_000_000n).toLocaleString()} USD`);
console.log(`    INSTITUTIONAL_SETTLEMENT_B:  $${(treasury.getBalance('INSTITUTIONAL_SETTLEMENT_B') / 1_000_000n).toLocaleString()} USD`);

console.log('================================================================================');
console.log('TREASURY ENGINE ADVANCED: 3-STAGE ATOMIC SETTLEMENT COMMITTED TO CLUSTER STATE');
console.log('================================================================================');
