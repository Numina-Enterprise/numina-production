/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Runs the module test suite and records start time, end time, exit code,
 * stdout, and stderr under test-results/.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const started = new Date();
const child = spawnSync(process.execPath, ['--test', 'test/composite.test.mjs', 'test/governance.test.mjs', 'test/archive.test.mjs', 'test/cli.test.mjs'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
const ended = new Date();
const exitCode = child.status === null ? 1 : child.status;
const body = [
  'Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs',
  'Author: Samuel J. Kott',
  'Operator: SK Consulting LLC dba Numina Labs',
  'License: BSD-3-Clause',
  '',
  'command: node --test test/composite.test.mjs test/governance.test.mjs test/archive.test.mjs test/cli.test.mjs',
  'cwd: ' + root,
  'start: ' + started.toISOString(),
  'end: ' + ended.toISOString(),
  'exit_code: ' + exitCode,
  '',
  '--- stdout ---',
  child.stdout ?? '',
  '--- stderr ---',
  child.stderr ?? '',
].join('\n');
mkdirSync(path.join(root, 'test-results'), { recursive: true });
writeFileSync(path.join(root, 'test-results', 'node-test.txt'), body);
process.stdout.write(body);
process.exit(exitCode);
