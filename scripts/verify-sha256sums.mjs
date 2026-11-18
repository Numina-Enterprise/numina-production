// verify-sha256sums.mjs — verify a SHA256SUMS manifest and its detached
// dual (Ed25519 + ML-DSA-65) signature sidecar.
//
// Usage (run from the repository root):
//   node scripts/verify-sha256sums.mjs \
//     --manifest release-evidence/SHA256SUMS.txt \
//     --signatures release-evidence/SHA256SUMS.txt.sig.json \
//     [--protocol <path>] [--base-dir <path>]
//
//   --manifest:    the SHA256SUMS.txt to verify.
//   --signatures:  the .sig.json sidecar produced by scripts/sign-sha256sums.mjs.
//   --protocol:    protocol config carrying the pinned keys
//                  (default numina-protocol.json).
//   --base-dir:    directory the manifest's relative paths resolve under
//                  (default: the manifest file's own directory).
//
// Exit 0 only when EVERYTHING verifies: every file exists with its
// recorded SHA-256, the manifest lines are well-formed, sorted and
// unique, the sidecar names this manifest's hash, and BOTH roles'
// hybrid signatures verify (Ed25519 AND ML-DSA-65 per role, against
// the pinned keys). Anything else exits 1 with a JSON summary on
// stdout describing the failures. Usage errors exit 2.
// This script holds no private keys and signs nothing.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadProtocol } from '../src/numina-protocol-verify.js';
import { verifySignedManifest } from '../src/numina-compliance-manifest.js';

function usage() {
  return [
    'Usage: node scripts/verify-sha256sums.mjs --manifest <SHA256SUMS.txt> --signatures <sidecar.json> [--protocol <path>] [--base-dir <path>]',
    '',
    'Verifies every file hash in the manifest and both roles\' hybrid',
    'signatures in the sidecar. Exit 0 only when everything verifies.',
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.signatures) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  const protocol = args.protocol ? loadProtocol(args.protocol) : loadProtocol();
  const manifestPath = resolve(args.manifest);
  const baseDir = args['base-dir'] ? resolve(args['base-dir']) : dirname(manifestPath);
  const manifestText = readFileSync(manifestPath, 'utf8');
  const signatures = JSON.parse(readFileSync(resolve(args.signatures), 'utf8'));
  const result = verifySignedManifest({ manifestText, signatures, baseDir, protocol });
  const summary = {
    ok: result.ok,
    manifest: args.manifest,
    signatures: args.signatures,
    baseDir,
    manifestSha256Hex: result.manifestSha256Hex,
    manifestOk: result.manifest.ok,
    manifestFailures: result.manifest.failures,
    signatureAuthority: result.signatures.authority,
    signatureGuardian: result.signatures.guardian,
    signaturesBoth: result.signatures.both,
    sidecarSchemaOk: result.signatures.sidecarSchemaOk,
    sidecarHashMatches: result.signatures.sidecarHashMatches,
    provisioned: result.signatures.provisioned,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!result.ok) {
    const reasons = [
      ...result.manifest.failures.map(
        (failure) => `${failure.path || '(manifest)'}: ${failure.reason}`,
      ),
      ...(result.signatures.sidecarSchemaOk ? [] : ['sidecar schema mismatch']),
      ...(result.signatures.sidecarHashMatches ? [] : ['sidecar names a different manifest hash']),
      ...(result.signatures.authority ? [] : ['authority hybrid signature does not verify']),
      ...(result.signatures.guardian ? [] : ['guardian hybrid signature does not verify']),
    ];
    process.stderr.write(`verify-sha256sums: FAILED — ${reasons.join('; ')}\n`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`verify-sha256sums: ${error.message}\n`);
  process.exitCode = 1;
}
