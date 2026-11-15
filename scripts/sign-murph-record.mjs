// sign-murph-record.mjs — owner-run signer for a Murph record.
//
// Usage:
//   node scripts/sign-murph-record.mjs --key-file <path> --payload <json-path> --role <authority|guardian> [--protocol <path>] [--out <path>]
//
// The owner supplies his own private key file. Accepted key forms: a file
// holding a 64-character hex seed, or a PEM PKCS#8 private key. The key is
// read into memory, used once, and never printed, logged, or written
// anywhere. Before signing, the tool derives the public key and requires it
// to equal the pinned public key for the role in numina-protocol.json — a
// key that does not belong to the pinned identity is refused, exit 1.
//
// Output (stdout, and --out file when given) is JSON: the role, the public
// key, the signature, the canonical bytes that were signed, and verified.
// To build a complete Murph record, run once per role over the same payload
// file, then combine the two signatures; src/numina-protocol-sign.js
// createSignedMurphRecord does the combining in code.
import { readFileSync, writeFileSync } from 'node:fs';
import { signAsRole, parsePrivateKey } from '../src/numina-protocol-sign.js';
import { loadProtocol } from '../src/numina-protocol-verify.js';

function usage() {
  return [
    'Usage: node scripts/sign-murph-record.mjs --key-file <path> --payload <json-path> --role <authority|guardian> [--protocol <path>] [--out <path>]',
    '',
    'Signs the RFC 8785 canonical bytes of the payload JSON with the private',
    'key in --key-file. The derived public key must match the pinned public',
    'key for --role in numina-protocol.json, or signing is refused.',
    'The private key is never printed or stored.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`missing value for --${key}`);
      }
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['key-file'] || !args.payload || !args.role) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  const protocol = args.protocol ? loadProtocol(args.protocol) : loadProtocol();
  const keyText = readFileSync(args['key-file'], 'utf8');
  const secret = parsePrivateKey(keyText);
  const payload = JSON.parse(readFileSync(args.payload, 'utf8'));
  const signed = signAsRole({ role: args.role, privateKey: secret, payload }, protocol);
  // The secret is held only in this scope and never leaves it.
  const output = {
    role: signed.role,
    publicKey: signed.publicKeyHex,
    signature: signed.signatureHex,
    canonicalBytesHex: signed.canonicalBytesHex,
    verified: signed.verified,
  };
  const text = `${JSON.stringify(output, null, 2)}\n`;
  process.stdout.write(text);
  if (args.out) writeFileSync(args.out, text);
}

try {
  main();
} catch (error) {
  process.stderr.write(`sign-murph-record: ${error.message}\n`);
  process.exitCode = 1;
}
