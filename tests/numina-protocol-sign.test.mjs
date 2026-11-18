// numina-protocol-sign.test.mjs — signing functionality for the Singularity Protocol.
// Samuel J. Kott, SK Consulting LLC, operating under Numina Labs.
//
// What this proves:
//  - a runtime-supplied private key signs RFC 8785 canonical bytes, and the
//    signature verifies with the matching public key;
//  - signing as a role is refused unless the supplied key derives to the
//    pinned public key for that role (no key substitution);
//  - a signed Murph record carries both signatures over the same canonical
//    bytes and verifies as a whole;
//  - the owner-run CLI signs with a key file and refuses a wrong-role key,
//    without ever printing the private key.
//
// Every keypair here is EPHEMERAL: generated fresh on every run, used only
// to prove the signing path, never stored, never logged, and never presented
// as the Authority. The real Authority private key belongs to the owner
// alone; no signature as the Authority exists until he runs the CLI with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  parsePrivateKey,
  derivePublicKey,
  signPayload,
  signAsRole,
  createSignedMurphRecord,
} from '../src/numina-protocol-sign.js';
import {
  loadProtocol,
  verifySignature,
  hex,
} from '../src/numina-protocol-verify.js';

const execFileAsync = promisify(execFile);

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

// A protocol object with ephemeral keys pinned, so the role guard can be
// tested both ways without touching the real pinned Authority key.
function testProtocol() {
  const { publicKey: aPub, secretKey: aPriv } = ed25519.keygen();
  const { publicKey: gPub, secretKey: gPriv } = ed25519.keygen();
  return {
    protocol: {
      authority: { rawPublicKey: hex(aPub) },
      guardian: { rawPublicKey: hex(gPub) },
      chain: { id: CHAIN_ID, genesis: GENESIS },
    },
    authorityPrivateKey: aPriv,
    guardianPrivateKey: gPriv,
  };
}

test('parsePrivateKey accepts hex, bytes, and PEM PKCS#8', () => {
  const { secretKey } = ed25519.keygen();
  assert.deepEqual(parsePrivateKey(hex(secretKey)), secretKey);
  assert.deepEqual(parsePrivateKey(secretKey), secretKey);
  // Unencrypted PKCS#8 for Ed25519: 302e 020100 300506032b6570 04220420 + seed.
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const der = Buffer.concat([prefix, Buffer.from(secretKey)]);
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.toString('base64')}\n-----END PRIVATE KEY-----\n`;
  assert.deepEqual(parsePrivateKey(pem), secretKey);
  assert.throws(() => parsePrivateKey('not a key'), /private key must be/);
  assert.throws(() => parsePrivateKey(new Uint8Array(10)), /32 bytes/);
});

test('sign then verify round-trips over canonical bytes', () => {
  const { publicKey, secretKey } = ed25519.keygen();
  const signed = signPayload({ privateKey: secretKey, payload: PAYLOAD, expectedPublicKey: hex(publicKey) });
  assert.equal(signed.publicKeyHex, hex(publicKey));
  assert.equal(verifySignature({ publicKey, signature: signed.signatureHex, payload: PAYLOAD }), true);
  // A signature over the same payload with one field changed does not verify.
  assert.equal(
    verifySignature({ publicKey, signature: signed.signatureHex, payload: { ...PAYLOAD, shots: 9999 } }),
    false,
  );
});

test('signing is refused when the key does not match the expected public key', () => {
  const { secretKey } = ed25519.keygen();
  const { publicKey: other } = ed25519.keygen();
  assert.throws(
    () => signPayload({ privateKey: secretKey, payload: PAYLOAD, expectedPublicKey: hex(other) }),
    /does not match the expected public key/,
  );
});

test('signAsRole refuses a key that is not the pinned Authority key', () => {
  const { secretKey } = ed25519.keygen();
  const protocol = loadProtocol();
  assert.throws(
    () => signAsRole({ role: 'authority', privateKey: secretKey, payload: PAYLOAD }, protocol),
    /does not match the expected public key/,
  );
  assert.throws(
    () => signAsRole({ role: 'guardian', privateKey: secretKey, payload: PAYLOAD }, protocol),
    /does not match the expected public key/,
  );
  assert.throws(
    () => signAsRole({ role: 'someone', privateKey: secretKey, payload: PAYLOAD }, protocol),
    /role must be/,
  );
});

test('signAsRole succeeds when the key derives to the pinned key', () => {
  const { protocol, authorityPrivateKey, guardianPrivateKey } = testProtocol();
  const a = signAsRole({ role: 'authority', privateKey: authorityPrivateKey, payload: PAYLOAD }, protocol);
  const g = signAsRole({ role: 'guardian', privateKey: guardianPrivateKey, payload: PAYLOAD }, protocol);
  assert.equal(a.verified, true);
  assert.equal(g.verified, true);
  assert.equal(a.canonicalBytesHex, g.canonicalBytesHex);
  assert.notEqual(a.signatureHex, g.signatureHex);
});

test('createSignedMurphRecord signs both roles over the same canonical bytes', () => {
  const { protocol, authorityPrivateKey, guardianPrivateKey } = testProtocol();
  const record = createSignedMurphRecord(
    { payload: PAYLOAD, authorityPrivateKey, guardianPrivateKey },
    protocol,
  );
  assert.equal(record.verified.both, true);
  assert.equal(record.verified.authority, true);
  assert.equal(record.verified.guardian, true);
  assert.equal(record.verified.genesis.ok, true);
  assert.equal(record.verified.complete, true);
  assert.equal(record.authority.publicKey, protocol.authority.rawPublicKey);
  assert.equal(record.guardian.publicKey, protocol.guardian.rawPublicKey);
  assert.equal(
    verifySignature({ publicKey: record.authority.publicKey, signature: record.authority.signature, payload: PAYLOAD }),
    true,
  );
  assert.equal(
    verifySignature({ publicKey: record.guardian.publicKey, signature: record.guardian.signature, payload: PAYLOAD }),
    true,
  );
});

test('owner CLI signs with a key file and never prints the private key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'numina-sign-'));
  const { protocol, authorityPrivateKey } = testProtocol();
  const protocolPath = join(dir, 'protocol.json');
  const keyPath = join(dir, 'test-key.hex');
  const payloadPath = join(dir, 'payload.json');
  await writeFile(protocolPath, JSON.stringify(protocol));
  await writeFile(keyPath, hex(authorityPrivateKey));
  await writeFile(payloadPath, JSON.stringify(PAYLOAD));
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/sign-murph-record.mjs',
    '--key-file', keyPath,
    '--payload', payloadPath,
    '--role', 'authority',
    '--protocol', protocolPath,
  ], { cwd: new URL('..', import.meta.url).pathname });
  const out = JSON.parse(stdout);
  assert.equal(out.role, 'authority');
  assert.equal(out.publicKey, protocol.authority.rawPublicKey);
  assert.equal(out.verified, true);
  assert.equal(
    verifySignature({ publicKey: out.publicKey, signature: out.signature, payload: PAYLOAD }),
    true,
  );
  assert.ok(!stdout.includes(hex(authorityPrivateKey)), 'private key must never appear in CLI output');
});

test('owner CLI refuses a key that does not belong to the role', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'numina-sign-'));
  const { protocol } = testProtocol();
  const { secretKey: wrongKey } = ed25519.keygen();
  const protocolPath = join(dir, 'protocol.json');
  const keyPath = join(dir, 'wrong-key.hex');
  const payloadPath = join(dir, 'payload.json');
  await writeFile(protocolPath, JSON.stringify(protocol));
  await writeFile(keyPath, hex(wrongKey));
  await writeFile(payloadPath, JSON.stringify(PAYLOAD));
  await assert.rejects(
    execFileAsync(process.execPath, [
      'scripts/sign-murph-record.mjs',
      '--key-file', keyPath,
      '--payload', payloadPath,
      '--role', 'authority',
      '--protocol', protocolPath,
    ], { cwd: new URL('..', import.meta.url).pathname }),
    /does not match the expected public key/,
  );
});

test('derivePublicKey matches noble directly', () => {
  const { publicKey, secretKey } = ed25519.keygen();
  assert.equal(derivePublicKey(secretKey), hex(publicKey));
  assert.equal(derivePublicKey(hex(secretKey)), hex(publicKey));
});
