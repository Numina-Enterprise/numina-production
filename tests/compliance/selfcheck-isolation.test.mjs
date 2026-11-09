import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selfCheck} from '../../local/compliance/lib/selfcheck.mjs';
import {notPerformed, NotConfiguredIdvProvider, IdvProvider} from '../../local/compliance/lib/idv-provider.mjs';

test('self-check passes on this tree (no network, Watchman probe off)', async () => {
  const r = await selfCheck({probeWatchman: false});
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.ok(r.checks.length >= 9);
});

test('self-check fails if public code imports the local compliance module', async () => {
  const root = mkdtempSync(join(tmpdir(), 'numina-isolation-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'worker.js'), "import {screen} from '../local/compliance/lib/screen.mjs';\n");
    const r = await selfCheck({probeWatchman: false, repoRoot: root});
    const iso = r.checks.find((c) => c.name.startsWith('local-only isolation'));
    assert.equal(iso.ok, false);
    assert.match(iso.error, /src\/worker\.js/);
    assert.equal(r.ok, false);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('data dir is gitignored and the module is not wired into the public build', () => {
  const gi = readFileSync(new URL('../../local/compliance/.gitignore', import.meta.url), 'utf8');
  assert.match(gi, /^data\/$/m);
  assert.match(gi, /\*\.private\.pem/);
});

test('IDV is an explicit stub: never reports verified', async () => {
  const p = new NotConfiguredIdvProvider();
  assert.equal(p.name, 'not_configured');
  assert.equal((await p.start({})).status, 'not_performed');
  assert.equal((await p.result('x')).status, 'not_performed');
  assert.match(notPerformed().note, /licensed IDV provider/);
  await assert.rejects(new IdvProvider().start({}), /not implemented/);
});
