/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportCompositeKeyFile } from '../src/keys.mjs';
import { signEnvelope } from '../src/envelope.mjs';
import { blankEnvelope, compositePerson, legacyPerson, policyDocument } from './helpers.mjs';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/seal.mjs');

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
}

test('version and help credit the author and operator', () => {
  const version = run(['--version']);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /Samuel J\. Kott/);
  assert.match(version.stdout, /SK Consulting LLC dba Numina Labs/);
  assert.match(version.stdout, /BSD-3-Clause/);
  assert.match(version.stdout, /@noble\/post-quantum 0\.7\.1/);
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Samuel J\. Kott/);
  assert.match(help.stdout, /SK Consulting LLC dba Numina Labs/);
  assert.match(help.stdout, /--legacy/);
  assert.match(help.stdout, /verdict: legacy/);
});

test('cli legacy flag is required and the verdict stays legacy', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seal-cli-'));
  try {
    const alice = { legacy: legacyPerson('alice'), composite: compositePerson('alice') };
    const signed = signEnvelope(blankEnvelope(), [alice.legacy], { deterministic: true });
    const envelope = path.join(dir, 'envelope.json');
    const policy = path.join(dir, 'policy.json');
    writeFileSync(envelope, JSON.stringify(signed));
    writeFileSync(policy, JSON.stringify(policyDocument({
      phase: 1,
      k: 1,
      legacyCountsFor: ['task-envelope'],
      people: [alice],
    })));
    const refused = run(['verify', '--envelope', envelope, '--policy', policy]);
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /verdict: invalid/);
    assert.match(refused.stdout, /LEGACY_NOT_ACCEPTED/);
    assert.equal(refused.stdout.includes('verdict: legacy'), false);
    const accepted = run(['verify', '--envelope', envelope, '--policy', policy, '--legacy']);
    assert.equal(accepted.status, 0);
    assert.match(accepted.stdout, /verdict: legacy/);
    assert.match(accepted.stdout, /legacy: explicit/);
    assert.match(accepted.stdout, /distinct signers \(people\), not algorithms/);
    const keyPath = path.join(dir, 'key.json');
    const secret = exportCompositeKeyFile(alice.composite);
    writeFileSync(keyPath, JSON.stringify(secret));
    writeFileSync(path.join(dir, 'unsigned.json'), JSON.stringify(blankEnvelope()));
    writeFileSync(path.join(dir, 'composite-policy.json'), JSON.stringify(policyDocument({
      k: 1,
      people: [{ composite: alice.composite }],
    })));
    const out = path.join(dir, 'signed.json');
    const signedCli = run(['sign', '--envelope', path.join(dir, 'unsigned.json'), '--key', keyPath, '--out', out, '--deterministic']);
    assert.equal(signedCli.status, 0, signedCli.stderr);
    const verified = run(['verify', '--envelope', out, '--policy', path.join(dir, 'composite-policy.json')]);
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.match(verified.stdout, /verdict: valid/);
    assert.equal(verified.stdout.includes(secret.mldsaSeed), false);
    assert.equal(verified.stdout.includes(secret.ed25519Seed), false);
    assert.equal(readFileSync(out, 'utf8').includes(secret.mldsaSeed), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
