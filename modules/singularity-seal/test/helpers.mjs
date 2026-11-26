/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Throwaway keys created inside the test process. Nothing here is an
 * operational signing key, and nothing is written into the repository.
 */

import { randomBytes } from 'node:crypto';
import { toBase64, sha256Hex, canonicalBytes } from '../src/canonical.mjs';
import { generateCompositeKey, generateLegacyEd25519Key } from '../src/keys.mjs';
import { ed25519FromSeed, signEd25519 } from '../src/ed25519.mjs';
import { provenanceTranscript } from '../src/provenance.mjs';

export function compositePerson(signerId, role = 'operator') {
  return generateCompositeKey({ signerId, role });
}

export function legacyPerson(signerId, role = 'operator') {
  return generateLegacyEd25519Key({ signerId, role });
}

export function policyDocument({ phase = 1, k = 1, legacyCountsFor = ['task-envelope', 'provenance-record'], people }) {
  return {
    v: 1,
    phase,
    threshold: { k },
    legacyCountsFor,
    signers: people.map((person) => {
      const signerId = person.composite?.signerId ?? person.legacy.signerId;
      const role = person.composite?.role ?? person.legacy.role;
      const entry = { signerId, role };
      if (person.composite) {
        entry.composite = { kid: person.composite.kid, publicKey: toBase64(person.composite.compositePublic) };
      }
      if (person.legacy) {
        entry.legacy = { kid: person.legacy.kid, publicKey: toBase64(person.legacy.edPublicRaw) };
      }
      return entry;
    }),
  };
}

export function blankEnvelope(extra = {}) {
  return {
    v: 1,
    objectType: 'task-envelope',
    identity: { agent: 'alpha' },
    topology: { room: 'lab' },
    task: { name: 'check', nonce: 'n-1' },
    evidence: { note: 'none' },
    ...extra,
  };
}

export function evidenceLog(payload, seed = randomBytes(32)) {
  const ed = ed25519FromSeed(seed);
  const body = {
    artifact_type: 'NUMINA_TEST_LOG',
    key_id: sha256Hex(ed.rawPublicKey).slice(0, 24),
    payload,
  };
  const signature = signEd25519(canonicalBytes(body), ed.privateKey);
  return {
    ...body,
    algorithm: 'Ed25519',
    public_key: toBase64(ed.rawPublicKey),
    signature: toBase64(signature),
  };
}

export function provenanceRecord(signers, documents) {
  const payload = {
    schemaVersion: 'numina-provenance-manifest-v1',
    createdAtMs: 0,
    documents: documents ?? [{ path: 'note.txt', byteLength: 5, sha256: sha256Hex(Buffer.from('hello', 'utf8')) }],
  };
  const draft = { ...payload, clusterStateRootSha256: '', manifestSha256: '' };
  const preview = provenanceTranscript({ ...payload });
  const transcript = Buffer.from('NUMINA-PROVENANCE-MANIFEST-V1\n' + preview.root + '\n' + preview.canonical, 'utf8');
  return {
    ...payload,
    clusterStateRootSha256: preview.root,
    manifestSha256: preview.root,
    multiSignature: {
      algorithm: 'ed25519',
      signedAtMs: 0,
      signers: signers.map((signer) => ({
        keyId: signer.kid.slice(0, 24),
        role: signer.role,
        publicKeyPem: signer.edPublicPem,
        signatureHex: signEd25519(transcript, signer.edPrivate).toString('hex'),
      })),
    },
  };
}

export function governanceBody(phase = 1) {
  return {
    v: 1,
    objectType: 'governance-policy',
    phase,
    threshold: { k: 1 },
    legacyCountsFor: ['task-envelope'],
    signers: [{ signerId: 'placeholder', role: 'operator' }],
  };
}
