// numina-compliance-manifest.test.mjs — SHA256SUMS manifests with
// detached dual (Ed25519 + ML-DSA-65) signatures.
//
// What this proves, with ephemeral keypairs generated fresh on every run:
//  - manifest generation emits standard sha256sum format: one line per
//    file, `<sha256-hex><two spaces><relative-path>`, lines sorted by
//    path byte order, LF endings, one trailing LF, exact hashes
//    (cross-checked against node:crypto);
//  - verification passes on untampered files and fails on a tampered
//    file, a missing file, a malformed line, a duplicate path, and
//    unsorted lines (fail-closed);
//  - dual-signature verification passes when BOTH roles hybrid-sign the
//    manifest hash, and fails when the Ed25519 part is bad, when the
//    ML-DSA-65 part is bad, when the signature comes from an unpinned
//    key, or when the pinned ML-DSA-65 key is unprovisioned (the real
//    protocol: no Ed25519-only fallback);
//  - the owner-run sign + verify CLI scripts work end to end on a
//    temp-dir fixture (sign with ephemeral test keys via a test
//    protocol file, then verify; a tampered artifact then fails).
//
// No Authority or Guardian private key exists anywhere in this file;
// every keypair here is ephemeral, generated in-test, never stored,
// never logged, and never presented as the Authority. All test
// artifacts live in a temp dir (node:os tmpdir), never in the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  loadProtocol,
  hex,
  canonicalBytes,
} from '../src/numina-protocol-verify.js';
import {
  generateMlDsa65Keypair,
  exportMlDsa65PublicKeySpkiDer,
  signHybridPayload,
  HYBRID_SIGNATURE_SCHEMA,
} from '../src/numina-protocol-pqc.js';
import {
  MANIFEST_SIGNATURE_SCHEMA,
  generateManifest,
  parseManifest,
  verifyManifest,
  computeManifestSha256,
  manifestSignaturePayload,
  buildManifestSignatureSidecar,
  verifyManifestSignatures,
  verifySignedManifest,
} from '../src/numina-compliance-manifest.js';

const execFileAsync = promisify(execFile);

const CHAIN_ID = 962421430;
const GENESIS = '0x05b4e83876ea30a83f011ab5b0537b59ea1175810dc977f1d4eefbd1d0d7c88b';

// A protocol object with ephemeral Ed25519 + ML-DSA-65 keys pinned for
// both roles, so the dual-signature checks can be tested without touching
// the real pinned Authority key (whose PQC key is unprovisioned).
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

/** The three-field hybrid signature record (no bundle/canonical extras). */
function hybridRecord(signed) {
  return {
    schema: signed.schema,
    ed25519Signature: signed.ed25519Signature,
    mlDsa65Signature: signed.mlDsa65Signature,
  };
}

function signBothRoles(fixture, manifestSha256Hex) {
  const payload = manifestSignaturePayload(manifestSha256Hex);
  const authority = signHybridPayload({
    ed25519PrivateKey: fixture.authorityEdPrivateKey,
    mlDsa65PrivateKey: fixture.authorityDsa.privateKey,
    payload,
    expectedEd25519PublicKey: fixture.protocol.authority.rawPublicKey,
    expectedMlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(fixture.authorityDsa.publicKey),
  });
  const guardian = signHybridPayload({
    ed25519PrivateKey: fixture.guardianEdPrivateKey,
    mlDsa65PrivateKey: fixture.guardianDsa.privateKey,
    payload,
    expectedEd25519PublicKey: fixture.protocol.guardian.rawPublicKey,
    expectedMlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(fixture.guardianDsa.publicKey),
  });
  return {
    payload,
    sidecar: buildManifestSignatureSidecar({
      manifestSha256Hex,
      authority: hybridRecord(authority),
      guardian: hybridRecord(guardian),
    }),
  };
}

/** A temp dir with two artifacts; cleaned up by the caller via t.after. */
function fixtureDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'numina-compliance-manifest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.txt'), 'alpha\n');
  writeFileSync(join(dir, 'sub-b.txt'), 'bravo\n');
  return dir;
}

function nodeCryptoSha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

test('manifest generation: sorted lines, exact hashes, LF endings', (t) => {
  const dir = fixtureDir(t);
  // Deliberately unsorted input order — generation must sort by path.
  const manifest = generateManifest(['sub-b.txt', 'a.txt'], { baseDir: dir });
  const lines = manifest.split('\n');
  assert.equal(lines.at(-1), '', 'manifest ends with exactly one trailing LF');
  assert.equal(lines.length, 3, 'two lines plus the trailing empty split');
  assert.equal(lines[0], `${nodeCryptoSha256Hex('alpha\n')}  a.txt`);
  assert.equal(lines[1], `${nodeCryptoSha256Hex('bravo\n')}  sub-b.txt`);
  assert.ok(!manifest.includes('\r'), 'LF endings only');
  assert.match(lines[0], /^[0-9a-f]{64}  a\.txt$/);
  // Byte-order sorting: 'Z.txt' (0x5a) sorts before 'a.txt' (0x61).
  writeFileSync(join(dir, 'Z.txt'), 'zulu\n');
  const sorted = generateManifest(['a.txt', 'Z.txt', 'sub-b.txt'], { baseDir: dir });
  assert.deepEqual(
    sorted.split('\n').slice(0, -1).map((line) => line.slice(66)),
    ['Z.txt', 'a.txt', 'sub-b.txt'],
  );
  // parseManifest round-trips the generated text.
  assert.deepEqual(parseManifest(manifest), [
    { path: 'a.txt', sha256: nodeCryptoSha256Hex('alpha\n') },
    { path: 'sub-b.txt', sha256: nodeCryptoSha256Hex('bravo\n') },
  ]);
  // The manifest hash is the SHA-256 of the manifest text itself.
  assert.equal(computeManifestSha256(manifest), nodeCryptoSha256Hex(manifest));
});

test('verification passes on untampered files', (t) => {
  const dir = fixtureDir(t);
  const manifest = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  assert.deepEqual(verifyManifest(manifest, { baseDir: dir }), { ok: true, failures: [] });
});

test('tampered file content fails verification', (t) => {
  const dir = fixtureDir(t);
  const manifest = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  writeFileSync(join(dir, 'a.txt'), 'alpha TAMPERED\n');
  const result = verifyManifest(manifest, { baseDir: dir });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].path, 'a.txt');
  assert.equal(result.failures[0].expected, nodeCryptoSha256Hex('alpha\n'));
  assert.equal(result.failures[0].actual, nodeCryptoSha256Hex('alpha TAMPERED\n'));
  assert.equal(result.failures[0].reason, 'SHA-256 mismatch');
});

test('missing file fails verification', (t) => {
  const dir = fixtureDir(t);
  const manifest = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  rmSync(join(dir, 'sub-b.txt'));
  const result = verifyManifest(manifest, { baseDir: dir });
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].path, 'sub-b.txt');
  assert.equal(result.failures[0].expected, nodeCryptoSha256Hex('bravo\n'));
  assert.equal(result.failures[0].actual, null);
  assert.equal(result.failures[0].reason, 'file is missing');
});

test('malformed manifest line fails verification', (t) => {
  const dir = fixtureDir(t);
  const good = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  const cases = [
    ['single-space separator', good.replace('  a.txt', ' a.txt')],
    ['uppercase hex', good.replace(/^[0-9a-f]/, (c) => c.toUpperCase())],
    ['short hash', good.replace(/^[0-9a-f]{64}/, 'ab')],
    ['binary-mode marker', good.replace('  a.txt', ' *a.txt')],
    ['missing trailing LF', good.slice(0, -1)],
    ['trailing blank line', `${good}\n`],
    ['CRLF endings', good.replaceAll('\n', '\r\n')],
  ];
  for (const [name, text] of cases) {
    const result = verifyManifest(text, { baseDir: dir });
    assert.equal(result.ok, false, name);
    assert.ok(result.failures.length >= 1, name);
  }
  assert.throws(() => parseManifest(cases[0][1]), /malformed manifest line/);
});

test('duplicate path and unsorted lines fail verification', (t) => {
  const dir = fixtureDir(t);
  const hashA = nodeCryptoSha256Hex('alpha\n');
  const hashB = nodeCryptoSha256Hex('bravo\n');
  const duplicate = `${hashA}  a.txt\n${hashA}  a.txt\n`;
  assert.equal(verifyManifest(duplicate, { baseDir: dir }).ok, false);
  assert.match(verifyManifest(duplicate, { baseDir: dir }).failures[0].reason, /duplicate/);
  assert.throws(() => parseManifest(duplicate), /duplicate/);
  const unsorted = `${hashB}  sub-b.txt\n${hashA}  a.txt\n`;
  assert.equal(verifyManifest(unsorted, { baseDir: dir }).ok, false);
  assert.match(verifyManifest(unsorted, { baseDir: dir }).failures[0].reason, /not sorted/);
  assert.throws(() => parseManifest(unsorted), /not sorted/);
});

test('dual-signature verification passes with both roles', (t) => {
  const dir = fixtureDir(t);
  const fixture = testProtocol();
  const manifest = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  const manifestSha256Hex = computeManifestSha256(manifest);
  const { sidecar } = signBothRoles(fixture, manifestSha256Hex);
  assert.equal(sidecar.schema, MANIFEST_SIGNATURE_SCHEMA);
  assert.equal(sidecar.manifestSha256Hex, manifestSha256Hex);
  assert.equal(sidecar.authority.schema, HYBRID_SIGNATURE_SCHEMA);
  assert.equal(sidecar.guardian.schema, HYBRID_SIGNATURE_SCHEMA);
  const verified = verifyManifestSignatures({
    manifestSha256Hex,
    signatures: sidecar,
    protocol: fixture.protocol,
  });
  assert.deepEqual(
    { authority: verified.authority, guardian: verified.guardian, both: verified.both },
    { authority: true, guardian: true, both: true },
  );
  assert.equal(verified.canonicalBytesHex, hex(canonicalBytes(manifestSignaturePayload(manifestSha256Hex))));
  // The combined check passes too.
  const combined = verifySignedManifest({
    manifestText: manifest,
    signatures: sidecar,
    baseDir: dir,
    protocol: fixture.protocol,
  });
  assert.equal(combined.ok, true);
  assert.equal(combined.manifestSha256Hex, manifestSha256Hex);
});

test('a bad Ed25519 part fails that role', (t) => {
  const dir = fixtureDir(t);
  const fixture = testProtocol();
  const manifest = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  const manifestSha256Hex = computeManifestSha256(manifest);
  const { sidecar } = signBothRoles(fixture, manifestSha256Hex);
  const tampered = structuredClone(sidecar);
  tampered.authority.ed25519Signature = `00${tampered.authority.ed25519Signature.slice(2)}`;
  const verified = verifyManifestSignatures({
    manifestSha256Hex,
    signatures: tampered,
    protocol: fixture.protocol,
  });
  assert.equal(verified.authority, false);
  assert.equal(verified.guardian, true);
  assert.equal(verified.both, false);
  assert.equal(
    verifySignedManifest({ manifestText: manifest, signatures: tampered, baseDir: dir, protocol: fixture.protocol }).ok,
    false,
  );
});

test('a bad ML-DSA-65 part fails that role', (t) => {
  const dir = fixtureDir(t);
  const fixture = testProtocol();
  const manifest = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  const manifestSha256Hex = computeManifestSha256(manifest);
  const { sidecar } = signBothRoles(fixture, manifestSha256Hex);
  const tampered = structuredClone(sidecar);
  tampered.guardian.mlDsa65Signature = `00${tampered.guardian.mlDsa65Signature.slice(2)}`;
  const verified = verifyManifestSignatures({
    manifestSha256Hex,
    signatures: tampered,
    protocol: fixture.protocol,
  });
  assert.equal(verified.guardian, false);
  assert.equal(verified.authority, true);
  assert.equal(verified.both, false);
});

test('a signature from an unpinned key fails', (t) => {
  const dir = fixtureDir(t);
  const fixture = testProtocol();
  const attacker = testProtocol();
  const manifest = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  const manifestSha256Hex = computeManifestSha256(manifest);
  // The attacker signs validly with their own keys — but their keys are
  // not pinned, so verification against the pinned keys must fail.
  const { sidecar } = signBothRoles(attacker, manifestSha256Hex);
  const verified = verifyManifestSignatures({
    manifestSha256Hex,
    signatures: sidecar,
    protocol: fixture.protocol,
  });
  assert.equal(verified.authority, false);
  assert.equal(verified.guardian, false);
  assert.equal(verified.both, false);
});

test('an unprovisioned ML-DSA-65 key fails closed against the real protocol', (t) => {
  const dir = fixtureDir(t);
  const fixture = testProtocol();
  const protocol = loadProtocol();
  assert.equal(protocol.postQuantum.keys.authority.mlDsa65PublicKeySpkiDer, null);
  assert.equal(protocol.postQuantum.keys.guardian.mlDsa65PublicKeySpkiDer, null);
  const manifest = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  const manifestSha256Hex = computeManifestSha256(manifest);
  // Ephemeral keys sign the payload fine — but the real protocol pins
  // null ML-DSA-65 keys, so hybrid verification must fail closed rather
  // than falling back to Ed25519-only.
  const { sidecar } = signBothRoles(fixture, manifestSha256Hex);
  const verified = verifyManifestSignatures({
    manifestSha256Hex,
    signatures: sidecar,
    protocol,
  });
  assert.deepEqual(verified.provisioned, { authority: false, guardian: false });
  assert.equal(verified.authority, false);
  assert.equal(verified.guardian, false);
  assert.equal(verified.both, false);
  // A sidecar naming a different manifest hash also fails.
  const wrongHash = verifyManifestSignatures({
    manifestSha256Hex: nodeCryptoSha256Hex('something else'),
    signatures: sidecar,
    protocol: fixture.protocol,
  });
  assert.equal(wrongHash.sidecarHashMatches, false);
  assert.equal(wrongHash.both, false);
});

test('sign and verify CLI scripts work end to end on a temp fixture', async (t) => {
  const dir = fixtureDir(t);
  const fixture = testProtocol();
  const manifestPath = join(dir, 'SHA256SUMS.txt');
  const manifest = generateManifest(['a.txt', 'sub-b.txt'], { baseDir: dir });
  writeFileSync(manifestPath, manifest);
  // A test protocol file pinning the ephemeral keys, so the owner-run
  // scripts can check the supplied keys against pinned keys.
  const protocolPath = join(dir, 'test-protocol.json');
  writeFileSync(protocolPath, JSON.stringify(fixture.protocol, null, 2));
  // Key files in the forms the sign script accepts: Ed25519 as a
  // 64-char hex seed, ML-DSA-65 as PEM PKCS#8 (authority) and raw DER
  // PKCS#8 (guardian) — both parsers are exercised.
  const authorityEdKey = join(dir, 'authority-ed25519.key');
  writeFileSync(authorityEdKey, `${hex(fixture.authorityEdPrivateKey.slice(0, 32))}\n`);
  const authorityDsaKey = join(dir, 'authority-ml-dsa-65.key');
  writeFileSync(
    authorityDsaKey,
    fixture.authorityDsa.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  );
  const guardianEdKey = join(dir, 'guardian-ed25519.key');
  writeFileSync(guardianEdKey, `${hex(fixture.guardianEdPrivateKey.slice(0, 32))}\n`);
  const guardianDsaKey = join(dir, 'guardian-ml-dsa-65.key');
  writeFileSync(
    guardianDsaKey,
    fixture.guardianDsa.privateKey.export({ type: 'pkcs8', format: 'der' }),
  );
  const sidecarPath = join(dir, 'SHA256SUMS.txt.sig.json');
  const node = process.execPath;
  const sign = await execFileAsync(node, [
    'scripts/sign-sha256sums.mjs',
    '--manifest', manifestPath,
    '--authority-ed25519-key-file', authorityEdKey,
    '--authority-ml-dsa-65-key-file', authorityDsaKey,
    '--guardian-ed25519-key-file', guardianEdKey,
    '--guardian-ml-dsa-65-key-file', guardianDsaKey,
    '--protocol', protocolPath,
    '--out', sidecarPath,
  ], { cwd: new URL('..', import.meta.url).pathname });
  const signSummary = JSON.parse(sign.stdout);
  assert.equal(signSummary.complete, true);
  assert.equal(signSummary.manifestSha256Hex, computeManifestSha256(manifest));
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  assert.equal(sidecar.schema, MANIFEST_SIGNATURE_SCHEMA);
  const verify = await execFileAsync(node, [
    'scripts/verify-sha256sums.mjs',
    '--manifest', manifestPath,
    '--signatures', sidecarPath,
    '--protocol', protocolPath,
    '--base-dir', dir,
  ], { cwd: new URL('..', import.meta.url).pathname });
  const verifySummary = JSON.parse(verify.stdout);
  assert.equal(verifySummary.ok, true);
  assert.equal(verifySummary.signaturesBoth, true);
  // Tamper an artifact: the same sidecar must now fail verification.
  writeFileSync(join(dir, 'a.txt'), 'alpha TAMPERED\n');
  await assert.rejects(
    execFileAsync(node, [
      'scripts/verify-sha256sums.mjs',
      '--manifest', manifestPath,
      '--signatures', sidecarPath,
      '--protocol', protocolPath,
      '--base-dir', dir,
    ], { cwd: new URL('..', import.meta.url).pathname }),
    (error) => {
      assert.match(error.stdout, /"ok": false/);
      assert.match(error.stderr, /SHA-256 mismatch/);
      return true;
    },
  );
});
