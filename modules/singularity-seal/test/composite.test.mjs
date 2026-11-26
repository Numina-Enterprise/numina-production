/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  COMPOSITE_PUBLIC_BYTES,
  COMPOSITE_SIGNATURE_BYTES,
  LABEL_ASCII,
  NOBLE_VERSION,
  PREFIX_ASCII,
  SUITE_OID,
} from '../src/meta.mjs';
import { canonicalBytes, canonicalizeJson, sha256Hex } from '../src/canonical.mjs';
import { messageRepresentative, signComposite, verifyComposite } from '../src/composite.mjs';
import { compositeFromSeeds } from '../src/keys.mjs';
import { assertEd25519NotPinned, rawPublicKeyFromPem, verifyEd25519, PINNED_AUTHORITY_PUBLIC_KEY_PEM } from '../src/ed25519.mjs';
import { loadPolicy } from '../src/governance.mjs';
import { signEnvelope, verifyEnvelope } from '../src/envelope.mjs';
import { blankEnvelope, compositePerson, policyDocument } from './helpers.mjs';

const KAT_SEED_ML = Buffer.alloc(32, 0x11);
const KAT_SEED_ED = Buffer.alloc(32, 0x22);
const KAT_MESSAGE = Buffer.from('singularity-seal-kat-v1', 'utf8');
const KAT_CTX = 'singularity/task-envelope/v1';
// SHA-256 of the deterministic composite signature for the throwaway seeds and
// message above. Not an operational key. Frozen so a library change fails this test.
const KAT_SIGNATURE_SHA256 = '90123c3b8ec6dda3cf5f24151c9f80576284e81662f63e378923abc831ed0e35';
const KAT_KID = '88b1596897d310d7479aec66c258addece66f9989defaf17d3998764aec0d878';

test('canonical JSON matches the provenance verifier rules', () => {
  assert.equal(canonicalizeJson({ b: 1, a: 'x' }), '{"a":"x","b":1}');
  assert.equal(canonicalizeJson([3, { z: true, a: null }]), '[3,{"a":null,"z":true}]');
  assert.throws(() => canonicalizeJson({ constructor: 1 }), /PROTOTYPE_POLLUTION_KEY_REJECTED/);
  assert.throws(() => canonicalizeJson(Number.NaN), /NON_FINITE_NUMBER_FORBIDDEN/);
});

test('RFC 10073 message representative is a known byte layout', () => {
  const mPrime = messageRepresentative(KAT_MESSAGE, KAT_CTX);
  const prefix = Buffer.from(PREFIX_ASCII, 'ascii');
  const label = Buffer.from(LABEL_ASCII, 'ascii');
  assert.equal(prefix.toString('hex'), '436f6d706f73697465416c676f726974686d5369676e61747572657332303235');
  assert.equal(label.toString('ascii'), 'COMPSIG-MLDSA65-Ed25519-SHA512');
  assert.ok(mPrime.subarray(0, prefix.length).equals(prefix));
  assert.ok(mPrime.subarray(prefix.length, prefix.length + label.length).equals(label));
  const ctxAt = prefix.length + label.length;
  assert.equal(mPrime[ctxAt], Buffer.byteLength(KAT_CTX));
  assert.equal(mPrime.subarray(ctxAt + 1, ctxAt + 1 + KAT_CTX.length).toString('utf8'), KAT_CTX);
  assert.equal(mPrime.length, prefix.length + label.length + 1 + Buffer.byteLength(KAT_CTX) + 64);
  assert.equal(SUITE_OID, '1.3.6.1.5.5.7.6.48');
  assert.equal(NOBLE_VERSION, '0.7.1');
  assert.equal(ml_dsa65.lengths.publicKey, 1952);
  assert.equal(ml_dsa65.lengths.signature, 3309);
});

test('deterministic composite known answer and round trip', () => {
  const key = compositeFromSeeds({
    signerId: 'kat',
    role: 'operator',
    mldsaSeed: KAT_SEED_ML,
    ed25519Seed: KAT_SEED_ED,
  });
  assert.equal(key.compositePublic.length, COMPOSITE_PUBLIC_BYTES);
  assert.equal(COMPOSITE_PUBLIC_BYTES, 1984);
  assert.equal(key.kid, KAT_KID);
  const first = signComposite(KAT_MESSAGE, key, { ctx: KAT_CTX, deterministic: true });
  const second = signComposite(KAT_MESSAGE, key, { ctx: KAT_CTX, deterministic: true });
  assert.equal(first.length, COMPOSITE_SIGNATURE_BYTES);
  assert.equal(COMPOSITE_SIGNATURE_BYTES, 3373);
  assert.ok(first.equals(second));
  assert.equal(sha256Hex(first), KAT_SIGNATURE_SHA256);
  const verified = verifyComposite(KAT_MESSAGE, key.compositePublic, first, { ctx: KAT_CTX });
  assert.equal(verified.ok, true);
  assert.equal(verified.verdict, 'valid');
  assert.equal(verified.components['ml-dsa-65'], 'pass');
  assert.equal(verified.components.ed25519, 'pass');
});

test('tamper of either half fails and the other half is reported', () => {
  const key = compositePerson('alice');
  const message = Buffer.from('envelope-body', 'utf8');
  const signature = signComposite(message, key, { ctx: KAT_CTX, deterministic: true });
  const mldsaFlip = Buffer.from(signature);
  mldsaFlip[10] ^= 0x01;
  const edFlip = Buffer.from(signature);
  edFlip[edFlip.length - 1] ^= 0x01;
  const badMldsa = verifyComposite(message, key.compositePublic, mldsaFlip, { ctx: KAT_CTX });
  const badEd = verifyComposite(message, key.compositePublic, edFlip, { ctx: KAT_CTX });
  assert.equal(badMldsa.ok, false);
  assert.equal(badMldsa.components['ml-dsa-65'], 'fail');
  assert.equal(badMldsa.components.ed25519, 'pass');
  assert.equal(badEd.ok, false);
  assert.equal(badEd.components['ml-dsa-65'], 'pass');
  assert.equal(badEd.components.ed25519, 'fail');
  const short = signature.subarray(0, 64);
  const stripped = verifyComposite(message, key.compositePublic, short, { ctx: KAT_CTX });
  assert.equal(stripped.ok, false);
  assert.equal(stripped.reason, 'COMPOSITE_SIGNATURE_LENGTH');
});

test('wrong key, wrong context, and a lifted Ed25519 component all fail', () => {
  const alice = compositePerson('alice');
  const bob = compositePerson('bob');
  const message = canonicalBytes({ objectType: 'task-envelope', n: 1 });
  const signature = signComposite(message, alice, { ctx: KAT_CTX, deterministic: true });
  assert.equal(verifyComposite(message, bob.compositePublic, signature, { ctx: KAT_CTX }).ok, false);
  assert.equal(verifyComposite(message, alice.compositePublic, signature, { ctx: 'singularity/provenance-record/v1' }).ok, false);
  const edOnly = signature.subarray(COMPOSITE_SIGNATURE_BYTES - 64);
  assert.equal(verifyEd25519(message, alice.edPublic, edOnly), false);
  const mPrime = messageRepresentative(message, KAT_CTX);
  assert.equal(verifyEd25519(mPrime, alice.edPublic, edOnly), true);
});

test('envelope round trip binds the body and rejects a body edit', () => {
  const alice = compositePerson('alice');
  const loaded = loadPolicy(policyDocument({ k: 1, people: [{ composite: alice }] }));
  const signed = signEnvelope(blankEnvelope(), [alice], { deterministic: true });
  const ok = verifyEnvelope(signed, loaded, { acceptLegacy: false });
  assert.equal(ok.verdict, 'valid');
  const tampered = structuredClone(signed);
  tampered.evidence.note = 'changed';
  assert.equal(verifyEnvelope(tampered, loaded).verdict, 'invalid');
  const replay = structuredClone(signed);
  replay.objectType = 'governance-policy';
  assert.throws(() => verifyEnvelope(replay, loaded), /ENVELOPE_OBJECT_TYPE/);
});

test('pinned repository public keys and already-used Ed25519 seeds are refused', () => {
  const pinned = rawPublicKeyFromPem(PINNED_AUTHORITY_PUBLIC_KEY_PEM);
  assert.throws(() => assertEd25519NotPinned(pinned), /PINNED_REPOSITORY_KEY_REFUSED/);
  assert.throws(() => compositeFromSeeds({
    signerId: 'nope',
    role: 'operator',
    mldsaSeed: Buffer.alloc(32, 3),
    ed25519Seed: Buffer.alloc(32, 4),
    legacyEd25519: true,
  }), /ED25519_KEY_ALREADY_USED_ALONE/);
});

test('package metadata names the author and operator', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.author, 'Samuel J. Kott, SK Consulting LLC dba Numina Labs');
  assert.match(pkg.copyright, /Samuel J\. Kott/);
  assert.match(pkg.copyright, /SK Consulting LLC dba Numina Labs/);
  assert.equal(pkg.license, 'BSD-3-Clause');
  assert.equal(pkg.dependencies['@noble/post-quantum'], '0.7.1');
});
