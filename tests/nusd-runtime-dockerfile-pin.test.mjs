import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const dockerfile = readFileSync(new URL('../runtime/nusd/Dockerfile', import.meta.url));
const workflow = readFileSync(new URL('../.github/workflows/numina-nusd-runtime-builder.yml', import.meta.url), 'utf8');

test('NUSD runtime builder pins the exact reviewed Dockerfile bytes', () => {
  const digest = createHash('sha256').update(dockerfile).digest('hex');
  assert.equal(digest, 'bc3a0106fff1fd4ded14c827cb5a2898df41ecf798c5c4ea6c29b52faa4ccfb2');
  assert.match(workflow, new RegExp("Dockerfile'\\)\\.read_bytes\\(\\)\\)\\.hexdigest\\(\\) != '" + digest + "'"));
});
