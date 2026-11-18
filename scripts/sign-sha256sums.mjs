// sign-sha256sums.mjs — OWNER-RUN signer for a SHA256SUMS manifest.
//
// Usage (run from the repository root):
//
//   Sign BOTH roles in one run (each role: one Ed25519 key file AND one
//   ML-DSA-65 PKCS#8 key file). Writes the complete sidecar:
//     node scripts/sign-sha256sums.mjs --manifest release-evidence/SHA256SUMS.txt \
//       --authority-ed25519-key-file /path/to/authority-ed25519.key \
//       --authority-ml-dsa-65-key-file /path/to/authority-ml-dsa-65.key \
//       --guardian-ed25519-key-file /path/to/guardian-ed25519.key \
//       --guardian-ml-dsa-65-key-file /path/to/guardian-ml-dsa-65.key \
//       --out release-evidence/SHA256SUMS.txt.sig.json
//
//   Or sign ONE role at a time (run once per role over the same manifest;
//   the second run merges into the sidecar the first run wrote):
//     node scripts/sign-sha256sums.mjs --manifest release-evidence/SHA256SUMS.txt \
//       --role authority \
//       --ed25519-key-file /path/to/authority-ed25519.key \
//       --ml-dsa-65-key-file /path/to/authority-ml-dsa-65.key \
//       --out release-evidence/SHA256SUMS.txt.sig.json
//     node scripts/sign-sha256sums.mjs --manifest release-evidence/SHA256SUMS.txt \
//       --role guardian \
//       --ed25519-key-file /path/to/guardian-ed25519.key \
//       --ml-dsa-65-key-file /path/to/guardian-ml-dsa-65.key \
//       --out release-evidence/SHA256SUMS.txt.sig.json
//
//   Optional flags: --protocol <path> (default numina-protocol.json),
//   --out <path> (default: <manifest path>.sig.json).
//
// Key file forms:
//   Ed25519: a file holding a 64-character hex seed, or a PEM PKCS#8
//     private key (same forms as scripts/sign-murph-record.mjs).
//   ML-DSA-65: a PKCS#8 private key file, either PEM
//     ("-----BEGIN PRIVATE KEY-----") or raw DER bytes.
// This script NEVER generates keys. It never prints, logs, or stores
// private key material: stdout carries only the manifest path and hash,
// the sidecar path, the derived public keys, and per-role verified flags.
//
// Before signing as a role, the script derives the public key from each
// supplied private key and requires it to equal the pinned public key
// for that role (Ed25519 raw key, and ML-DSA-65 SPKI DER) in
// numina-protocol.json. A key that does not belong to the pinned
// identity is refused, exit 1. A null/unprovisioned pinned ML-DSA-65
// key refuses signing — fail-closed, no Ed25519-only fallback.
//
// What is signed: the RFC 8785 canonical bytes of
//   { schema: 'numina.sha256sums-manifest-signature.v1',
//     manifestSha256Hex: '<sha256 of the manifest text>' }
// signed hybridly (Ed25519 AND ML-DSA-65 over the same bytes) per role.
// The fresh signature is re-verified against the pinned keys before
// the sidecar is written.
//
// Exit codes: 0 = sidecar written (and every role signed in this run
// re-verified); 1 = signing refused or failed; 2 = usage error.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { loadProtocol, hex } from '../src/numina-protocol-verify.js';
import {
  signHybridPayload,
  toMlDsa65PrivateKey,
  exportMlDsa65PublicKeySpkiDer,
  pqcPublicKeyForRole,
  verifyHybridAuthoritySignature,
  verifyHybridGuardianSignature,
} from '../src/numina-protocol-pqc.js';
import {
  MANIFEST_SIGNATURE_SCHEMA,
  computeManifestSha256,
  manifestSignaturePayload,
  buildManifestSignatureSidecar,
} from '../src/numina-compliance-manifest.js';

function usage() {
  return [
    'Usage (both roles in one run):',
    '  node scripts/sign-sha256sums.mjs --manifest <SHA256SUMS.txt>',
    '    --authority-ed25519-key-file <path> --authority-ml-dsa-65-key-file <path>',
    '    --guardian-ed25519-key-file <path> --guardian-ml-dsa-65-key-file <path>',
    '    [--protocol <path>] [--out <path>]',
    '',
    'Usage (one role; run once per role, the second run merges):',
    '  node scripts/sign-sha256sums.mjs --manifest <SHA256SUMS.txt> --role <authority|guardian>',
    '    --ed25519-key-file <path> --ml-dsa-65-key-file <path>',
    '    [--protocol <path>] [--out <path>]',
    '',
    'Each supplied key is checked against the pinned public key for its',
    'role before signing. Private key material is never printed or stored.',
    'Default --out is <manifest path>.sig.json.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

/**
 * Parse an ML-DSA-65 PKCS#8 private key file: PEM
 * ("-----BEGIN PRIVATE KEY-----") or raw DER bytes. Returns a KeyObject.
 * The bytes are the caller's secret — never logged or stored.
 */
export function parseMlDsa65PrivateKeyFile(filePath) {
  const bytes = readFileSync(filePath);
  const text = bytes.toString('utf8');
  let der;
  if (text.includes('-----BEGIN')) {
    const body = text
      .replace(/-----BEGIN [^-]+-----/g, '')
      .replace(/-----END [^-]+-----/g, '')
      .replace(/\s+/g, '');
    der = new Uint8Array(Buffer.from(body, 'base64'));
  } else {
    der = new Uint8Array(bytes);
  }
  const key = createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ml-dsa-65') {
    throw new Error('supplied key is not an ml-dsa-65 private key');
  }
  return key;
}

/**
 * Sign the manifest payload hybridly as one role. The Ed25519 key must
 * derive to the pinned Ed25519 key for the role, and the ML-DSA-65 key
 * must derive to the pinned ML-DSA-65 SPKI DER for the role; an
 * unprovisioned pinned ML-DSA-65 key refuses signing. Returns the
 * hybrid signature record { schema, ed25519Signature, mlDsa65Signature }.
 */
export function signManifestAsRole(
  { role, ed25519KeyText, mlDsa65PrivateKey, manifestSha256Hex },
  protocol,
) {
  if (role !== 'authority' && role !== 'guardian') {
    throw new Error("role must be 'authority' or 'guardian'");
  }
  const pinnedPqc = pqcPublicKeyForRole(role, protocol);
  if (typeof pinnedPqc !== 'string') {
    throw new Error(`ML-DSA-65 public key for ${role} is unprovisioned — hybrid signing refused`);
  }
  // Explicit pinned-key check for the ML-DSA-65 key before signing,
  // with a clear error. (The Ed25519 pinned-key check happens inside
  // signHybridPayload via expectedEd25519PublicKey, and throws on mismatch.)
  const mlDsaKey = toMlDsa65PrivateKey(mlDsa65PrivateKey);
  const derivedMlDsaSpkiDer = hex(createPublicKey(mlDsaKey).export({ type: 'spki', format: 'der' }));
  if (derivedMlDsaSpkiDer !== pinnedPqc.toLowerCase()) {
    throw new Error(
      `supplied ML-DSA-65 key does not match the pinned public key for ${role} — refusing to sign`,
    );
  }
  const payload = manifestSignaturePayload(manifestSha256Hex);
  const signed = signHybridPayload({
    ed25519PrivateKey: ed25519KeyText,
    mlDsa65PrivateKey: mlDsaKey,
    payload,
    expectedEd25519PublicKey: protocol[role].rawPublicKey,
    expectedMlDsa65PublicKeySpkiDer: pinnedPqc,
  });
  const record = {
    schema: signed.schema,
    ed25519Signature: signed.ed25519Signature,
    mlDsa65Signature: signed.mlDsa65Signature,
  };
  const verified =
    role === 'authority'
      ? verifyHybridAuthoritySignature(record, payload, protocol)
      : verifyHybridGuardianSignature(record, payload, protocol);
  if (!verified) {
    throw new Error('fresh hybrid signature failed re-verification — refusing to return it');
  }
  return { record, verified };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  const protocol = args.protocol ? loadProtocol(args.protocol) : loadProtocol();
  const manifestText = readFileSync(args.manifest, 'utf8');
  const manifestSha256Hex = computeManifestSha256(manifestText);
  const out = args.out ?? `${args.manifest}.sig.json`;

  const bothRoles =
    args['authority-ed25519-key-file'] &&
    args['authority-ml-dsa-65-key-file'] &&
    args['guardian-ed25519-key-file'] &&
    args['guardian-ml-dsa-65-key-file'];
  const singleRole =
    args.role && args['ed25519-key-file'] && args['ml-dsa-65-key-file'];

  if (!bothRoles && !singleRole) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (bothRoles && singleRole) {
    throw new Error('give either the four per-role key files or --role with two key files, not both');
  }

  // Start from an existing sidecar when merging a single-role run into
  // it; otherwise start empty. A sidecar naming a different manifest
  // hash is refused, never overwritten with the wrong binding.
  let sidecar = null;
  if (existsSync(out)) {
    const existing = JSON.parse(readFileSync(out, 'utf8'));
    if (existing.schema !== MANIFEST_SIGNATURE_SCHEMA) {
      throw new Error(`existing sidecar ${out} has the wrong schema — refusing to merge`);
    }
    if (existing.manifestSha256Hex !== manifestSha256Hex) {
      throw new Error(
        `existing sidecar ${out} names a different manifest hash — refusing to merge`,
      );
    }
    sidecar = existing;
  }

  const rolesSigned = {};
  const signOne = (role, edKeyFile, dsaKeyFile) => {
    const ed25519KeyText = readFileSync(edKeyFile, 'utf8');
    const mlDsa65PrivateKey = parseMlDsa65PrivateKeyFile(dsaKeyFile);
    const { record, verified } = signManifestAsRole(
      { role, ed25519KeyText, mlDsa65PrivateKey, manifestSha256Hex },
      protocol,
    );
    rolesSigned[role] = { verified };
    return record;
  };

  let authority = sidecar?.authority ?? null;
  let guardian = sidecar?.guardian ?? null;
  if (bothRoles) {
    authority = signOne(
      'authority',
      args['authority-ed25519-key-file'],
      args['authority-ml-dsa-65-key-file'],
    );
    guardian = signOne(
      'guardian',
      args['guardian-ed25519-key-file'],
      args['guardian-ml-dsa-65-key-file'],
    );
  } else {
    const record = signOne(args.role, args['ed25519-key-file'], args['ml-dsa-65-key-file']);
    if (args.role === 'authority') authority = record;
    else guardian = record;
  }

  const finalSidecar = buildManifestSignatureSidecar({
    manifestSha256Hex,
    authority,
    guardian,
  });
  writeFileSync(out, `${JSON.stringify(finalSidecar, null, 2)}\n`);
  const summary = {
    manifest: args.manifest,
    manifestSha256Hex,
    out,
    complete: authority !== null && guardian !== null,
    rolesSigned,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`sign-sha256sums: ${error.message}\n`);
  process.exitCode = 1;
}
