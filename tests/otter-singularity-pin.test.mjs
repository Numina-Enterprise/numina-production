import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pinPath = path.join(root, 'docs/protocols/singularity-coordination-model.md');
const bodySha256 = '949d22cb92f40c2c16b6a72850fe0a75bb36434059ac898d42a38b3078c0fc04';
const rootPointer = '**First read:** [Singularity Coordination Model](docs/protocols/singularity-coordination-model.md) is the topmost layer. Read it first each day.';
const cursorPointer = '**First read:** [Singularity Coordination Model](../../docs/protocols/singularity-coordination-model.md) is the topmost layer. Read it first each day.';

function lfText(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function firstLine(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/, 1)[0];
}

test('the first-read body is the authoritative text and the pointers stay first', () => {
  const pin = readFileSync(pinPath);
  const startMarker = Buffer.from('<!-- protocol-body -->\n');
  const endMarker = Buffer.from('<!-- protocol-body-end -->');
  const startAt = pin.indexOf(startMarker);
  assert.notEqual(startAt, -1);
  const bodyStart = startAt + startMarker.length;
  const bodyEnd = pin.indexOf(endMarker, bodyStart);
  assert.notEqual(bodyEnd, -1);
  const body = pin.subarray(bodyStart, bodyEnd);
  assert.equal(createHash('sha256').update(body).digest('hex'), bodySha256);
  assert.equal(body.length, 1674);
  const header = pin.subarray(0, startAt).toString('utf8');
  assert.match(header, /topmost layer/);
  assert.match(header, /Read it first each day/);
  assert.match(header, /Otter Rafting Protocol/);
  assert.match(header, /Singularity Protocol/);
  assert.match(header, /Singularity Coordination Model/);
  assert.match(header, new RegExp(bodySha256));
  assert.equal(firstLine(path.join(root, 'AGENTS.md')), rootPointer);
  assert.equal(firstLine(path.join(root, 'README.md')), rootPointer);
  const cursor = lfText(path.join(root, '.cursor/rules/singularity-coordination-model.mdc'));
  assert.match(cursor, /^---\n[\s\S]*?\nalwaysApply:\s*true\b/);
  const cursorBody = cursor.replace(/^---\n[\s\S]*?\n---\n/, '');
  assert.equal(cursorBody.split('\n').find(line => line.trim().length > 0), cursorPointer);
});

test('latch references still match the current file bytes', () => {
  const pin = lfText(pinPath);
  const block = pin.match(/```otter-pin\n([\s\S]*?)\n```/);
  assert.ok(block, 'latch block missing');
  const record = JSON.parse(block[1]);
  assert.equal(record.mainCommit, '19997551c6c59dfa15ea2b21145b879209b7f1b3');
  assert.equal(record.newline, 'LF');
  const seen = new Set();
  for (const file of record.files) {
    assert.equal(seen.has(file.path), false, file.path);
    seen.add(file.path);
    const digest = createHash('sha256').update(lfText(path.join(root, file.path))).digest('hex');
    assert.equal(digest, file.sha256, file.path);
  }
});
