/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealArchive, verifyArchive, archiveKeyFromSeed } from '../src/archive.mjs';
import { evidenceLog, provenanceRecord, legacyPerson } from './helpers.mjs';

function batch() {
  return [
    evidenceLog({ n: 1, label: 'a' }, Buffer.alloc(32, 5)),
    evidenceLog({ n: 2, label: 'b' }, Buffer.alloc(32, 6)),
    evidenceLog({ n: 3, label: 'c' }, Buffer.alloc(32, 7)),
  ];
}

test('archive seal round trip and batch tamper detection', () => {
  const records = batch();
  const snapshot = JSON.stringify(records);
  const key = archiveKeyFromSeed({ signerId: 'archivist', seed: Buffer.alloc(32, 9) });
  const archive = sealArchive(records, [key], {
    batchId: 'batch-1',
    signedAt: '2026-11-26T00:00:00.000Z',
    deterministic: true,
  });
  assert.equal(JSON.stringify(records), snapshot);
  assert.equal(JSON.stringify(archive).includes(key.seed.toString('base64')), false);
  const ok = verifyArchive(archive, records);
  assert.equal(ok.ok, true);
  assert.equal(ok.verdict, 'valid');
  assert.equal(ok.signatures[0].components['ml-dsa-65'], 'pass');
  const tampered = structuredClone(records);
  tampered[1].payload.label = 'changed';
  const bad = verifyArchive(archive, tampered);
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.includes('MERKLE_ROOT_MISMATCH'));
  assert.ok(bad.reasons.includes('ED25519_LOG_FAILED'));
  const flipped = structuredClone(archive);
  const sig = Buffer.from(flipped.signatures[0].sig, 'base64');
  sig[20] ^= 0x01;
  flipped.signatures[0].sig = sig.toString('base64');
  const badSig = verifyArchive(flipped, records);
  assert.equal(badSig.ok, false);
  assert.ok(badSig.reasons.includes('ML_DSA_FAILED'));
  assert.equal(badSig.reasons.includes('MERKLE_ROOT_MISMATCH'), false);
});

test('archive threshold counts distinct people', () => {
  const records = batch();
  const one = archiveKeyFromSeed({ signerId: 'ada', seed: Buffer.alloc(32, 8) });
  const samePerson = archiveKeyFromSeed({ signerId: 'ada', seed: Buffer.alloc(32, 10) });
  const other = archiveKeyFromSeed({ signerId: 'bea', seed: Buffer.alloc(32, 12) });
  const doubled = sealArchive(records, [one, samePerson], {
    batchId: 'people',
    signedAt: '2026-11-26T00:00:00.000Z',
    thresholdK: 2,
    deterministic: true,
  });
  const notEnough = verifyArchive(doubled, records);
  assert.equal(notEnough.ok, false);
  assert.equal(notEnough.distinctSigners, 1);
  assert.ok(notEnough.reasons.includes('THRESHOLD_NOT_MET'));
  assert.equal(notEnough.signatures.filter((sig) => sig.counts === 1).length, 1);
  const enough = sealArchive(records, [one, other], {
    batchId: 'people',
    signedAt: '2026-11-26T00:00:00.000Z',
    thresholdK: 2,
    deterministic: true,
  });
  const passed = verifyArchive(enough, records);
  assert.equal(passed.ok, true);
  assert.equal(passed.distinctSigners, 2);
});

test('archive accepts a provenance manifest without changing it', () => {
  const signer = legacyPerson('logger');
  const manifest = provenanceRecord([signer]);
  const before = JSON.stringify(manifest);
  const key = archiveKeyFromSeed({ signerId: 'archivist', seed: Buffer.alloc(32, 15) });
  const archive = sealArchive([manifest], [key], {
    batchId: 'prov',
    signedAt: '2026-11-26T00:00:00.000Z',
    deterministic: true,
  });
  assert.equal(JSON.stringify(manifest), before);
  assert.equal(verifyArchive(archive, [manifest]).ok, true);
  const tampered = structuredClone(manifest);
  tampered.multiSignature.signers[0].signatureHex = 'ab'.repeat(64);
  const bad = verifyArchive(archive, [tampered]);
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.includes('MERKLE_ROOT_MISMATCH'));
});
