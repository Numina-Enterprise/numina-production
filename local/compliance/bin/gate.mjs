#!/usr/bin/env node
// Pre-push compliance gate: runs the compliance test suite and the self-check. Exits nonzero on failure.
// Needs no live data and no network (only an optional loopback probe for a local Watchman).
import {spawnSync} from 'node:child_process';
import {readdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {selfCheck} from '../lib/selfcheck.mjs';
import {REPO_ROOT} from '../lib/util.mjs';

const t0 = Date.now();
const testDir = join(REPO_ROOT, 'tests', 'compliance');
const files = existsSync(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(testDir, f)) : [];
console.log(`[compliance:gate] running ${files.length} test files with node --test`);
let testsOk = false;
if (files.length) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], {stdio: 'inherit', cwd: REPO_ROOT,
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NUMINA_COMPLIANCE_')))});
  testsOk = r.status === 0;
  console.log(`[compliance:gate] tests exit code ${r.status}`);
} else console.log('[compliance:gate] FAIL no test files found');

console.log('[compliance:gate] self-check');
const sc = await selfCheck({log: (s) => console.log(`  ${s}`)});
const engine = sc.engineReport;
console.log(`[compliance:gate] screening engine: ${engine.used?.join(' + ') ?? 'none'}${engine.fallback ? ` (${engine.fallback})` : ''}`);
const ok = testsOk && sc.ok;
console.log(`[compliance:gate] ${ok ? 'PASS' : 'FAIL'} (tests ${testsOk ? 'pass' : 'fail'}, self-check ${sc.ok ? 'pass' : 'fail'}) in ${Date.now() - t0} ms`);
process.exit(ok ? 0 : 1);
