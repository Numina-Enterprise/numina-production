import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, readdirSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {encryptJson, decryptJson, parseKey, generateKey, keyId} from '../../local/compliance/lib/crypto-store.mjs';
import {CaseStore, TRANSITIONS} from '../../local/compliance/lib/store.mjs';
import {verifyAudit, readAudit, appendAudit} from '../../local/compliance/lib/audit.mjs';
import {tempEnv} from './helpers/env.mjs';
import {fakeIndividual} from '../../local/compliance/lib/synthetic.mjs';

test('AES-256-GCM round-trip; wrong key, wrong AAD and tampering all fail', () => {
  const key = randomBytes(32);
  const env = encryptJson({a: 1, name: 'John Q Placeholder'}, key, 'cp_0000000000000000');
  assert.equal(env.alg, 'AES-256-GCM');
  assert.ok(!JSON.stringify(env).includes('Placeholder'));
  assert.deepEqual(decryptJson(env, key), {a: 1, name: 'John Q Placeholder'});
  assert.throws(() => decryptJson(env, randomBytes(32)), /different key/);
  assert.throws(() => decryptJson(env, key, 'cp_1111111111111111'));
  const ct = Buffer.from(env.ct, 'base64'); ct[0] ^= 1;
  assert.throws(() => decryptJson({...env, ct: ct.toString('base64')}, key));
  assert.notEqual(encryptJson({a: 1}, key).iv, encryptJson({a: 1}, key).iv, 'fresh IV per record');
});

test('data key parsing from env (base64 or hex), with clear errors', () => {
  const b64 = generateKey();
  assert.equal(parseKey(b64).length, 32);
  assert.equal(parseKey('ab'.repeat(32)).length, 32);
  assert.throws(() => parseKey(''), /NUMINA_COMPLIANCE_KEY is not set/);
  assert.throws(() => parseKey('short'), /32 bytes/);
  assert.equal(keyId(parseKey(b64)).length, 16);
});

test('records are encrypted at rest in the data dir and a swapped file is rejected', () => {
  const t = tempEnv();
  try {
    const s = t.store();
    const a = s.create('counterparty', {counterparty: fakeIndividual()});
    const b = s.create('counterparty', {counterparty: fakeIndividual({legalName: 'Other Placeholder'})});
    const dir = join(t.env.NUMINA_COMPLIANCE_DATA_DIR, 'cases');
    for (const f of readdirSync(dir)) assert.ok(!readFileSync(join(dir, f), 'utf8').includes('Placeholder'), 'plaintext PII on disk');
    assert.equal(s.get(a.id).counterparty.legalName, 'John Q Placeholder');
    renameSync(join(dir, `${b.id}.json.enc`), join(dir, 'tmp'));
    writeFileSync(join(dir, `${b.id}.json.enc`), readFileSync(join(dir, `${a.id}.json.enc`)));
    assert.throws(() => s.get(b.id), /AAD mismatch/);
    assert.throws(() => s.get('../etc/passwd'), /invalid case id/);
    const other = new CaseStore({env: {...t.env, NUMINA_COMPLIANCE_KEY: generateKey()}});
    assert.throws(() => other.get(a.id), /different key/);
  } finally { t.cleanup(); }
});

test('state machine: legal paths, illegal jumps, and approval only with a sign-off', () => {
  const t = tempEnv();
  try {
    const s = t.store();
    const c = s.create('counterparty', {counterparty: fakeIndividual()});
    assert.equal(c.status, 'draft');
    assert.throws(() => s.transition(c, 'approved'), /illegal transition/);
    assert.throws(() => s.transition(c, 'screening'), /illegal transition/);
    s.transition(c, 'submitted'); s.transition(c, 'screening'); s.transition(c, 'needs_review');
    assert.throws(() => s.transition(c, 'approved'), /requires a human sign-off/);
    assert.throws(() => s.transition(c, 'approved', {signoff: {payload: {}, signature: 'AA=='}}), /sign-off rejected/);
    s.transition(c, 'draft');
    s.transition(c, 'rejected');
    assert.throws(() => s.transition(c, 'draft'), /illegal transition/, 'rejected is terminal');
    assert.deepEqual(Object.keys(TRANSITIONS.counterparty), ['draft', 'submitted', 'screening', 'needs_review', 'approved', 'rejected']);
    const p = s.create('payment', {payments: []});
    assert.equal(p.status, 'needs_review');
    assert.throws(() => s.transition(p, 'cleared'), /requires a human sign-off/);
    assert.throws(() => s.transition(p, 'approved'), /illegal transition/);
  } finally { t.cleanup(); }
});

test('audit log is append-only, hash-chained, PII-free, and edits are detected', () => {
  const t = tempEnv();
  try {
    const s = t.store();
    const c = s.create('counterparty', {counterparty: fakeIndividual()});
    s.transition(c, 'submitted', {reason: 'contains no pii'});
    const entries = readAudit(t.env);
    assert.equal(entries.length, 2);
    assert.equal(entries[1].prev, entries[0].hash);
    assert.ok(!JSON.stringify(entries).includes('Placeholder'));
    assert.ok(entries[1].reasonSha256 && !('reason' in entries[1]));
    assert.throws(() => appendAudit({caseId: c.id, legalName: 'x'}, t.env), /PII-like/);
    assert.equal(verifyAudit(t.env).valid, true);
    const p = join(t.env.NUMINA_COMPLIANCE_DATA_DIR, 'audit.log.jsonl');
    const lines = readFileSync(p, 'utf8').trim().split('\n');
    writeFileSync(p, lines[0].replace('"created"', '"deleted"') + '\n' + lines[1] + '\n');
    const v = verifyAudit(t.env);
    assert.equal(v.valid, false);
    assert.match(v.problems.join(), /hash mismatch|broken chain/);
    writeFileSync(p, lines[1] + '\n');
    assert.equal(verifyAudit(t.env).valid, false, 'deleting an entry breaks the chain');
  } finally { t.cleanup(); }
});
