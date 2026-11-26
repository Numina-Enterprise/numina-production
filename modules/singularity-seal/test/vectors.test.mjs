/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Runs vendored NIST ACVP ML-DSA-65 samples and the RFC 10073
 * id-MLDSA65-Ed25519-SHA512 vector. See vectors/README.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { compositeFromSeeds } from '../src/keys.mjs';
import { verifyComposite } from '../src/composite.mjs';

const hex = (value) => Buffer.from(value, 'hex');
const b64 = (value) => Buffer.from(value, 'base64');

function load(name) {
  return JSON.parse(readFileSync(new URL('../vectors/' + name, import.meta.url), 'utf8'));
}

test('ACVP ML-DSA-65 keyGen matches pk and sk', () => {
  const file = load('acvp-mldsa65-keygen.json');
  assert.equal(file.source.commit, '975de31eb83d87039ec88934fdc47d8c312b892d');
  assert.equal(file.source.parameterSet, 'ML-DSA-65');
  assert.equal(file.tests.length, 25);
  for (const row of file.tests) {
    const keys = ml_dsa65.keygen(hex(row.seed));
    assert.ok(Buffer.from(keys.publicKey).equals(hex(row.pk)), 'pk tc ' + row.tcId);
    assert.ok(Buffer.from(keys.secretKey).equals(hex(row.sk)), 'sk tc ' + row.tcId);
  }
});

test('ACVP ML-DSA-65 sigGen matches deterministic and hedged signatures', () => {
  const file = load('acvp-mldsa65-siggen.json');
  assert.equal(file.groups.length, 2);
  for (const group of file.groups) {
    assert.equal(group.signatureInterface, 'external');
    assert.equal(group.preHash, 'pure');
    assert.equal(group.tests.length, 15);
    for (const row of group.tests) {
      const opts = { context: hex(row.context) };
      if (group.deterministic) opts.extraEntropy = false;
      else opts.extraEntropy = hex(row.rnd);
      const signature = Buffer.from(ml_dsa65.sign(hex(row.message), hex(row.sk), opts));
      assert.ok(signature.equals(hex(row.signature)), 'tg ' + group.tgId + ' tc ' + row.tcId);
    }
  }
});

test('ACVP ML-DSA-65 sigVer matches testPassed', () => {
  const file = load('acvp-mldsa65-sigver.json');
  assert.equal(file.source.upstreamTgId, 3);
  assert.equal(file.tests.length, 15);
  let passed = 0;
  let failed = 0;
  for (const row of file.tests) {
    const ok = ml_dsa65.verify(hex(row.signature), hex(row.message), hex(row.pk), { context: hex(row.context) });
    assert.equal(ok, row.testPassed, 'tc ' + row.tcId);
    if (row.testPassed) passed += 1;
    else failed += 1;
  }
  assert.equal(passed, 3);
  assert.equal(failed, 12);
});

test('RFC 10073 ML-DSA-65+Ed25519 vector verifies and the seed reproduces the public key', () => {
  const file = load('rfc10073-mldsa65-ed25519.json');
  assert.equal(file.source.commit, '7b2bf64dc4a7df710c19ca330adc15a4163100bb');
  assert.equal(file.test.tcId, 'id-MLDSA65-Ed25519-SHA512');
  const message = b64(file.m);
  const ctx = b64(file.ctx);
  const pk = b64(file.test.pk);
  const sk = b64(file.test.sk);
  assert.equal(sk.length, 64);
  assert.equal(pk.length, 1984);
  const key = compositeFromSeeds({
    signerId: 'rfc10073-vector',
    role: 'kat',
    mldsaSeed: sk.subarray(0, 32),
    ed25519Seed: sk.subarray(32),
  });
  assert.ok(Buffer.from(key.compositePublic).equals(pk));
  const empty = verifyComposite(message, pk, b64(file.test.s), { ctx: Buffer.alloc(0) });
  const withCtx = verifyComposite(message, pk, b64(file.test.sWithContext), { ctx });
  assert.equal(empty.ok, true);
  assert.equal(empty.components['ml-dsa-65'], 'pass');
  assert.equal(empty.components.ed25519, 'pass');
  assert.equal(withCtx.ok, true);
  const flipped = Buffer.from(b64(file.test.s));
  flipped[0] ^= 0x01;
  assert.equal(verifyComposite(message, pk, flipped, { ctx: Buffer.alloc(0) }).ok, false);
  assert.equal(verifyComposite(message, pk, b64(file.test.s), { ctx }).ok, false);
});
