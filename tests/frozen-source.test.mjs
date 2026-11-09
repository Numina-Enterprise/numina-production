import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyFrozenFiles} from '../scripts/verify-frozen-source.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
test('frozen source remains hash checked when historical cache files are absent', t => {
  const root = mkdtempSync(join(tmpdir(), 'numina-frozen-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  mkdirSync(join(root,'core'));
  writeFileSync(join(root,'core/main.py'),'preserved source\n');
  const entries = [{path:'core/main.py',sha256:hash('preserved source\n')},{path:'core/.pytest_cache/v/cache/nodeids',sha256:hash('historical cache')}];
  assert.deepEqual(verifyFrozenFiles(root,entries), {verifiedFiles:1, expectedFiles:2, missingCacheFiles:['core/.pytest_cache/v/cache/nodeids'], complete:false});
  writeFileSync(join(root,'core/main.py'),'tampered source\n');
  assert.throws(() => verifyFrozenFiles(root,entries), /Frozen core bytes differ/);
  assert.throws(() => verifyFrozenFiles(root,[{path:'core/missing.py',sha256:hash('source')}]), /ENOENT/);
  assert.throws(() => verifyFrozenFiles(root,[{path:'../outside',sha256:hash('source')}]), /Invalid frozen source path/);
});

test('a present historical cache file must match its original digest', t => {
  const root = mkdtempSync(join(tmpdir(), 'numina-frozen-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  mkdirSync(join(root,'core/.pytest_cache'), {recursive:true});
  writeFileSync(join(root,'core/.pytest_cache/README.md'),'altered');
  assert.throws(() => verifyFrozenFiles(root,[{path:'core/.pytest_cache/README.md',sha256:hash('original')}]), /Frozen core bytes differ/);
});
