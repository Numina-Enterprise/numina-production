import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const json = path => JSON.parse(read(path));
const records = [
  'public/final-build.json', 'docs/NUMINA-FINAL-BUILD.json',
  'release-evidence/numina-final-build-2026-09-18.json',
  'docs/delivery-observation-2026-09-18.json',
  'release-evidence/delivery-observation-2026-09-18.json',
  'docs/native-package-record-v4.json',
  'runtime/vercel-production/public/downloads/native-package-record-v4.json',
  'release-evidence/native-signing-attempt-2026-09-18T2110.json'
];

test('release metadata omits account-payment and spending-limit wording', () => {
  for (const path of records) {
    assert.doesNotMatch(read(path), /account payments|spending[ _-]?limit|runner[ _-]?billing|billing[ _-]?block/i, path);
    assert.ok(json(path));
  }
});

test('signing attempts retain their actual job outcomes and absent artifacts', () => {
  const attempt = json(records[7]);
  assert.equal(attempt.sourceCommit, '885b0b7c253907989dd3c17dd777f36e7c94cdab');
  assert.equal(attempt.android.runId, 35395347752);
  assert.equal(attempt.ios.runId, 35395350460);
  for (const platform of ['android', 'ios']) {
    assert.equal(attempt[platform].status, 'completed');
    assert.equal(attempt[platform].conclusion, 'failure');
    assert.equal(attempt[platform].runnerId, 0);
    assert.equal(attempt[platform].executedSteps, 0);
    assert.deepEqual(attempt[platform].artifacts, []);
  }
  assert.equal(attempt.nativeCompilationPerformed, false);
  assert.equal(attempt.signingPerformed, false);
  assert.equal(attempt.storeSubmissionPerformed, false);
});

test('native binary and source archive hashes still match their recorded bytes', () => {
  const record = json('docs/native-package-record-v4.json');
  assert.equal(record.finalBuild.status, 'SIGNING_PENDING');
  assert.equal(record.finalBuild.androidSignedArtifactReceipt, null);
  assert.equal(record.finalBuild.iosSignedArtifactReceipt, null);
  for (const item of [...record.android.binaries, ...record.ios.binaries, ...record.sourceArchives]) {
    const data = readFileSync(new URL('../docs/' + item.file, import.meta.url));
    assert.equal(data.length, item.bytes, item.file);
    assert.equal(createHash('sha256').update(data).digest('hex'), item.sha256, item.file);
  }
  assert.deepEqual(record, json('runtime/vercel-production/public/downloads/native-package-record-v4.json'));
  assert.deepEqual(json('public/final-build.json'), json('docs/NUMINA-FINAL-BUILD.json'));
  // Dated release evidence is historical; only the current documentation projection follows FINAL.
  assert.equal(json('release-evidence/numina-final-build-2026-09-18.json').applicationVersion, '4.0.0');
});
