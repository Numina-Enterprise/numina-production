// numina-protocol-pqc.test.mjs — hybrid post-quantum signatures.
//
// What this proves, with ephemeral keypairs generated fresh on every run:
//  - ML-DSA-65 signs the same RFC 8785 canonical bytes as Ed25519 and
//    verifies; a tampered payload, a wrong key, or a bad signature fails;
//  - the measured sizes are pinned: ML-DSA-65 signature 3,309 bytes
//    (FIPS 204 — NOT 3,295), public key 1,952 bytes raw / 1,974 SPKI DER;
//  - a hybrid signature verifies only when BOTH parts verify; tampering
//    either part, or swapping parts between roles, fails;
//  - hybrid verification of Authority/Guardian FAILS CLOSED while their
//    ML-DSA-65 keys are unprovisioned (null in numina-protocol.json);
//  - the hybrid bundle layout is big-endian, and a little-endian-encoded
//    bundle is rejected;
//  - existing single-Ed25519 records still verify (backward compatibility
//    is the old path kept working, not a downgrade of the new one).
//
// No Authority or Guardian private key exists anywhere in this codebase;
// every keypair here is ephemeral, never stored, never logged, and never
// presented as the Authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  loadProtocol,
  canonicalBytes,
  hex,
  verifySignature,
} from '../src/numina-protocol-verify.js';
import {
  ML_DSA_65_SIGNATURE_BYTES,
  ML_DSA_65_PUBLIC_KEY_BYTES,
  ML_DSA_65_PUBLIC_KEY_SPKI_DER_BYTES,
  HYBRID_BUNDLE_BYTES,
  HYBRID_BUNDLE_MAGIC,
  HYBRID_BUNDLE_VERSION,
  HYBRID_SIGNATURE_SCHEMA,
  generateMlDsa65Keypair,
  exportMlDsa65PublicKeySpkiDer,
  mlDsa65RawPublicKeyHex,
  importMlDsa65PublicKey,
  signMlDsa65,
  verifyMlDsa65,
  encodeHybridSignatureBundle,
  decodeHybridSignatureBundle,
  hybridSignatureRecord,
  signHybridPayload,
  verifyHybridSignature,
  pqcProvisioningStatus,
  verifyHybridAuthoritySignature,
  verifyHybridGuardianSignature,
  signHybridAsRole,
  verifyHybridMurphRecord,
} from '../src/numina-protocol-pqc.js';

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

// A protocol object with ephemeral Ed25519 + ML-DSA-65 keys pinned for
// both roles, so the hybrid role guards can be tested both ways without
// touching the real pinned Authority key (whose PQC key is unprovisioned).
function testProtocol() {
  const { publicKey: aPub, secretKey: aPriv } = ed25519.keygen();
  const { publicKey: gPub, secretKey: gPriv } = ed25519.keygen();
  const aDsa = generateMlDsa65Keypair();
  const gDsa = generateMlDsa65Keypair();
  return {
    protocol: {
      authority: { rawPublicKey: hex(aPub) },
      guardian: { rawPublicKey: hex(gPub) },
      chain: { id: CHAIN_ID, genesis: GENESIS },
      postQuantum: {
        keys: {
          authority: { mlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(aDsa.publicKey) },
          guardian: { mlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(gDsa.publicKey) },
        },
      },
    },
    authorityEdPrivateKey: aPriv,
    guardianEdPrivateKey: gPriv,
    authorityDsa: aDsa,
    guardianDsa: gDsa,
  };
}

test('protocol file pins the PQC section, sizes, and unprovisioned keys', () => {
  const protocol = loadProtocol();
  assert.equal(protocol.postQuantum.schema, 'numina.protocol.pqc.v1');
  assert.equal(protocol.postQuantum.status, 'IMPLEMENTED_UNPROVISIONED');
  assert.equal(protocol.postQuantum.cryptoAgility.pqcSchemaVersion, 'numina.protocol.pqc.v1');
  assert.deepEqual(protocol.postQuantum.cryptoAgility.signatureAlgorithms, ['Ed25519', 'ML-DSA-65']);
  assert.deepEqual(protocol.postQuantum.cryptoAgility.keyExchangeAlgorithms, ['X25519', 'ML-KEM-768']);
  // Measured sizes — ML-DSA-65 signatures are 3,309 bytes, not 3,295.
  assert.equal(protocol.postQuantum.sizes.mlDsa65SignatureBytes, 3309);
  assert.equal(protocol.postQuantum.sizes.mlDsa65PublicKeyBytes, 1952);
  assert.equal(protocol.postQuantum.sizes.mlDsa65PublicKeySpkiDerBytes, 1974);
  assert.equal(protocol.postQuantum.sizes.mlKem768PublicKeyBytes, 1184);
  assert.equal(protocol.postQuantum.sizes.mlKem768PublicKeySpkiDerBytes, 1206);
  assert.equal(protocol.postQuantum.sizes.mlKem768CiphertextBytes, 1088);
  assert.equal(protocol.postQuantum.sizes.mlKem768SharedSecretBytes, 32);
  assert.equal(protocol.postQuantum.sizes.hybridSignatureBundleBytes, 3383);
  assert.equal(protocol.postQuantum.hybridKeyExchange.profile,
    'numina-e2ee-x25519-mlkem768-hkdf-aes256gcm-ed25519-mldsa65-v1');
  // PQC keys are null (unprovisioned) — no agent generated them.
  assert.equal(protocol.postQuantum.keys.authority.mlDsa65PublicKeySpkiDer, null);
  assert.equal(protocol.postQuantum.keys.guardian.mlDsa65PublicKeySpkiDer, null);
  assert.deepEqual(pqcProvisioningStatus(protocol), { authority: 'unprovisioned', guardian: 'unprovisioned' });
  // Production version is unchanged: this is the next change after v5.0.0.
  assert.equal(protocol.productionVersion, '5.0.0');
  // Endianness rule is written into the protocol file, with labeled exceptions.
  assert.match(protocol.endianness.rule, /Big-endian/);
  assert.match(protocol.endianness.rule, /hybrid signature bundle/);
  assert.match(protocol.endianness.labeledExceptions.join(' '), /RFC 8032/);
  assert.match(protocol.endianness.labeledExceptions.join(' '), /FIPS 203 \/ FIPS 204/);
});

test('ML-DSA-65 round-trip: sign canonical bytes, verify passes', () => {
  const { publicKey, privateKey } = generateMlDsa65Keypair();
  const signature = signMlDsa65({ privateKey, payload: PAYLOAD });
  assert.equal(signature.length, ML_DSA_65_SIGNATURE_BYTES * 2); // hex
  assert.equal(
    verifyMlDsa65({ publicKey, signature, payload: PAYLOAD }),
    true,
  );
  // SPKI DER hex round-trips as a public key.
  const spkiDerHex = exportMlDsa65PublicKeySpkiDer(publicKey);
  assert.equal(spkiDerHex.length, ML_DSA_65_PUBLIC_KEY_SPKI_DER_BYTES * 2);
  assert.equal(
    verifyMlDsa65({ publicKey: spkiDerHex, signature, payload: PAYLOAD }),
    true,
  );
  // Raw public key is 1,952 bytes behind the 22-byte SPKI prefix.
  assert.equal(mlDsa65RawPublicKeyHex(spkiDerHex).length, ML_DSA_65_PUBLIC_KEY_BYTES * 2);
  assert.equal(importMlDsa65PublicKey(spkiDerHex).asymmetricKeyType, 'ml-dsa-65');
});

test('ML-DSA-65 fails on tampered payload, wrong key, bad signature', () => {
  const { publicKey, privateKey } = generateMlDsa65Keypair();
  const { publicKey: otherPub } = generateMlDsa65Keypair();
  const signature = signMlDsa65({ privateKey, payload: PAYLOAD });
  assert.equal(verifyMlDsa65({ publicKey, signature, payload: { ...PAYLOAD, shots: 9999 } }), false);
  assert.equal(verifyMlDsa65({ publicKey: otherPub, signature, payload: PAYLOAD }), false);
  assert.equal(verifyMlDsa65({ publicKey, signature: '00'.repeat(3309), payload: PAYLOAD }), false);
  // Wrong-length signature (e.g. the 64-byte Ed25519 size) verifies as false.
  assert.equal(verifyMlDsa65({ publicKey, signature: '00'.repeat(64), payload: PAYLOAD }), false);
  assert.equal(verifyMlDsa65({ publicKey, signature: 'zzzz', payload: PAYLOAD }), false);
  assert.equal(verifyMlDsa65({ publicKey: '00'.repeat(1974), signature, payload: PAYLOAD }), false);
});

test('hybrid sign/verify round-trips over the same canonical bytes', () => {
  const { publicKey: edPub, secretKey: edPriv } = ed25519.keygen();
  const dsa = generateMlDsa65Keypair();
  const signed = signHybridPayload({
    ed25519PrivateKey: edPriv,
    mlDsa65PrivateKey: dsa.privateKey,
    payload: PAYLOAD,
    expectedEd25519PublicKey: hex(edPub),
    expectedMlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(dsa.publicKey),
  });
  assert.equal(signed.schema, HYBRID_SIGNATURE_SCHEMA);
  assert.equal(signed.ed25519Signature.length, 128);
  assert.equal(signed.mlDsa65Signature.length, 3309 * 2);
  assert.equal(signed.bundleHex.length, HYBRID_BUNDLE_BYTES * 2);
  assert.equal(
    verifyHybridSignature({
      ed25519PublicKey: edPub,
      mlDsa65PublicKey: exportMlDsa65PublicKeySpkiDer(dsa.publicKey),
      hybridSignature: signed,
      payload: PAYLOAD,
    }),
    true,
  );
  // The binary bundle form verifies too.
  assert.equal(
    verifyHybridSignature({
      ed25519PublicKey: edPub,
      mlDsa65PublicKey: dsa.publicKey,
      hybridSignature: signed.bundleHex,
      payload: PAYLOAD,
    }),
    true,
  );
});

test('hybrid verification fails when either part fails', () => {
  const { publicKey: edPub, secretKey: edPriv } = ed25519.keygen();
  const dsa = generateMlDsa65Keypair();
  const signed = signHybridPayload({
    ed25519PrivateKey: edPriv,
    mlDsa65PrivateKey: dsa.privateKey,
    payload: PAYLOAD,
  });
  const keys = {
    ed25519PublicKey: edPub,
    mlDsa65PublicKey: exportMlDsa65PublicKeySpkiDer(dsa.publicKey),
  };
  // Tampered Ed25519 part.
  const badEd = { ...signed, ed25519Signature: `00${signed.ed25519Signature.slice(2)}` };
  assert.equal(verifyHybridSignature({ ...keys, hybridSignature: badEd, payload: PAYLOAD }), false);
  // Tampered ML-DSA-65 part.
  const badDsa = { ...signed, mlDsa65Signature: `00${signed.mlDsa65Signature.slice(2)}` };
  assert.equal(verifyHybridSignature({ ...keys, hybridSignature: badDsa, payload: PAYLOAD }), false);
  // Tampered payload.
  assert.equal(verifyHybridSignature({ ...keys, hybridSignature: signed, payload: { ...PAYLOAD, shots: 1 } }), false);
  // Missing ML-DSA-65 key fails closed — no downgrade to Ed25519-only.
  assert.equal(
    verifyHybridSignature({ ed25519PublicKey: edPub, mlDsa65PublicKey: null, hybridSignature: signed, payload: PAYLOAD }),
    false,
  );
  // Wrong ML-DSA-65 key fails.
  const other = generateMlDsa65Keypair();
  assert.equal(
    verifyHybridSignature({
      ed25519PublicKey: edPub,
      mlDsa65PublicKey: exportMlDsa65PublicKeySpkiDer(other.publicKey),
      hybridSignature: signed,
      payload: PAYLOAD,
    }),
    false,
  );
});

test('hybrid Murph record: both roles sign the same canonical payload', () => {
  const { protocol, authorityEdPrivateKey, guardianEdPrivateKey, authorityDsa, guardianDsa } = testProtocol();
  const a = signHybridAsRole(
    { role: 'authority', ed25519PrivateKey: authorityEdPrivateKey, mlDsa65PrivateKey: authorityDsa.privateKey, payload: PAYLOAD },
    protocol,
  );
  const g = signHybridAsRole(
    { role: 'guardian', ed25519PrivateKey: guardianEdPrivateKey, mlDsa65PrivateKey: guardianDsa.privateKey, payload: PAYLOAD },
    protocol,
  );
  assert.equal(a.verified, true);
  assert.equal(g.verified, true);
  assert.equal(a.canonicalBytesHex, g.canonicalBytesHex);
  const verified = verifyHybridMurphRecord(
    { payload: PAYLOAD, authorityHybridSignature: a, guardianHybridSignature: g },
    protocol,
  );
  assert.equal(verified.authority, true);
  assert.equal(verified.guardian, true);
  assert.equal(verified.both, true);
  assert.equal(verified.genesis.ok, true);
  assert.equal(verified.complete, true);
  // Swapped: A's hybrid signature does not verify as G's, and vice versa.
  const swapped = verifyHybridMurphRecord(
    { payload: PAYLOAD, authorityHybridSignature: g, guardianHybridSignature: a },
    protocol,
  );
  assert.equal(swapped.both, false);
  assert.equal(swapped.complete, false);
});

test('hybrid Authority/Guardian verification fails closed while PQC keys are unprovisioned', () => {
  const protocol = loadProtocol();
  const { secretKey: edPriv } = ed25519.keygen();
  const dsa = generateMlDsa65Keypair();
  const signed = signHybridPayload({
    ed25519PrivateKey: edPriv,
    mlDsa65PrivateKey: dsa.privateKey,
    payload: PAYLOAD,
  });
  // Even a well-formed hybrid signature cannot verify as Authority or
  // Guardian: there is no pinned ML-DSA-65 key to check it against.
  assert.equal(verifyHybridAuthoritySignature(signed, PAYLOAD, protocol), false);
  assert.equal(verifyHybridGuardianSignature(signed, PAYLOAD, protocol), false);
  assert.equal(
    verifyHybridMurphRecord(
      { payload: PAYLOAD, authorityHybridSignature: signed, guardianHybridSignature: signed },
      protocol,
    ).complete,
    false,
  );
  // Hybrid signing as a role is refused while the key is unprovisioned.
  assert.throws(
    () => signHybridAsRole(
      { role: 'authority', ed25519PrivateKey: edPriv, mlDsa65PrivateKey: dsa.privateKey, payload: PAYLOAD },
      protocol,
    ),
    /unprovisioned/,
  );
});

test('hybrid bundle layout is big-endian and rejects little-endian encoding', () => {
  const { publicKey: edPub, secretKey: edPriv } = ed25519.keygen();
  const dsa = generateMlDsa65Keypair();
  const signed = signHybridPayload({
    ed25519PrivateKey: edPriv,
    mlDsa65PrivateKey: dsa.privateKey,
    payload: PAYLOAD,
  });
  const bundle = Buffer.from(signed.bundleHex, 'hex');
  assert.equal(bundle.length, HYBRID_BUNDLE_BYTES);
  assert.equal(bundle.subarray(0, 4).toString('ascii'), HYBRID_BUNDLE_MAGIC);
  const view = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);
  assert.equal(view.getUint16(4, false), HYBRID_BUNDLE_VERSION); // version, big-endian
  assert.equal(view.getUint16(6, false), 64); // Ed25519 length, big-endian
  assert.equal(view.getUint16(8 + 64, false), 3309); // ML-DSA-65 length, big-endian
  // Decode round-trips exactly.
  const parts = decodeHybridSignatureBundle(bundle);
  assert.equal(hex(parts.ed25519Signature), signed.ed25519Signature);
  assert.equal(hex(parts.mlDsa65Signature), signed.mlDsa65Signature);
  assert.deepEqual(
    hybridSignatureRecord(parts.ed25519Signature, parts.mlDsa65Signature),
    { schema: HYBRID_SIGNATURE_SCHEMA, ed25519Signature: signed.ed25519Signature, mlDsa65Signature: signed.mlDsa65Signature },
  );
  // A little-endian-encoded bundle: rewrite both uint16 length fields
  // little-endian. Read big-endian they become 0x4000 and 0xED0C, so the
  // strict decoder must reject it — and hybrid verification must fail.
  const leBundle = Buffer.from(bundle);
  leBundle.writeUInt16LE(64, 6);
  leBundle.writeUInt16LE(3309, 8 + 64);
  assert.throws(() => decodeHybridSignatureBundle(leBundle), /length must be/);
  assert.equal(
    verifyHybridSignature({
      ed25519PublicKey: edPub,
      mlDsa65PublicKey: exportMlDsa65PublicKeySpkiDer(dsa.publicKey),
      hybridSignature: hex(leBundle),
      payload: PAYLOAD,
    }),
    false,
  );
  // Truncated, trailing-byte, and wrong-magic bundles are rejected too.
  assert.throws(() => decodeHybridSignatureBundle(bundle.subarray(0, 100)), /must be 3383 bytes/);
  assert.throws(
    () => decodeHybridSignatureBundle(Buffer.concat([bundle, Buffer.from([0])])),
    /must be 3383 bytes/,
  );
  const badMagic = Buffer.from(bundle);
  badMagic.write('XXXX', 0, 'ascii');
  assert.throws(() => decodeHybridSignatureBundle(badMagic), /wrong magic/);
});

test('legacy single-Ed25519 records still verify (backward compatibility)', () => {
  const { publicKey, secretKey: privateKey } = ed25519.keygen();
  const signature = ed25519.sign(canonicalBytes(PAYLOAD), privateKey);
  // The old path is unchanged and still accepts the old record form.
  assert.equal(
    verifySignature({ publicKey, signature, payload: PAYLOAD }),
    true,
  );
  // But a legacy record has no ML-DSA-65 part, so hybrid verification
  // of it is false by construction — hybrid never downgrades.
  assert.equal(
    verifyHybridSignature({
      ed25519PublicKey: publicKey,
      mlDsa65PublicKey: exportMlDsa65PublicKeySpkiDer(generateMlDsa65Keypair().publicKey),
      hybridSignature: { schema: HYBRID_SIGNATURE_SCHEMA, ed25519Signature: hex(signature), mlDsa65Signature: '' },
      payload: PAYLOAD,
    }),
    false,
  );
});
