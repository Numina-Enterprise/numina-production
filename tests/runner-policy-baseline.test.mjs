import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(new URL('../scripts/check-runner-policy.mjs', import.meta.url));

test('baseline: current checker contract strictly asserted', () => {
  const r = spawnSync(process.execPath, [CHECKER], { encoding: 'utf8' });
  assert.equal(r.error, undefined, 'checker failed to launch');
  assert.notEqual(r.status, null, 'checker was killed by a signal');
  assert.equal(r.status, 0, `Expected exit code 0, got ${r.status}`);
  assert.match(
    r.stdout,
    /NUMINA runner policy verified: 36 preserved hosted declarations; self-hosted execution denied; future runners denied\./,
    'stdout did not match expected policy verification string'
  );
  assert.equal(r.stderr, '', `Expected empty stderr, got: ${r.stderr}`);
});
