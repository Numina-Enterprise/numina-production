// numina-protocol-kex.test.mjs — hybrid post-quantum key exchange.
//
// What this proves, with ephemeral keypairs generated fresh on every run:
//  - initiator and responder derive the SAME 32-byte AES-256-GCM key
//    (X25519 + ML-KEM-768, combined via HKDF-SHA-256) and the SAME
//    transcript;
//  - the transcript's length prefixes are big-endian, as pinned;
//  - AES-256-GCM seal/open round-trips, and tampering with the
//    ciphertext, tag, or IV fails (authentication failure throws);
//  - the wrong responder key derives a DIFFERENT key (ML-KEM
//    decapsulation with the wrong key yields a different secret —
//    binding, not silent agreement);
//  - malformed inputs fail closed: bad ciphertext length, bad public-key
//    lengths, and a missing responder public key all throw; a corrupted
//    (right-length) ciphertext yields a different key via FIPS 203
//    implicit rejection — no silent agreement, and the sealed message
//    fails to open under the wrong key.
//
// No private key is stored or logged anywhere here; every keypair is
// ephemeral. The KEX module never signs — transcript authentication by
// hybrid signature is the caller's job (see src/numina-protocol-pqc.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProtocol,
  hex,
} from '../src/numina-protocol-verify.js';
import {
  KEX_PROFILE,
  SUPERSEDED_KEX_PROFILE,
  KEX_HKDF_SALT,
  X25519_PUBLIC_KEY_SPKI_DER_BYTES,
  X25519_SHARED_SECRET_BYTES,
  KEX_AES_KEY_BYTES,
  KEX_AES_IV_BYTES,
  generateKexKeypair,
  exportKexPublicKeys,
  importKexPublicKeys,
  buildKexTranscript,
  deriveKexKey,
  deriveInitiatorKey,
  deriveResponderKey,
  sealMessage,
  openMessage,
} from '../src/numina-protocol-kex.js';
import {
  ML_KEM_768_CIPHERTEXT_BYTES,
  ML_KEM_768_SHARED_SECRET_BYTES,
} from '../src/numina-protocol-pqc.js';

test('protocol file pins the new E2EE profile and KEX construction', () => {
  const protocol = loadProtocol();
  const kex = protocol.postQuantum.hybridKeyExchange;
  assert.equal(kex.profile, KEX_PROFILE);
  assert.equal(kex.profile, 'numina-e2ee-x25519-mlkem768-hkdf-aes256gcm-ed25519-mldsa65-v1');
  assert.notEqual(kex.profile, SUPERSEDED_KEX_PROFILE);
  assert.match(kex.supersedesProfileNameOnly, /numina-e2ee-x25519-hkdf-aes256gcm-ed25519-v1/);
  assert.match(kex.construction, /X25519 first/);
  assert.match(kex.construction, /numina-pqc-kex-v1/);
  assert.match(kex.construction, /AES-256-GCM/);
  assert.equal(KEX_HKDF_SALT, 'numina-pqc-kex-v1');
});

test('KEX public keys export at the pinned sizes and re-import', () => {
  const kp = generateKexKeypair();
  const exported = exportKexPublicKeys(kp);
  assert.equal(exported.x25519PublicKeySpkiDer.length, X25519_PUBLIC_KEY_SPKI_DER_BYTES * 2);
  assert.equal(exported.mlKem768PublicKeySpkiDer.length, 1206 * 2);
  const imported = importKexPublicKeys(exported);
  assert.equal(imported.x25519.asymmetricKeyType, 'x25519');
  assert.equal(imported.mlKem768.asymmetricKeyType, 'ml-kem-768');
  // Wrong-length public keys are refused.
  assert.throws(
    () => importKexPublicKeys({ ...exported, x25519PublicKeySpkiDer: '00'.repeat(10) }),
    /X25519 SPKI DER must be 44 bytes/,
  );
  assert.throws(
    () => importKexPublicKeys({ ...exported, mlKem768PublicKeySpkiDer: '00'.repeat(10) }),
    /ML-KEM-768 SPKI DER must be 1206 bytes/,
  );
});

test('initiator and responder derive the same key and the same transcript', () => {
  const responder = generateKexKeypair();
  const responderPub = exportKexPublicKeys(responder);
  const init = deriveInitiatorKey({
    recipientX25519PublicKey: responder.x25519.publicKey,
    recipientMlKem768PublicKey: responder.mlKem768.publicKey,
  });
  assert.equal(init.key.length, KEX_AES_KEY_BYTES);
  assert.equal(init.mlKem768Ciphertext.length, ML_KEM_768_CIPHERTEXT_BYTES * 2);
  assert.equal(init.ephemeralX25519PublicKeySpkiDer.length, X25519_PUBLIC_KEY_SPKI_DER_BYTES * 2);
  const resp = deriveResponderKey({
    responderX25519PrivateKey: responder.x25519.privateKey,
    responderMlKem768PrivateKey: responder.mlKem768.privateKey,
    initiatorX25519PublicKey: init.ephemeralX25519PublicKeySpkiDer,
    mlKem768Ciphertext: init.mlKem768Ciphertext,
    responderX25519PublicKey: responder.x25519.publicKey,
  });
  assert.deepEqual(Buffer.from(resp.key), Buffer.from(init.key));
  assert.deepEqual(Buffer.from(resp.transcript), Buffer.from(init.transcript));
  // The transcript is deterministic for the same inputs.
  const again = deriveResponderKey({
    responderX25519PrivateKey: responder.x25519.privateKey,
    responderMlKem768PrivateKey: responder.mlKem768.privateKey,
    initiatorX25519PublicKey: init.ephemeralX25519PublicKeySpkiDer,
    mlKem768Ciphertext: init.mlKem768Ciphertext,
    responderX25519PublicKey: responder.x25519.publicKey,
  });
  assert.deepEqual(Buffer.from(again.transcript), Buffer.from(init.transcript));
  assert.deepEqual(Buffer.from(again.key), Buffer.from(init.key));
});

test('transcript length prefixes are big-endian', () => {
  const responder = generateKexKeypair();
  const init = deriveInitiatorKey({
    recipientX25519PublicKey: responder.x25519.publicKey,
    recipientMlKem768PublicKey: responder.mlKem768.publicKey,
  });
  const t = Buffer.from(init.transcript);
  const profileBytes = Buffer.from(KEX_PROFILE, 'utf8');
  assert.deepEqual(t.subarray(0, profileBytes.length), profileBytes);
  assert.equal(t[profileBytes.length], 0x00);
  let off = profileBytes.length + 1;
  // Initiator ephemeral X25519 SPKI DER length, uint32 big-endian = 44.
  assert.equal(t.readUInt32BE(off), 44);
  off += 4 + 44;
  // Responder X25519 SPKI DER length, uint32 big-endian = 44.
  assert.equal(t.readUInt32BE(off), 44);
  off += 4 + 44;
  // ML-KEM-768 ciphertext length, uint32 big-endian = 1088.
  assert.equal(t.readUInt32BE(off), 1088);
  assert.equal(t.length, off + 4 + 1088);
  // The same transcript built directly matches.
  assert.deepEqual(
    Buffer.from(buildKexTranscript({
      initiatorX25519PublicKeyDer: Buffer.from(init.ephemeralX25519PublicKeySpkiDer, 'hex'),
      responderX25519PublicKeyDer: Buffer.from(exportKexPublicKeys(responder).x25519PublicKeySpkiDer, 'hex'),
      mlKem768Ciphertext: Buffer.from(init.mlKem768Ciphertext, 'hex'),
    })),
    t,
  );
});

test('AES-256-GCM seal/open round-trips and tampering fails', () => {
  const responder = generateKexKeypair();
  const init = deriveInitiatorKey({
    recipientX25519PublicKey: responder.x25519.publicKey,
    recipientMlKem768PublicKey: responder.mlKem768.publicKey,
  });
  const sealed = sealMessage({ key: init.key, plaintext: 'otters hold hands' });
  assert.equal(sealed.iv.length, KEX_AES_IV_BYTES * 2);
  assert.equal(sealed.authTag.length, 32);
  const opened = openMessage({ key: init.key, ...sealed });
  assert.equal(Buffer.from(opened).toString('utf8'), 'otters hold hands');
  // Tampered ciphertext, tag, or IV all fail authentication.
  const badCt = { ...sealed, ciphertext: `00${sealed.ciphertext.slice(2)}` };
  assert.throws(() => openMessage({ key: init.key, ...badCt }), /Unable to authenticate|bad decrypt|auth/i);
  const badTag = { ...sealed, authTag: `00${sealed.authTag.slice(2)}` };
  assert.throws(() => openMessage({ key: init.key, ...badTag }), /Unable to authenticate|bad decrypt|auth/i);
  const badIv = { ...sealed, iv: `00${sealed.iv.slice(2)}` };
  assert.throws(() => openMessage({ key: init.key, ...badIv }), /Unable to authenticate|bad decrypt|auth/i);
  // A wrong key fails too.
  const other = generateKexKeypair();
  const otherInit = deriveInitiatorKey({
    recipientX25519PublicKey: other.x25519.publicKey,
    recipientMlKem768PublicKey: other.mlKem768.publicKey,
  });
  assert.throws(() => openMessage({ key: otherInit.key, ...sealed }), /Unable to authenticate|bad decrypt|auth/i);
  assert.throws(() => sealMessage({ key: new Uint8Array(16), plaintext: 'x' }), /32 bytes/);
});

test('wrong responder key derives a different key — no silent agreement', () => {
  const responder = generateKexKeypair();
  const wrongResponder = generateKexKeypair();
  const init = deriveInitiatorKey({
    recipientX25519PublicKey: responder.x25519.publicKey,
    recipientMlKem768PublicKey: responder.mlKem768.publicKey,
  });
  // Decapsulating with the WRONG ML-KEM private key does not throw in
  // ML-KEM (it yields a different secret) — so the derived keys differ.
  // The X25519 private key must also be wrong-keyed for a full mismatch;
  // here the KEM mismatch alone is enough to diverge the HKDF input.
  const resp = deriveResponderKey({
    responderX25519PrivateKey: responder.x25519.privateKey,
    responderMlKem768PrivateKey: wrongResponder.mlKem768.privateKey,
    initiatorX25519PublicKey: init.ephemeralX25519PublicKeySpkiDer,
    mlKem768Ciphertext: init.mlKem768Ciphertext,
    responderX25519PublicKey: responder.x25519.publicKey,
  });
  assert.notDeepEqual(Buffer.from(resp.key), Buffer.from(init.key));
});

test('malformed KEX inputs fail closed', () => {
  const responder = generateKexKeypair();
  const init = deriveInitiatorKey({
    recipientX25519PublicKey: responder.x25519.publicKey,
    recipientMlKem768PublicKey: responder.mlKem768.publicKey,
  });
  // Bad ciphertext length.
  assert.throws(
    () =>
      deriveResponderKey({
        responderX25519PrivateKey: responder.x25519.privateKey,
        responderMlKem768PrivateKey: responder.mlKem768.privateKey,
        initiatorX25519PublicKey: init.ephemeralX25519PublicKeySpkiDer,
        mlKem768Ciphertext: '00'.repeat(10),
        responderX25519PublicKey: responder.x25519.publicKey,
      }),
    /ciphertext must be 1088 bytes/,
  );
  // Corrupted (but right-length) ciphertext: ML-KEM decapsulation uses
  // implicit rejection (FIPS 203) — it does NOT throw, it yields a
  // different shared secret. So the responder derives a DIFFERENT key:
  // no silent agreement, and a message sealed under the initiator's key
  // fails to open under the responder's key.
  const corruptCt = Buffer.from(init.mlKem768Ciphertext, 'hex');
  corruptCt[0] ^= 0xff;
  const corruptResp = deriveResponderKey({
    responderX25519PrivateKey: responder.x25519.privateKey,
    responderMlKem768PrivateKey: responder.mlKem768.privateKey,
    initiatorX25519PublicKey: init.ephemeralX25519PublicKeySpkiDer,
    mlKem768Ciphertext: hex(corruptCt),
    responderX25519PublicKey: responder.x25519.publicKey,
  });
  assert.notDeepEqual(Buffer.from(corruptResp.key), Buffer.from(init.key));
  const sealedCorrupt = sealMessage({ key: init.key, plaintext: 'do not accept' });
  assert.throws(
    () => openMessage({ key: corruptResp.key, ...sealedCorrupt }),
    /Unable to authenticate|bad decrypt|auth/i,
  );
  // Missing responder public key (needed for the transcript) throws.
  assert.throws(
    () =>
      deriveResponderKey({
        responderX25519PrivateKey: responder.x25519.privateKey,
        responderMlKem768PrivateKey: responder.mlKem768.privateKey,
        initiatorX25519PublicKey: init.ephemeralX25519PublicKeySpkiDer,
        mlKem768Ciphertext: init.mlKem768Ciphertext,
        responderX25519PublicKey: undefined,
      }),
    /required for the transcript/,
  );
  // Wrong-length shared secrets are refused by the KDF.
  assert.throws(
    () => deriveKexKey({ x25519SharedSecret: new Uint8Array(16), mlKem768SharedSecret: new Uint8Array(32) }),
    /X25519 shared secret must be 32 bytes/,
  );
  assert.throws(
    () => deriveKexKey({ x25519SharedSecret: new Uint8Array(32), mlKem768SharedSecret: new Uint8Array(16) }),
    /ML-KEM-768 shared secret must be 32 bytes/,
  );
  void ML_KEM_768_SHARED_SECRET_BYTES;
  void X25519_SHARED_SECRET_BYTES;
});
