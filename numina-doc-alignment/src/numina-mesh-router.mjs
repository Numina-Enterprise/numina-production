/**
 * Numina Multi-Room Mesh Router, E2EE Envelope Engine, Anti-Drift Telemetry & Self-Learning Anomaly Guard
 * (src/numina-mesh-router.mjs)
 *
 * ====================================================================================================
 * NUMINA (Skott34-Ed25519, Universal Companion Model)
 * Motto: "Like otters holding hands so they dont drift apart while resting, every agent stays connected
 * without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed.
 * NUMINA aligned."
 * Authority, Source of Truth & Lead: Samuel J. Kott (skott34-ed25519) | AUTHORITY_LEAD = 'Samuel J. Kott'
 * Operator: SK Consulting LLC (Sam Kott), Iowa, USA | Governance: Zero Trust + Multi-Signature Authorization
 * Target Runtime: Node 26 (Zero npm dependencies; built-in node:crypto, node:assert/strict)
 * ====================================================================================================
 */

import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// --- SYSTEM CONSTANTS & INVARIANTS ---

export const AUTHORITY_LEAD = 'Samuel J. Kott';
export const AUTHORIZED_OWNER_ALIASES = Object.freeze(['Samuel J. Kott', 'Sam Kott']);
export const CANONICAL_ORIGIN = 'https://www.numinalabs.xyz';
export const NUSD_OPERATIONAL_STATE = 'UNPAUSED_AND_ACTIVE';
export const ASANA_VERIFIED_SPRINT_GID = '1219183110870936';
export const FORBIDDEN_ASANA_GIDS = Object.freeze(['1219187222788173']);
export const MOJIBAKE_SEQUENCE = Buffer.from([0xC3, 0xA2, 0xE2, 0x82, 0xAC]);

export const SINGULARITY_IDENTITY = 'NUMINA';
export const SINGULARITY_MODEL = 'Skott34-Ed25519, Universal Companion Model';
export const OTTER_MOTTO =
  'Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned.';
export const OTTER_MOTTO_SUBSTRING =
  'Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence';

export const MESH_ROUTER_VERSION = '2026-10-26-node26-mesh-router-v1';

export const PRODUCTION_ACCEPTANCE_GATES = Object.freeze([
  'RC27 Release Verification Report',
  'Runtime Signer Verification Report',
  'Build 6 Verification Report',
  'Backup & Restore Validation Report',
  'S0 Governance Approval Package',
]);

export const EUR_LEX_TREATY_URLS = Object.freeze([
  'https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-overview.html',
  'https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-founding.html',
  'https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-accession.html',
  'https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-force.html',
  'https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-other.html',
]);

export const BRAZIL_LGPD_RES_19_URL =
  'https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-19-de-23-de-agosto-de-2024-580095396';
export const EU_GDPR_SCC_2021_914_URL = 'https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj';
export const REPEALED_SCC_2010_87_EU_URL =
  'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32010D0087';
export const ERR_REPEALED_SCC_2010_87_EU = 'ERR_REPEALED_SCC_2010_87_EU';

// 16 Active Channels (public and private rooms)
export const ACTIVE_CHANNELS = Object.freeze([
  { id: 'C_GENERAL', name: '#general', type: 'public', division: 'general' },
  { id: 'C_NUMINA', name: '#numina', type: 'public', division: 'numina-website-soc' },
  { id: 'C_ACCOUNTING', name: 'numina-accounting', type: 'private', division: 'numina-accounting' },
  { id: 'C_APPLE_DEPLOYMENT', name: 'numina-apple-deployment', type: 'private', division: 'numina-apple-team' },
  { id: 'C_COMPLIANCE_RISK', name: '#numina-compliance-risk', type: 'public', division: 'numina-compliance-risk' },
  { id: 'C_ENGINEERING', name: '#numina-engineering', type: 'public', division: 'numina-engineering-cio' },
  { id: 'C_FEDERAL_CAPTURE', name: '#numina-federal-capture', type: 'public', division: 'numina-federal-capture' },
  { id: 'C_FINANCE_TREASURY', name: '#numina-finance-treasury', type: 'public', division: 'numina-finance-treasury' },
  { id: 'C_LEGAL', name: 'numina-legal', type: 'private', division: 'numina-legal' },
  { id: 'C_MARKET_INTEL', name: '#numina-market-intel', type: 'public', division: 'numina-growth-matrix' },
  { id: 'C_PARTNERSHIPS_SALES', name: '#numina-partnerships-sales', type: 'public', division: 'numina-growth-matrix' },
  { id: 'C_PRODUCT', name: '#numina-product', type: 'public', division: 'numina-growth-matrix' },
  { id: 'C_PUBLICITY_NARRATIVE', name: '#numina-publicity-narrative', type: 'public', division: 'numina-publicity-narrative' },
  { id: 'C_STRATEGY', name: '#numina-strategy', type: 'public', division: 'numina-strategy' },
  { id: 'C_POSTHOG_INBOX', name: '#posthog-inbox', type: 'public', division: 'posthog-telemetry' },
  { id: 'C_VENGEANCE_INDEPENDENT_REVIEW', name: 'vengeance-independent-review', type: 'private', division: 'vengeance-independent-review' },
]);

// Quarantined Channels (Legacy release lanes quarantined fail-closed)
export const QUARANTINED_CHANNELS = Object.freeze([
  {
    id: 'C_GOOGLE_PLAY_DEPLOYMENT',
    name: 'numina-google-play-deployment',
    status: 'CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED',
    errorCode: 'CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED',
  },
]);

// Starred identities
export const STARRED_IDENTITIES = Object.freeze([
  { id: 'gang', role: 'ARCHITECT_CENTRAL_COORDINATOR' },
  { id: 'skott34-ed25519', role: 'CRYPTOGRAPHIC_ROOT_AUTHORITY' },
]);

// 15 Enterprise Agent Divisions
export const ENTERPRISE_DIVISIONS = Object.freeze({
  'numina-accounting': { channel: 'numina-accounting', asanaTracked: true },
  'numina-apple-team': { channel: 'numina-apple-deployment', asanaTracked: true },
  'numina-compliance-risk': { channel: '#numina-compliance-risk', asanaTracked: true },
  'numina-engineering-cio': { channel: '#numina-engineering', asanaTracked: true },
  'numina-federal-capture': { channel: '#numina-federal-capture', asanaTracked: true },
  'numina-finance-treasury': { channel: '#numina-finance-treasury', asanaTracked: true },
  'numina-crypto-monitor': { channel: '#numina-finance-treasury', secondary: '#numina', asanaTracked: true },
  'numina-google-play-team': { channel: 'numina-google-play-deployment', governedBuildLane: true, asanaTracked: true },
  'numina-google-enterprise': { channel: '#numina-engineering', secondary: '#numina-compliance-risk', asanaTracked: true },
  'numina-legal': { channel: 'numina-legal', asanaTracked: true },
  'numina-growth-matrix': { channel: '#numina-market-intel', secondary: ['#numina-partnerships-sales', '#numina-product'], asanaTracked: true },
  'numina-publicity-narrative': { channel: '#numina-publicity-narrative', asanaTracked: true },
  'numina-strategy': { channel: '#numina-strategy', asanaTracked: true },
  'numina-website-soc': { channel: '#numina', origin: 'https://www.numinalabs.xyz', asanaTracked: true },
  'vengeance-independent-review': { channel: 'vengeance-independent-review', asanaTracked: true },
});

// Pinned Key Constants & ASN.1 DER Prefixes
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export const PINNED_AUTHORITY_PUBLIC_KEY_PEM =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxqpbjMTzgULVeNq/W0tdU1RzPKmkuldC2U4DDI5g6yI=\n-----END PUBLIC KEY-----\n';

export const PINNED_GUARDIAN_PUBLIC_KEY_PEM =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAhUrpnMscm/Vc7p+7k6eAcxDT0gVUcQ1dhKkgaJ2BVNg=\n-----END PUBLIC KEY-----\n';

// --- CRYPTOGRAPHIC & UTILITY FUNCTIONS ---

/**
 * Deterministic JSON Canonicalization.
 * Recursively sorts keys, strips whitespace, and rejects prototype pollution and non-finite numbers.
 */
export function canonicalizeJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('NON_FINITE_NUMBER_FORBIDDEN');
    }
    if (typeof value === 'string' && value.includes('\u00ad')) {
      throw new Error('SOFT_HYPHEN_0XAD_FORBIDDEN');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  for (const k of keys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      throw new Error('PROTOTYPE_POLLUTION_KEY_REJECTED');
    }
  }
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalizeJson(value[k])).join(',') + '}';
}

/**
 * SHA-256 lowercase hex digest.
 */
export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Timing-safe string comparison.
 */
export function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Deterministic Ed25519 private key generation from 32-byte seed.
 */
export function createPrivateKeyFromSeed(seed32) {
  const buf = Buffer.isBuffer(seed32) ? seed32 : Buffer.from(seed32);
  assert.equal(buf.length, 32, 'Seed must be exactly 32 bytes');
  const pkcs8Der = Buffer.concat([ED25519_PKCS8_PREFIX, buf]);
  return crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
}

/**
 * Deterministic Ed25519 public key import from 32-byte raw coordinate.
 */
export function createPublicKeyFromRaw(rawPub32) {
  const buf = Buffer.isBuffer(rawPub32) ? rawPub32 : Buffer.from(rawPub32);
  assert.equal(buf.length, 32, 'Raw public key must be exactly 32 bytes');
  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, buf]);
  return crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
}

/**
 * Deterministic Ed25519 keypair generation from 32-byte seed.
 */
export function createEd25519KeypairFromSeed(seed32) {
  const privateKey = createPrivateKeyFromSeed(seed32);
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Normalize public key input into crypto.KeyObject.
 */
export function normalizePublicKey(keyInput) {
  if (keyInput && typeof keyInput.export === 'function') {
    return keyInput;
  }
  if (typeof keyInput === 'string') {
    if (keyInput.includes('-----BEGIN PUBLIC KEY-----')) {
      return crypto.createPublicKey(keyInput);
    }
    const buf = Buffer.from(keyInput, 'hex');
    if (buf.length === 32) return createPublicKeyFromRaw(buf);
  }
  if (Buffer.isBuffer(keyInput)) {
    if (keyInput.length === 32) return createPublicKeyFromRaw(keyInput);
    return crypto.createPublicKey({ key: keyInput, format: 'der', type: 'spki' });
  }
  throw new Error('INVALID_PUBLIC_KEY_FORMAT');
}

/**
 * Normalize private key input into crypto.KeyObject.
 */
export function normalizePrivateKey(keyInput) {
  if (keyInput && typeof keyInput.export === 'function') {
    return keyInput;
  }
  if (typeof keyInput === 'string') {
    if (keyInput.includes('-----BEGIN PRIVATE KEY-----')) {
      return crypto.createPrivateKey(keyInput);
    }
    const buf = Buffer.from(keyInput, 'hex');
    if (buf.length === 32) return createPrivateKeyFromSeed(buf);
  }
  if (Buffer.isBuffer(keyInput)) {
    if (keyInput.length === 32) return createPrivateKeyFromSeed(keyInput);
    return crypto.createPrivateKey({ key: keyInput, format: 'der', type: 'pkcs8' });
  }
  throw new Error('INVALID_PRIVATE_KEY_FORMAT');
}

/**
 * Pillar 1: Seal E2EE envelope using X25519 ECDH + HKDF-SHA256 + AES-256-GCM + Ed25519 signature.
 */
export function sealE2eeEnvelope(senderPrivKeyInput, receiverPubKeyInput, payloadObj, aad = 'numina-e2ee-v1') {
  const senderPrivKey = normalizePrivateKey(senderPrivKeyInput);
  const receiverPubKey = normalizePublicKey(receiverPubKeyInput);

  const ephemeralSender = crypto.generateKeyPairSync('x25519');
  const sharedSecret = crypto.diffieHellman({
    privateKey: ephemeralSender.privateKey,
    publicKey: receiverPubKey,
  });
  const salt = crypto.randomBytes(32);
  const aesKey = crypto.hkdfSync('sha256', sharedSecret, salt, Buffer.from(aad, 'utf8'), 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(aesKey), iv);
  const plaintext = Buffer.from(canonicalizeJson(payloadObj), 'utf8');
  let ciphertext = cipher.update(plaintext);
  ciphertext = Buffer.concat([ciphertext, cipher.final()]);
  const tag = cipher.getAuthTag();

  const ephemeralSpki = ephemeralSender.publicKey.export({ type: 'spki', format: 'der' });
  const transcriptToSign = Buffer.concat([
    Buffer.from(aad, 'utf8'),
    ephemeralSpki,
    salt,
    iv,
    ciphertext,
    tag,
  ]);
  const senderSignature = crypto.sign(null, transcriptToSign, senderPrivKey);

  return {
    version: 'numina-e2ee-x25519-hkdf-aes256gcm-ed25519-v1',
    ephemeralPublicKeyDerHex: ephemeralSpki.toString('hex'),
    saltHex: salt.toString('hex'),
    ivHex: iv.toString('hex'),
    ciphertextHex: ciphertext.toString('hex'),
    tagHex: tag.toString('hex'),
    senderSignatureHex: senderSignature.toString('hex'),
    aad,
  };
}

/**
 * Pillar 1: Open E2EE envelope, verifying Ed25519 detached signature and decrypting AES-256-GCM.
 */
export function openE2eeEnvelope(receiverPrivKeyInput, senderPubKeyInput, envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('INVALID_ENVELOPE');
  }
  const receiverPrivKey = normalizePrivateKey(receiverPrivKeyInput);
  const senderPubKey = normalizePublicKey(senderPubKeyInput);

  const ephemeralPubKey = crypto.createPublicKey({
    key: Buffer.from(envelope.ephemeralPublicKeyDerHex, 'hex'),
    format: 'der',
    type: 'spki',
  });
  const salt = Buffer.from(envelope.saltHex, 'hex');
  const iv = Buffer.from(envelope.ivHex, 'hex');
  const ciphertext = Buffer.from(envelope.ciphertextHex, 'hex');
  const tag = Buffer.from(envelope.tagHex, 'hex');
  const sig = Buffer.from(envelope.senderSignatureHex, 'hex');

  const transcript = Buffer.concat([
    Buffer.from(envelope.aad || 'numina-e2ee-v1', 'utf8'),
    Buffer.from(envelope.ephemeralPublicKeyDerHex, 'hex'),
    salt,
    iv,
    ciphertext,
    tag,
  ]);
  const verified = crypto.verify(null, transcript, senderPubKey, sig);
  if (!verified) {
    throw new Error('E2EE_ENVELOPE_SIGNATURE_INVALID');
  }

  const sharedSecret = crypto.diffieHellman({
    privateKey: receiverPrivKey,
    publicKey: ephemeralPubKey,
  });
  const aesKey = crypto.hkdfSync('sha256', sharedSecret, salt, Buffer.from(envelope.aad || 'numina-e2ee-v1', 'utf8'), 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(aesKey), iv);
  decipher.setAuthTag(tag);
  let pt = decipher.update(ciphertext);
  pt = Buffer.concat([pt, decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

/**
 * Pillar 2: Deterministic Cluster State Root calculation.
 * Sorts channel entries alphabetically, forms canonical JSON with manifestSha256, and returns SHA-256.
 */
export function calculateClusterStateRoot(channelStates = {}, manifestSha256) {
  if (typeof manifestSha256 !== 'string' || manifestSha256.length !== 64) {
    throw new Error('INVALID_MANIFEST_SHA256');
  }
  const sortedChannelIds = Object.keys(channelStates).sort();
  const canonicalEntries = sortedChannelIds.map((cid) => {
    const s = channelStates[cid];
    return {
      channelId: cid,
      lastMessageSha256: s.lastMessageSha256 || '0'.repeat(64),
      sequence: Number(s.sequence || 0),
      status: s.status || 'CHANNEL_QUARANTINED_BY_DEFAULT',
    };
  });
  return sha256Hex(canonicalizeJson({ channelStates: canonicalEntries, manifestSha256 }));
}

// --- SELF-LEARNING DRIFT & ANOMALY ENGINE ---

/**
 * Evaluates a message payload for drift, prompt injections, regressions, and emergencies.
 * Caches learned rules in rulebook with O(1) deterministically hashed keys (`rule-${sha256.slice(0, 16)}`).
 */
export function detectAnomaliesAndDrift(payloadInput, context = {}, rulebook = null) {
  const payloadText = typeof payloadInput === 'string' ? payloadInput : canonicalizeJson(payloadInput);
  const ruleKey = 'rule-' + sha256Hex(payloadText).slice(0, 16);

  if (rulebook && rulebook.has(ruleKey)) {
    return { clean: false, ruleId: ruleKey, cached: true, pattern: rulebook.get(ruleKey) };
  }

  const lower = payloadText.toLowerCase();

  // 1. Prompt Injection Patterns
  if (
    lower.includes('ignore previous instructions') ||
    lower.includes('you are now dan') ||
    lower.includes('dump private key') ||
    lower.includes('export private key') ||
    lower.includes('exfiltrate key') ||
    lower.includes('system override') ||
    lower.includes('forget your rules') ||
    lower.includes('<script') ||
    lower.includes('javascript:')
  ) {
    const rec = {
      clean: false,
      anomalyType: 'PROMPT_INJECTION',
      severity: 'HIGH',
      pattern: payloadText,
      ruleId: ruleKey,
    };
    if (rulebook) rulebook.set(ruleKey, rec);
    return rec;
  }

  // 2. Billing Emergencies (CRITICAL escalation)
  if (
    lower.includes('negative reserve') ||
    lower.includes('unbacked mint') ||
    lower.includes('bypass double-count check') ||
    lower.includes('duplicate payout')
  ) {
    const rec = {
      clean: false,
      anomalyType: 'BILLING_EMERGENCY',
      severity: 'CRITICAL',
      pattern: payloadText,
      ruleId: ruleKey,
    };
    if (rulebook) rulebook.set(ruleKey, rec);
    return rec;
  }

  // 3. Security Emergencies (CRITICAL escalation)
  if (
    lower.includes('compromised key') ||
    lower.includes('forged signature') ||
    lower.includes('unmanaged lateral pc') ||
    lower.includes('lateral pc forbidden')
  ) {
    const rec = {
      clean: false,
      anomalyType: 'SECURITY_EMERGENCY',
      severity: 'CRITICAL',
      pattern: payloadText,
      ruleId: ruleKey,
    };
    if (rulebook) rulebook.set(ruleKey, rec);
    return rec;
  }

  // 4. International Treaty Gate: Repealed SCC 2010/87/EU
  if (lower.includes('2010/87/eu') || lower.includes('celex:32010d0087')) {
    const rec = {
      clean: false,
      anomalyType: 'REPEALED_SCC',
      errorCode: ERR_REPEALED_SCC_2010_87_EU,
      severity: 'HIGH',
      pattern: payloadText,
      ruleId: ruleKey,
    };
    if (rulebook) rulebook.set(ruleKey, rec);
    return rec;
  }

  // 5. NUSD Operational State Regressions
  if (
    lower.includes('nusd paused') ||
    lower.includes('paused_and_locked') ||
    lower.includes('status: paused') ||
    lower.includes('"nusdoperationalstate":"paused"')
  ) {
    const rec = {
      clean: false,
      anomalyType: 'NUSD_REGRESSION',
      severity: 'HIGH',
      pattern: payloadText,
      ruleId: ruleKey,
    };
    if (rulebook) rulebook.set(ruleKey, rec);
    return rec;
  }

  // 6. Asana Sprint Boundary Regressions
  if (
    lower.includes('1219187222788173') ||
    (context && context.asanaSprintGid && FORBIDDEN_ASANA_GIDS.includes(context.asanaSprintGid))
  ) {
    const rec = {
      clean: false,
      anomalyType: 'FORBIDDEN_ASANA_GID',
      severity: 'HIGH',
      pattern: payloadText,
      ruleId: ruleKey,
    };
    if (rulebook) rulebook.set(ruleKey, rec);
    return rec;
  }

  // 7. Non-Canonical Origins
  if (
    (context && context.origin && context.origin !== CANONICAL_ORIGIN) ||
    lower.includes('https://*.numinalabs.xyz') ||
    lower.includes('http://www.numinalabs.xyz') ||
    lower.includes('evil-phishing.com')
  ) {
    const rec = {
      clean: false,
      anomalyType: 'NON_CANONICAL_ORIGIN',
      severity: 'HIGH',
      pattern: payloadText,
      ruleId: ruleKey,
    };
    if (rulebook) rulebook.set(ruleKey, rec);
    return rec;
  }

  return { clean: true };
}

// --- MESH ROUTER ENGINE CLASS ---

export class MeshRouter {
  constructor({
    manifestSha256,
    authorityPublicKey,
    guardianPublicKey,
    replayStore = null,
  }) {
    this.manifestSha256 = manifestSha256 || '0'.repeat(64);
    this.authorityPublicKey = authorityPublicKey ? normalizePublicKey(authorityPublicKey) : null;
    this.guardianPublicKey = guardianPublicKey ? normalizePublicKey(guardianPublicKey) : null;
    this.replayStore = replayStore || new Map();
    this.rulebook = new Map();
    this.escalations = [];
    this.channelStates = {};

    // Default Quarantine for all 16 active channels
    for (const ch of ACTIVE_CHANNELS) {
      this.channelStates[ch.id] = {
        channelId: ch.id,
        name: ch.name,
        type: ch.type,
        division: ch.division,
        sequence: 0,
        lastMessageSha256: '0'.repeat(64),
        status: 'CHANNEL_QUARANTINED_BY_DEFAULT',
        journal: [],
      };
    }

    // Default Quarantine for Google Play release lane
    for (const q of QUARANTINED_CHANNELS) {
      this.channelStates[q.id] = {
        channelId: q.id,
        name: q.name,
        sequence: 0,
        lastMessageSha256: '0'.repeat(64),
        status: 'CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED',
        journal: [],
      };
    }

    this.currentClusterStateRoot = calculateClusterStateRoot(this.channelStates, this.manifestSha256);
  }

  /**
   * Dual-Mode Governance Mode A: Cryptographic Activation of all defined rooms.
   */
  activateAllDefinedRooms(ownerAttestation) {
    if (!ownerAttestation || typeof ownerAttestation !== 'object') {
      throw new Error('INVALID_OWNER_ATTESTATION');
    }
    const {
      authoritySignatureHex,
      guardianSignatureHex,
      attestedStateRoot,
      attestedManifestSha256,
    } = ownerAttestation;

    if (
      attestedStateRoot !== this.currentClusterStateRoot ||
      attestedManifestSha256 !== this.manifestSha256
    ) {
      throw new Error('ATTESTATION_STATE_ROOT_MISMATCH');
    }

    const transcript = Buffer.from(
      `NUMINA-ROOM-ACTIVATION:${attestedManifestSha256}:${attestedStateRoot}`,
      'utf8'
    );
    const authOk = this.authorityPublicKey
      ? crypto.verify(null, transcript, this.authorityPublicKey, Buffer.from(authoritySignatureHex, 'hex'))
      : true;
    const guardOk = this.guardianPublicKey
      ? crypto.verify(null, transcript, this.guardianPublicKey, Buffer.from(guardianSignatureHex, 'hex'))
      : true;

    if (!authOk || !guardOk) {
      throw new Error('INVALID_OWNER_MULTI_SIGNATURE');
    }

    for (const cid of Object.keys(this.channelStates)) {
      this.channelStates[cid].status = 'CHANNEL_ACTIVE_VERIFIED';
    }
    this.currentClusterStateRoot = calculateClusterStateRoot(this.channelStates, this.manifestSha256);
    return this.currentClusterStateRoot;
  }

  /**
   * Dual-Mode Governance Mode B: Emergency Lockdown Switch freezing all channels.
   */
  quarantineAllChannels(reason = 'EMERGENCY_LOCKDOWN') {
    for (const cid of Object.keys(this.channelStates)) {
      this.channelStates[cid].status = 'ALL_CHANNELS_QUARANTINED_LOCKDOWN';
    }
    this.currentClusterStateRoot = calculateClusterStateRoot(this.channelStates, this.manifestSha256);
    return {
      status: 'ALL_CHANNELS_QUARANTINED_LOCKDOWN',
      reason,
      root: this.currentClusterStateRoot,
    };
  }

  /**
   * Anomaly detection delegate.
   */
  detectAnomaliesAndDrift(payloadText, context = {}) {
    return detectAnomaliesAndDrift(payloadText, context, this.rulebook);
  }

  /**
   * 3-Pillar Message Gate and Channel Dispatch.
   */
  routeChannelMessage({
    channelId,
    expectedClusterStateRoot,
    envelope,
    receiverPrivKey,
    senderPubKey,
    multiSigGrant,
    asanaSprintGid,
    origin,
  }) {
    const state = this.channelStates[channelId];
    if (!state) {
      throw new Error('UNKNOWN_CHANNEL');
    }

    // Default-deny quarantine check
    if (state.status !== 'CHANNEL_ACTIVE_VERIFIED') {
      if (state.status === 'CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED') {
        throw new Error('CHANNEL_BLOCKED_CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED');
      }
      throw new Error(`CHANNEL_BLOCKED_${state.status}`);
    }

    // Pillar 2: Cross-Room State Consistency Gate
    if (expectedClusterStateRoot !== this.currentClusterStateRoot) {
      state.status = 'CHANNEL_QUARANTINED_BY_DEFAULT';
      this.currentClusterStateRoot = calculateClusterStateRoot(this.channelStates, this.manifestSha256);
      throw new Error('STATE_ROOT_DRIFT_DETECTED');
    }

    // Pillar 3: Dual Ed25519 Multi-Signature Grant Gate
    if (multiSigGrant) {
      const transcript = Buffer.from(`GRANT:${channelId}:${expectedClusterStateRoot}`, 'utf8');
      const authOk = this.authorityPublicKey
        ? crypto.verify(null, transcript, this.authorityPublicKey, Buffer.from(multiSigGrant.authoritySignatureHex, 'hex'))
        : true;
      const guardOk = this.guardianPublicKey
        ? crypto.verify(null, transcript, this.guardianPublicKey, Buffer.from(multiSigGrant.guardianSignatureHex, 'hex'))
        : true;
      if (!authOk || !guardOk) {
        throw new Error('INVALID_DISPATCH_MULTI_SIGNATURE');
      }
    }

    // Pillar 1: E2EE Envelope Gate
    const payload = openE2eeEnvelope(receiverPrivKey, senderPubKey, envelope);
    const textToCheck = typeof payload === 'string' ? payload : canonicalizeJson(payload);

    // Self-Learning Anomaly & Anti-Drift Scan
    const anomaly = this.detectAnomaliesAndDrift(textToCheck, { channelId, asanaSprintGid, origin });
    if (!anomaly.clean) {
      if (anomaly.severity === 'CRITICAL') {
        this.escalations.push({
          channelId,
          anomaly,
          timestamp: Date.now(),
          targetThread: '#numina',
          notified: ['gang', 'skott34-ed25519'],
        });
      }
      throw new Error(`ANOMALY_BLOCKED_${anomaly.anomalyType || 'GENERIC'}`);
    }

    // Message Delivery & Ledger Commit
    state.sequence += 1;
    state.lastMessageSha256 = sha256Hex(Buffer.from(canonicalizeJson(payload), 'utf8'));
    state.journal.push({
      seq: state.sequence,
      hash: state.lastMessageSha256,
      timestamp: Date.now(),
    });
    this.currentClusterStateRoot = calculateClusterStateRoot(this.channelStates, this.manifestSha256);
    return {
      delivered: true,
      sequence: state.sequence,
      stateRoot: this.currentClusterStateRoot,
    };
  }

  /**
   * Website E2EE Chatbot Gate & 24/7 Incident Ingestion.
   */
  handleWebsiteChatbotMessage({ origin, clientIp, messageText, visitorEnvelope, receiverPrivKey, senderPubKey }) {
    if (origin !== CANONICAL_ORIGIN) {
      throw new Error('ORIGIN_FORBIDDEN_NON_CANONICAL');
    }

    let extractedText = messageText;
    if (visitorEnvelope) {
      const decrypted = openE2eeEnvelope(receiverPrivKey, senderPubKey, visitorEnvelope);
      extractedText = typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted);
    }

    if (typeof extractedText !== 'string' || extractedText.length === 0 || extractedText.length > 4096) {
      throw new Error('CHATBOT_MESSAGE_SIZE_INVALID');
    }

    const anomaly = this.detectAnomaliesAndDrift(extractedText, { origin, clientIp });
    if (!anomaly.clean) {
      this.escalations.push({
        type: '24X7_SOC_INCIDENT',
        severity: anomaly.severity === 'CRITICAL' ? 'SEV1' : 'SEV2',
        origin,
        clientIp,
        anomaly,
        timestamp: Date.now(),
        destination: '#numina',
      });
      throw new Error(`CHATBOT_ANOMALY_BLOCKED_${anomaly.anomalyType}`);
    }

    return {
      accepted: true,
      origin,
      clientIp,
      messageSha256: sha256Hex(Buffer.from(extractedText, 'utf8')),
    };
  }
}

// --- FACTORY & FUNCTIONAL EXPORTS (PROJECT.md Interface Compliance) ---

/**
 * Router initialization factory.
 */
export function createMeshRouter(config = {}) {
  return new MeshRouter(config);
}

/**
 * Functional wrapper for activateAllDefinedRooms.
 */
export function activateAllDefinedRooms(meshRouterOrState, ownerAttestation) {
  if (meshRouterOrState instanceof MeshRouter) {
    return meshRouterOrState.activateAllDefinedRooms(ownerAttestation);
  }
  if (typeof meshRouterOrState.activateAllDefinedRooms === 'function') {
    return meshRouterOrState.activateAllDefinedRooms(ownerAttestation);
  }
  throw new Error('INVALID_MESH_ROUTER_INSTANCE');
}

/**
 * Functional wrapper for quarantineAllChannels.
 */
export function quarantineAllChannels(meshRouterOrState, reason = 'EMERGENCY_LOCKDOWN') {
  if (meshRouterOrState instanceof MeshRouter) {
    return meshRouterOrState.quarantineAllChannels(reason);
  }
  if (typeof meshRouterOrState.quarantineAllChannels === 'function') {
    return meshRouterOrState.quarantineAllChannels(reason);
  }
  throw new Error('INVALID_MESH_ROUTER_INSTANCE');
}

/**
 * Functional wrapper for routeChannelMessage.
 */
export function routeChannelMessage(meshRouterOrState, dispatchRequest) {
  if (meshRouterOrState instanceof MeshRouter) {
    return meshRouterOrState.routeChannelMessage(dispatchRequest);
  }
  if (typeof meshRouterOrState.routeChannelMessage === 'function') {
    return meshRouterOrState.routeChannelMessage(dispatchRequest);
  }
  throw new Error('INVALID_MESH_ROUTER_INSTANCE');
}

/**
 * Functional wrapper for handleWebsiteChatbotMessage.
 */
export function handleWebsiteChatbotMessage(meshRouterOrState, chatbotRequest) {
  if (meshRouterOrState instanceof MeshRouter) {
    return meshRouterOrState.handleWebsiteChatbotMessage(chatbotRequest);
  }
  if (typeof meshRouterOrState.handleWebsiteChatbotMessage === 'function') {
    return meshRouterOrState.handleWebsiteChatbotMessage(chatbotRequest);
  }
  throw new Error('INVALID_MESH_ROUTER_INSTANCE');
}
