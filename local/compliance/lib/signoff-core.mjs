// Ed25519 human sign-off records: build, sign, verify against the committed public key.
import {createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalJson, sha256Hex, MODULE_ROOT} from './util.mjs';

export const SIGNER_LABEL = 'SKOTT34-Ed25519';
export const SIGNOFF_SCHEMA = 'numina.compliance.signoff/v1';
export const DECISIONS = {counterparty: ['approve', 'reject'], payment: ['clear', 'reject']};

export const signersPath = (env = process.env) => env.NUMINA_COMPLIANCE_SIGNERS || join(MODULE_ROOT, 'keys', 'signers.json');

export function spkiSha256(publicKey) {
  return sha256Hex(publicKey.export({type: 'spki', format: 'der'}));
}

/** Load the committed signer registry (public keys only). */
export function loadSigners(env = process.env) {
  const reg = JSON.parse(readFileSync(signersPath(env), 'utf8'));
  const out = new Map();
  for (const s of reg.signers || []) {
    if (!s.publicKeyPem) continue;
    const key = createPublicKey(s.publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error(`signer ${s.label}: not an Ed25519 key`);
    const fp = spkiSha256(key);
    if (s.publicKeySha256 && s.publicKeySha256 !== fp) throw new Error(`signer ${s.label}: publicKeySha256 does not match publicKeyPem`);
    out.set(s.label, {...s, key, publicKeySha256: fp});
  }
  return out;
}

/** The exact compliance output a sign-off covers; its sha256 goes into the signed payload. */
export function complianceOutput(c) {
  return {
    caseId: c.id, caseType: c.caseType,
    kyc: c.caseType === 'counterparty' ? {counterparty: c.counterparty, validation: c.validation, idv: c.idv} : undefined,
    screening: c.screening ?? null,
    manualChecks: c.manualChecks ?? [],
    dispositions: c.dispositions ?? [],
    aml: c.aml ?? null,
    payments: c.payments ?? undefined,
    risk: c.risk ?? null,
    merchantRules: c.merchantRules ?? undefined,
    blockers: c.blockers ?? [],
  };
}
export const outputSha256 = (c) => sha256Hex(canonicalJson(complianceOutput(c)));

export function loadPrivateKey(path, passphrase) {
  const key = createPrivateKey({key: readFileSync(path), passphrase});
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('sign-off key must be an Ed25519 private key (PEM)');
  return key;
}

/** Create a signed record. Refuses if the private key does not match the committed signer public key. */
export function createSignoff({caseRecord, decision, privateKey, signers, label = SIGNER_LABEL, now = new Date(), org}) {
  const allowed = DECISIONS[caseRecord.caseType];
  if (!allowed?.includes(decision)) throw new Error(`decision must be one of ${allowed?.join(', ')} for ${caseRecord.caseType} cases`);
  const signer = signers.get(label);
  if (!signer) throw new Error(`no committed public key for signer ${label} in ${'keys/signers.json'}`);
  const fp = spkiSha256(createPublicKey(privateKey));
  if (fp !== signer.publicKeySha256) throw new Error(`private key does not match the committed ${label} public key (${signer.publicKeySha256.slice(0, 16)}…, got ${fp.slice(0, 16)}…)`);
  const payload = {
    schema: SIGNOFF_SCHEMA, caseId: caseRecord.id, caseType: caseRecord.caseType, decision,
    outputSha256: outputSha256(caseRecord), signer: label, publicKeySha256: fp, signedAt: now.toISOString(),
    organization: org ?? 'S K Consulting LLC dba Numina Labs',
  };
  const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64');
  return {payload, signature, alg: 'Ed25519'};
}

/** Verify a sign-off. With caseRecord, also checks that the case content still hashes to the signed value. */
export function verifySignoff(record, {signers, caseRecord} = {}) {
  const problems = [];
  if (!record?.payload || !record.signature) return {valid: false, problems: ['missing sign-off']};
  const p = record.payload;
  if (p.schema !== SIGNOFF_SCHEMA) problems.push('unknown schema');
  const signer = signers?.get(p.signer);
  if (!signer) problems.push(`signer ${p.signer} not in committed registry`);
  else {
    if (signer.publicKeySha256 !== p.publicKeySha256) problems.push('public key fingerprint mismatch');
    let ok = false;
    try { ok = verify(null, Buffer.from(canonicalJson(p)), signer.key, Buffer.from(record.signature, 'base64')); } catch { ok = false; }
    if (!ok) problems.push('signature invalid');
  }
  if (caseRecord) {
    if (caseRecord.id !== p.caseId) problems.push('case id mismatch');
    if (caseRecord.caseType !== p.caseType) problems.push('case type mismatch');
    if (outputSha256(caseRecord) !== p.outputSha256) problems.push('case content changed since sign-off (output hash mismatch)');
  }
  return {valid: problems.length === 0, problems, payload: p};
}
