// numina-protocol-verify.test.mjs — verify-only round-trip for the Numina Protocol.
//
// What this proves, without ever signing as the Authority:
//  - the pinned Authority + Guardian public keys in numina-protocol.json are
//    self-consistent (PEM, raw key, and SPKI hash all agree);
//  - an Ed25519 signature verifies over RFC 8785 canonical bytes and FAILS
//    over non-canonical bytes, a tampered payload, or the wrong key;
//  - the Murph check mechanics work: two signatures over the same canonical
//    payload both verify.
//
// The test keypair below is EPHEMERAL: generated fresh on every run, used
// only to prove the verify path, never stored, never logged, and never
// presented as the Authority. There is no Authority private key anywhere in
// this codebase. A real Murph record needs real signatures from the owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  loadProtocol,
  canonicalBytes,
  hex,
  spkiDerFromRaw,
  spkiSha256Hex,
  pemToDer,
  verifyPinnedKeys,
  verifySignature,
  verifyAuthoritySignature,
  verifyGuardianSignature,
  verifyMurphRecord,
  checkGenesis,
} from '../src/numina-protocol-verify.js';

const CHAIN_ID = 962421430;
const GENESIS = '0x05b4e83876ea30a83f011ab5b0537b59ea1175810dc977f1d4eefbd1d0d7c88b';

const PAYLOAD = {
  jobId: 'dbrsr4gk09pc73avfing',
  backend: 'ibm_kingston',
  pair: [3, 16],
  fidelity: '0.908350',
  shots: 10000,
  chainId: CHAIN_ID,
  genesis: GENESIS,
};

test('protocol file loads with the approved version and constant', () => {
  const protocol = loadProtocol();
  assert.equal(protocol.name, 'The Numina Protocol');
  assert.equal(protocol.productionVersion, '5.0.0');
  assert.equal(protocol.constants.gamma.value, 0.2375);
});

test('pinned Authority and Guardian keys are self-consistent', () => {
  const protocol = loadProtocol();
  const checked = verifyPinnedKeys(protocol);
  assert.equal(checked.details.authorityPemTailMatches, true);
  assert.equal(checked.details.authorityDerMatches, true);
  assert.equal(checked.details.authorityHashMatches, true);
  assert.equal(checked.details.guardianHashMatches, true);
  assert.equal(checked.authority, true);
  assert.equal(checked.guardian, true);
  // Exact keypins, as recorded in the repo's own AGENTS.md.
  assert.equal(protocol.authority.spkiSha256, '46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce');
  assert.equal(protocol.guardian.spkiSha256, '465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c');
  // SPKI DER rebuilt from the raw key equals the PEM-decoded DER, exactly.
  assert.equal(hex(spkiDerFromRaw(protocol.authority.rawPublicKey)), hex(pemToDer(protocol.authority.pem)));
  assert.equal(spkiSha256Hex(protocol.guardian.rawPublicKey), protocol.guardian.spkiSha256);
});

test('canonical bytes are stable and key-order independent (RFC 8785)', () => {
  const a = canonicalBytes({ b: 1, a: { d: 4, c: 3 } });
  const b = canonicalBytes({ a: { c: 3, d: 4 }, b: 1 });
  assert.equal(new TextDecoder().decode(a), '{"a":{"c":3,"d":4},"b":1}');
  assert.deepEqual(a, b);
});

test('ephemeral round-trip: sign canonical bytes, verify passes', () => {
  const { publicKey, secretKey: privateKey } = ed25519.keygen();
  const signature = ed25519.sign(canonicalBytes(PAYLOAD), privateKey);
  assert.equal(
    verifySignature({ publicKey, signature, payload: PAYLOAD }),
    true,
  );
});

test('same signature over non-canonical bytes fails', () => {
  const { publicKey, secretKey: privateKey } = ed25519.keygen();
  // Sign the plain JSON.stringify bytes (insertion order, spaces) instead.
  const nonCanonical = new TextEncoder().encode(JSON.stringify(PAYLOAD, null, 2));
  const signature = ed25519.sign(nonCanonical, privateKey);
  assert.equal(
    verifySignature({ publicKey, signature, payload: PAYLOAD }),
    false,
  );
});

test('tampered payload fails', () => {
  const { publicKey, secretKey: privateKey } = ed25519.keygen();
  const signature = ed25519.sign(canonicalBytes(PAYLOAD), privateKey);
  const tampered = { ...PAYLOAD, fidelity: '0.908351' };
  assert.equal(
    verifySignature({ publicKey, signature, payload: tampered }),
    false,
  );
});

test('a test signature does NOT verify as the Authority or Guardian', () => {
  const { secretKey: privateKey } = ed25519.keygen();
  const signature = ed25519.sign(canonicalBytes(PAYLOAD), privateKey);
  assert.equal(verifyAuthoritySignature(signature, PAYLOAD), false);
  assert.equal(verifyGuardianSignature(signature, PAYLOAD), false);
  assert.equal(
    verifyMurphRecord({
      payload: PAYLOAD,
      authoritySignature: signature,
      guardianSignature: signature,
    }).both,
    false,
  );
});

test('Murph mechanics: two signatures over the same canonical payload both verify', () => {
  const { publicKey: pubA, secretKey: privA } = ed25519.keygen();
  const { publicKey: pubG, secretKey: privG } = ed25519.keygen();
  const bytes = canonicalBytes(PAYLOAD);
  const sigA = ed25519.sign(bytes, privA);
  const sigG = ed25519.sign(bytes, privG);
  assert.equal(verifySignature({ publicKey: pubA, signature: sigA, payload: PAYLOAD }), true);
  assert.equal(verifySignature({ publicKey: pubG, signature: sigG, payload: PAYLOAD }), true);
  // Crossed: A's signature does not verify as G's, and vice versa.
  assert.equal(verifySignature({ publicKey: pubG, signature: sigA, payload: PAYLOAD }), false);
  assert.equal(verifySignature({ publicKey: pubA, signature: sigG, payload: PAYLOAD }), false);
});

test('malformed signatures verify as false, they do not throw', () => {
  const { publicKey, secretKey: privateKey } = ed25519.keygen();
  assert.equal(
    verifySignature({ publicKey, signature: '00'.repeat(10), payload: PAYLOAD }),
    false,
  );
  assert.equal(
    verifySignature({ publicKey, signature: 'zzzz', payload: PAYLOAD }),
    false,
  );
  assert.equal(
    verifySignature({ publicKey: '00'.repeat(10), signature: '00'.repeat(64), payload: PAYLOAD }),
    false,
  );
});

test('Genesis guardrail: the pinned chain is recorded and checked', () => {
  const protocol = loadProtocol();
  assert.equal(protocol.chain.id, 962421430);
  assert.equal(protocol.chain.genesis, GENESIS);
  assert.equal(checkGenesis(PAYLOAD, protocol).ok, true);
  assert.equal(checkGenesis({ ...PAYLOAD, genesis: '0x00' }, protocol).ok, false);
  assert.equal(checkGenesis({ ...PAYLOAD, chainId: 1 }, protocol).ok, false);
  assert.equal(checkGenesis({ jobId: PAYLOAD.jobId }, protocol).ok, false);
  // Nested form is accepted too.
  const { chainId, genesis, ...rest } = PAYLOAD;
  assert.equal(checkGenesis({ ...rest, chain: { id: CHAIN_ID, genesis: GENESIS } }, protocol).ok, true);
  // A protocol with no pinned chain cannot pass.
  assert.equal(checkGenesis(PAYLOAD, { authority: protocol.authority, guardian: protocol.guardian }).ok, false);
});

test('Murph record is complete only when signed AND chain-bound', () => {
  const { publicKey: pubA, secretKey: privA } = ed25519.keygen();
  const { publicKey: pubG, secretKey: privG } = ed25519.keygen();
  const protocol = {
    authority: { rawPublicKey: hex(pubA) },
    guardian: { rawPublicKey: hex(pubG) },
    chain: { id: CHAIN_ID, genesis: GENESIS },
  };
  const bytes = canonicalBytes(PAYLOAD);
  const sigA = ed25519.sign(bytes, privA);
  const sigG = ed25519.sign(bytes, privG);
  const complete = verifyMurphRecord(
    { payload: PAYLOAD, authoritySignature: sigA, guardianSignature: sigG },
    protocol,
  );
  assert.equal(complete.both, true);
  assert.equal(complete.genesis.ok, true);
  assert.equal(complete.complete, true);
  // Same keys, but the payload names no chain: sign the unchained payload
  // itself, so both signatures verify — and the record is still not complete.
  const { chainId, genesis, ...unchained } = PAYLOAD;
  const unchainedBytes = canonicalBytes(unchained);
  const unchainedResult = verifyMurphRecord(
    {
      payload: unchained,
      authoritySignature: ed25519.sign(unchainedBytes, privA),
      guardianSignature: ed25519.sign(unchainedBytes, privG),
    },
    protocol,
  );
  assert.equal(unchainedResult.both, true);
  assert.equal(unchainedResult.genesis.ok, false);
  assert.equal(unchainedResult.complete, false);
});
