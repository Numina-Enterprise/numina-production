import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tempEnv, FIXTURES} from './helpers/env.mjs';
import {fakeIndividual} from '../../local/compliance/lib/synthetic.mjs';
import {parseArgs} from '../../local/compliance/bin/compliance.mjs';

const CLI = fileURLToPath(new URL('../../local/compliance/bin/compliance.mjs', import.meta.url));
const cli = (env, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {env: {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env}, encoding: 'utf8'});
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* not json */ }
  return {code: r.status, out: r.stdout, err: r.stderr, json};
};

test('argument parser', () => {
  assert.deepEqual(parseArgs(['kyc', 'new', '--file', 'a.json', '--html', '--x=1']), {pos: ['kyc', 'new'], flags: {file: 'a.json', html: true, x: '1'}});
});

test('CLI end to end: intake -> screen (built-in fallback) -> manual check -> sign-off -> verify -> packet', () => {
  const t = tempEnv({withLists: true});
  try {
    const intake = join(t.dir, 'intake.json');
    writeFileSync(intake, JSON.stringify(fakeIndividual()));
    let r = cli(t.env, 'kyc', 'new', '--file', intake);
    assert.equal(r.code, 0, r.err);
    const id = r.json.id;
    assert.equal(cli(t.env, 'kyc', 'submit', '--case', id).code, 0);
    r = cli(t.env, 'kyc', 'screen', '--case', id);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.engines.used, ['builtin']);
    assert.match(r.json.engines.fallback, /Watchman not running/);
    assert.equal(r.json.decisions.entity.decision, 'clear');
    assert.ok(r.json.blockers.some((b) => b.includes('sanctions-list-search-tool')));
    // sign-off refuses while the manual cross-check is missing
    r = cli(t.env, 'signoff', '--case', id, '--key', t.keyFile, '--confirm', id);
    assert.equal(r.code, 1);
    assert.match(r.err, /cannot approve/);
    assert.equal(cli(t.env, 'kyc', 'manual-check', '--case', id, '--party', 'entity', '--result', 'no_match', '--note', 'searched OFAC SLS').code, 0);
    // wrong confirmation text -> nothing signed
    r = cli(t.env, 'signoff', '--case', id, '--key', t.keyFile, '--confirm', 'cp_wrong');
    assert.equal(r.code, 1);
    assert.match(r.err, /not confirmed/);
    // no TTY and no --confirm -> refuses
    r = cli(t.env, 'signoff', '--case', id, '--key', t.keyFile);
    assert.equal(r.code, 1);
    assert.match(r.err, /interactive confirmation/);
    r = cli(t.env, 'signoff', '--case', id, '--key', t.keyFile, '--confirm', id);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /# Compliance review packet/, 'full output is shown before signing');
    assert.equal(r.json.status, 'approved');
    assert.equal(r.json.verification, 'VALID');
    r = cli(t.env, 'verify');
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(r.json.audit.valid, true);
    assert.equal(r.json.signoffs[0].valid, true);
    r = cli(t.env, 'packet', '--case', id, '--html');
    assert.equal(r.code, 0, r.err);
    assert.ok(r.json.written.startsWith(t.env.NUMINA_COMPLIANCE_DATA_DIR), 'packets land in the gitignored data dir');
    assert.match(readFileSync(r.json.written, 'utf8'), /VALID/);
    r = cli(t.env, 'kyc', 'list');
    assert.deepEqual(r.json.map((x) => [x.status, x.approved]), [['approved', true]]);
  } finally { t.cleanup(); }
});

test('CLI screen exits 3 on a possible match and 0 when clear; aml exits 3 on high/critical alerts', () => {
  const t = tempEnv({withLists: true});
  try {
    let r = cli(t.env, 'screen', '--name', 'Ivan Testovich Fakeman', '--type', 'individual', '--engine', 'builtin');
    assert.equal(r.code, 3);
    assert.equal(r.json.hits[0].uid, 'SDN:9000001');
    r = cli(t.env, 'screen', '--name', 'Jane Q Example', '--type', 'individual');
    assert.equal(r.code, 0);
    r = cli(t.env, 'aml', '--input', fileURLToPath(new URL('stripe-payments-synthetic.csv', FIXTURES)), '--open-cases');
    assert.equal(r.code, 3, r.err);
    assert.ok(r.json.alerts > 0 && r.json.openedCases.length > 0);
  } finally { t.cleanup(); }
});

test('CLI fails closed without the data key and never writes outside the data dir', () => {
  const t = tempEnv({withLists: true});
  try {
    const r = cli({...t.env, NUMINA_COMPLIANCE_KEY: ''}, 'kyc', 'list');
    assert.equal(r.code, 1);
    assert.match(r.err, /NUMINA_COMPLIANCE_KEY is not set/);
    const k = cli(t.env, 'keygen-data-key');
    assert.equal(Buffer.from(k.out.trim(), 'base64').length, 32);
    assert.ok(!existsSync(join(t.dir, 'data', 'cases', 'x')));
  } finally { t.cleanup(); }
});

test('merchant-scan flags prohibited language and passes clean offering text', () => {
  const t = tempEnv();
  try {
    const clean = join(t.dir, 'offer.md'); writeFileSync(clean, 'Consulting engagements: $1,500 diagnostic; optional $7,500 build.');
    assert.equal(cli(t.env, 'merchant-scan', '--path', clean).code, 0);
    const bad = join(t.dir, 'bad.html'); writeFileSync(bad, '<p>Invest in our <b>initial coin offering</b></p>');
    const r = cli(t.env, 'merchant-scan', '--path', t.dir);
    assert.equal(r.code, 3);
    assert.equal(r.json.source.lastUpdated, '2026-09-22');
  } finally { t.cleanup(); }
});
