/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Verifier CLI for Envelope Seal and Archive Seal. Secret key material is
 * read only to sign, and it is never written to stdout or stderr.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { versionText } from './meta.mjs';
import { loadPolicy } from './governance.mjs';
import { loadCompositeKeyFile } from './keys.mjs';
import { signEnvelope, verifyEnvelope, signGovernance, verifyGovernance } from './envelope.mjs';
import { sealProvenance, verifyProvenanceSeal } from './provenance.mjs';
import { loadArchiveKeyFile, sealArchive, verifyArchive } from './archive.mjs';

const HELP = `${versionText()}

Usage:
  seal --version
  seal --help
  seal verify --envelope <file> --policy <file> [--legacy]
  seal verify --provenance <file> --seal <file> --policy <file> [--legacy]
  seal verify --governance <file> --policy <file> [--legacy]
  seal sign --envelope <file> --key <file> [--key <file> ...] --out <file> [--deterministic]
  seal sign --provenance <file> --key <file> [--key <file> ...] --out <file> [--deterministic]
  seal sign --governance <file> --key <file> [--key <file> ...] --out <file> [--deterministic]
  seal archive --batch <file> --key <file> [--key <file> ...] --out <file> --batch-id <id> [--signed-at <iso>] [--threshold <k>] [--deterministic]
  seal archive-verify --archive <file> --batch <file> [--policy <file>]

--legacy accepts Ed25519-only signatures and prints verdict: legacy.
Without --legacy those signatures are rejected. They are never treated as valid.
Exit 0 means verdict valid or legacy. Exit 1 means rejected. Exit 2 means usage error.
Threshold lines count distinct signers (people), not algorithms.
`;

function parseArgs(argv) {
  const out = { _: [] };
  const repeat = new Set(['key']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-V') {
      out.version = true;
      continue;
    }
    if (arg === '--legacy') {
      out.legacy = true;
      continue;
    }
    if (arg === '--deterministic') {
      out.deterministic = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('MISSING_VALUE:' + key);
      i += 1;
      if (repeat.has(key)) {
        (out[key] ??= []).push(value);
      } else if (out[key] !== undefined) {
        throw new Error('DUPLICATE_OPTION:' + key);
      } else {
        out[key] = value;
      }
      continue;
    }
    out._.push(arg);
  }
  return out;
}

function readJson(file) {
  const text = readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) throw new Error('BOM_FORBIDDEN');
  return JSON.parse(text);
}

function keysOf(args) {
  const files = args.key ?? [];
  if (files.length === 0) throw new Error('KEY_REQUIRED');
  return files;
}

function formatSignatures(decision) {
  const lines = [
    'product: envelope-seal',
    'object: ' + (decision.objectType ?? 'unknown'),
    'verdict: ' + decision.verdict,
  ];
  if (decision.reason) lines.push('reason: ' + decision.reason);
  lines.push('legacy: ' + (decision.verdict === 'legacy' ? 'explicit' : 'no'));
  if (decision.threshold) {
    lines.push(
      'threshold: ' + decision.threshold.distinctSigners + ' of ' + decision.threshold.k
      + ' distinct signers (people), not algorithms',
    );
  }
  for (const sig of decision.signatures ?? []) {
    const parts = [
      'signer: ' + sig.signerId,
      'role=' + sig.role,
      'suite=' + sig.suite,
      'ml-dsa-65=' + (sig.components?.['ml-dsa-65'] ?? 'absent'),
      'ed25519=' + (sig.components?.ed25519 ?? 'absent'),
      'counts=' + sig.counts,
    ];
    if (sig.reason) parts.push('reason=' + sig.reason);
    lines.push(parts.join(' '));
  }
  return lines.join('\n') + '\n';
}

function formatArchive(result) {
  const lines = [
    'product: archive-seal',
    'verdict: ' + result.verdict,
    'legacy: no',
  ];
  if (result.reasons?.length) lines.push('reasons: ' + result.reasons.join(','));
  lines.push(
    'threshold: ' + (result.distinctSigners ?? 0) + ' of ' + (result.threshold?.k ?? 0)
    + ' distinct signers (people), not algorithms',
  );
  for (const sig of result.signatures ?? []) {
    const parts = [
      'signer: ' + sig.signerId,
      'suite=' + sig.suite,
      'ml-dsa-65=' + sig.components['ml-dsa-65'],
      'counts=' + sig.counts,
    ];
    if (sig.reason) parts.push('reason=' + sig.reason);
    lines.push(parts.join(' '));
  }
  return lines.join('\n') + '\n';
}

function compositeKeys(args) {
  return keysOf(args).map((file) => loadCompositeKeyFile(readJson(file)));
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.version) {
    process.stdout.write(versionText() + '\n');
    return 0;
  }
  if (args.help || args._.length === 0) {
    process.stdout.write(HELP);
    return args.help ? 0 : 2;
  }
  const command = args._[0];
  if (command === 'verify') {
    const policy = loadPolicy(readJson(args.policy));
    const options = { acceptLegacy: args.legacy === true };
    let decision;
    if (args.envelope) {
      decision = verifyEnvelope(readJson(args.envelope), policy, options);
    } else if (args.provenance) {
      if (!args.seal) throw new Error('SEAL_REQUIRED');
      decision = verifyProvenanceSeal(readJson(args.provenance), readJson(args.seal), policy, options);
    } else if (args.governance) {
      decision = verifyGovernance(readJson(args.governance), policy, options);
    } else {
      throw new Error('VERIFY_TARGET_REQUIRED');
    }
    process.stdout.write(formatSignatures(decision));
    return decision.verdict === 'valid' || decision.verdict === 'legacy' ? 0 : 1;
  }
  if (command === 'sign') {
    if (!args.out) throw new Error('OUT_REQUIRED');
    const keys = compositeKeys(args);
    const deterministic = args.deterministic === true;
    if (args.envelope) {
      const signed = signEnvelope(readJson(args.envelope), keys, { deterministic });
      writeFileSync(args.out, JSON.stringify(signed, null, 2) + '\n');
    } else if (args.provenance) {
      const signed = sealProvenance(readJson(args.provenance), keys, { deterministic });
      writeFileSync(args.out, JSON.stringify(signed, null, 2) + '\n');
    } else if (args.governance) {
      const signed = signGovernance(readJson(args.governance), keys, { deterministic });
      writeFileSync(args.out, JSON.stringify(signed, null, 2) + '\n');
    } else {
      throw new Error('SIGN_TARGET_REQUIRED');
    }
    process.stdout.write('wrote signature file\n');
    return 0;
  }
  if (command === 'archive') {
    if (!args.out || !args['batch-id']) throw new Error('ARCHIVE_ARGS_REQUIRED');
    const keys = keysOf(args).map((file) => loadArchiveKeyFile(readJson(file)));
    const archive = sealArchive(readJson(args.batch), keys, {
      batchId: args['batch-id'],
      signedAt: args['signed-at'],
      thresholdK: args.threshold === undefined ? undefined : Number(args.threshold),
      deterministic: args.deterministic === true,
    });
    writeFileSync(args.out, JSON.stringify(archive, null, 2) + '\n');
    process.stdout.write('wrote archive seal\n');
    return 0;
  }
  if (command === 'archive-verify') {
    const policy = args.policy ? readJson(args.policy) : null;
    const result = verifyArchive(readJson(args.archive), readJson(args.batch), { policy });
    process.stdout.write(formatArchive(result));
    return result.ok ? 0 : 1;
  }
  throw new Error('UNKNOWN_COMMAND');
}
