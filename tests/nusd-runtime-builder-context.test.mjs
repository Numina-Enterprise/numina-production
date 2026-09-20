import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/numina-nusd-runtime-builder.yml', import.meta.url), 'utf8');

test('NUSD runtime builder stages only the reviewed context while tolerating unrelated reviewed source files', () => {
  assert.match(workflow, /expected = \[/);
  assert.match(workflow, /missing = sorted\(set\(expected\) - set\(actual\)\)/);
  assert.match(workflow, /if missing:/);
  assert.match(workflow, /for relative in sorted\(expected\):/);

  assert.doesNotMatch(workflow, /sorted\(actual\) != sorted\(expected\)/);
  assert.match(workflow, /stat\.S_ISLNK\(mode\)/);
  assert.match(workflow, /Runtime source contains a link or special file/);
});
