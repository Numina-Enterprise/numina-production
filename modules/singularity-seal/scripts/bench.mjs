/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Times composite keygen, sign, and verify, and Archive Seal on batches of
 * 1000 and 10000 Ed25519 logs. Throwaway keys stay in memory.
 */

import { randomBytes } from 'node:crypto';
import { cpus, arch, platform, release, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalBytes, sha256Hex, toBase64 } from '../src/canonical.mjs';
import { ed25519FromSeed, signEd25519 } from '../src/ed25519.mjs';
import { generateCompositeKey } from '../src/keys.mjs';
import { signComposite, verifyComposite } from '../src/composite.mjs';
import { archiveKeyFromSeed, sealArchive, verifyArchive } from '../src/archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CTX = 'singularity/task-envelope/v1';
const MESSAGE = Buffer.from('singularity-seal-bench-message', 'utf8');

function evidenceRecord(index) {
  const seed = Buffer.alloc(32, 0);
  seed.writeUInt32BE(index + 1, 28);
  const ed = ed25519FromSeed(seed);
  const body = {
    artifact_type: 'NUMINA_TEST_LOG',
    key_id: sha256Hex(ed.rawPublicKey).slice(0, 24),
    payload: { index },
  };
  return {
    ...body,
    algorithm: 'Ed25519',
    public_key: toBase64(ed.rawPublicKey),
    signature: toBase64(signEd25519(canonicalBytes(body), ed.privateKey)),
  };
}

function timeCall(fn) {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    n: sorted.length,
    minMs: sorted[0],
    medianMs: median,
    meanMs: sum / sorted.length,
    maxMs: sorted[sorted.length - 1],
  };
}

function fmt(label, row) {
  const num = (value) => value.toFixed(3);
  return [
    label,
    'n=' + row.n,
    'min_ms=' + num(row.minMs),
    'median_ms=' + num(row.medianMs),
    'mean_ms=' + num(row.meanMs),
    'max_ms=' + num(row.maxMs),
  ].join(' ');
}

function machineLines() {
  const cpu = cpus()[0];
  return [
    'node: ' + process.version,
    'platform: ' + platform() + ' ' + release() + ' ' + arch(),
    'cpu: ' + (cpu ? cpu.model : 'unknown'),
    'cpu_count: ' + cpus().length,
    'total_mem_bytes: ' + totalmem(),
  ];
}

export function runBench() {
  const lines = [];
  const keygen = [];
  let key = null;
  for (let i = 0; i < 20; i += 1) {
    const timed = timeCall(() => generateCompositeKey({ signerId: 'bench', role: 'operator' }));
    keygen.push(timed.ms);
    key = timed.value;
  }
  lines.push(fmt('composite_keygen', stats(keygen)));
  const signatures = [];
  const signSamples = [];
  for (let i = 0; i < 20; i += 1) {
    const timed = timeCall(() => signComposite(MESSAGE, key, { ctx: CTX }));
    signSamples.push(timed.ms);
    signatures.push(timed.value);
  }
  lines.push(fmt('composite_sign', stats(signSamples)));
  const verifySamples = [];
  for (const signature of signatures) {
    const timed = timeCall(() => verifyComposite(MESSAGE, key.compositePublic, signature, { ctx: CTX }));
    if (!timed.value.ok) throw new Error('BENCH_VERIFY_FAILED');
    verifySamples.push(timed.ms);
  }
  lines.push(fmt('composite_verify', stats(verifySamples)));

  const archiveKey = archiveKeyFromSeed({ signerId: 'bench-archivist', seed: randomBytes(32) });
  for (const count of [1000, 10000]) {
    const built = timeCall(() => Array.from({ length: count }, (_, index) => evidenceRecord(index)));
    lines.push('archive_prepare_records count=' + count + ' ms=' + built.ms.toFixed(3));
    const sealed = timeCall(() => sealArchive(built.value, [archiveKey], {
      batchId: 'bench-' + count,
      signedAt: '2026-11-26T00:00:00.000Z',
    }));
    lines.push('archive_seal count=' + count + ' ms=' + sealed.ms.toFixed(3));
    const checked = timeCall(() => verifyArchive(sealed.value, built.value));
    if (!checked.value.ok) throw new Error('BENCH_ARCHIVE_VERIFY_FAILED:' + count);
    lines.push('archive_verify count=' + count + ' ms=' + checked.ms.toFixed(3));
  }
  return lines;
}

const started = new Date();
let exitCode = 0;
let detail = '';
try {
  detail = runBench().join('\n');
} catch (error) {
  exitCode = 1;
  detail = error && error.message ? error.message : 'BENCH_ERROR';
}
const ended = new Date();
const body = [
  'Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs',
  'Author: Samuel J. Kott',
  'Operator: SK Consulting LLC dba Numina Labs',
  'License: BSD-3-Clause',
  '',
  'command: node scripts/bench.mjs',
  'execPath: ' + process.execPath,
  ...machineLines(),
  'start: ' + started.toISOString(),
  'end: ' + ended.toISOString(),
  'exit_code: ' + exitCode,
  '',
  detail,
  '',
].join('\n');
mkdirSync(path.join(root, 'test-results'), { recursive: true });
writeFileSync(path.join(root, 'test-results', 'bench.txt'), body);
process.stdout.write(body);
process.exit(exitCode);
