import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WatchmanClient, watchmanUrl, screenWithWatchman} from '../../local/compliance/lib/watchman.mjs';
import {resolveEngines, screenParty} from '../../local/compliance/lib/workflow.mjs';
import {buildIndex} from '../../local/compliance/lib/lists.mjs';
import {loadConfig} from '../../local/compliance/lib/util.mjs';
import {FAKE_LISTS} from '../../local/compliance/lib/synthetic.mjs';
import {readFileSync} from 'node:fs';

const cfg = loadConfig().screening;
const index = buildIndex(FAKE_LISTS, {version: 'TEST', fetchedAt: new Date().toISOString()});

/** Minimal stand-in for Watchman's /v2 API on an ephemeral loopback port (shape from moov-io/watchman v1.2.2). */
async function fakeWatchman({lists = {us_ofac: 6, us_non_sdn: 1}} = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(u);
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/v2/listinfo') return res.end(JSON.stringify({lists, listHashes: {us_ofac: 'a'.repeat(64)}, startedAt: '2026-11-09T15:46:12Z', endedAt: '2026-11-09T15:46:18Z', version: 'v1.2.2'}));
    if (u.pathname === '/v2/search') {
      const name = (u.searchParams.get('name') || '').toLowerCase();
      const entities = name.includes('fakeman') && u.searchParams.get('type') === 'person'
        ? [{name: 'Ivan Testovich FAKEMAN', entityType: 'person', sourceList: 'us_ofac', sourceID: '9000001', match: name.includes('testovich') ? 0.99 : 0.83, person: {birthDate: '1970-01-01T00:00:00Z'}, sanctionsInfo: {programs: ['ZZ-FAKE']}}]
        : null;
      return res.end(JSON.stringify({query: {}, entities}));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = {NUMINA_WATCHMAN_URL: `http://127.0.0.1:${server.address().port}`};
  return {env, seen, close: () => new Promise((r) => server.close(r))};
}

test('Watchman URL must be loopback (or private LAN only with explicit opt-in)', () => {
  assert.equal(watchmanUrl({}), 'http://127.0.0.1:8084');
  assert.equal(watchmanUrl({NUMINA_WATCHMAN_URL: 'http://localhost:8084'}), 'http://localhost:8084');
  assert.throws(() => watchmanUrl({NUMINA_WATCHMAN_URL: 'https://watchman.example.com'}), /only loopback/);
  assert.throws(() => watchmanUrl({NUMINA_WATCHMAN_URL: 'http://192.168.1.20:8084'}), /only loopback/);
  assert.equal(watchmanUrl({NUMINA_WATCHMAN_URL: 'http://192.168.1.20:8084', NUMINA_WATCHMAN_ALLOW_LAN: '1'}), 'http://192.168.1.20:8084');
  assert.throws(() => watchmanUrl({NUMINA_WATCHMAN_URL: 'http://8.8.8.8:8084', NUMINA_WATCHMAN_ALLOW_LAN: '1'}), /only loopback/);
});

test('Watchman client: health, typed search with DOB, scored hits recorded with list hashes', async () => {
  const w = await fakeWatchman();
  try {
    const client = new WatchmanClient({env: w.env});
    const h = await client.health();
    assert.equal(h.ok, true);
    assert.deepEqual(h.lists, {us_ofac: 6, us_non_sdn: 1});
    const r = await screenWithWatchman(client, 'Ivan Testovich Fakeman', {type: 'individual', dob: '1970-01-01'}, {config: cfg, info: h});
    const q = w.seen.find((u) => u.pathname === '/v2/search');
    assert.equal(q.searchParams.get('type'), 'person');
    assert.equal(q.searchParams.get('birthDate'), '1970-01-01');
    assert.equal(q.searchParams.get('minMatch'), String(cfg.watchman_min_match));
    assert.equal(r.engine, 'watchman');
    assert.equal(r.decision, 'potential_match');
    assert.deepEqual(r.hits[0], {...r.hits[0], uid: 'us_ofac:9000001', score: 0.99, programs: ['ZZ-FAKE'], dobYears: [1970]});
    assert.match(r.listVersion, /^watchman:us_ofac=aaaaaaaaaaaa/);
    const lower = await screenWithWatchman(client, 'Ivan Fakeman', {type: 'individual'}, {config: cfg, info: h});
    assert.equal(lower.decision, 'review');
    const none = await screenWithWatchman(client, 'Jane Q Example', {type: 'individual'}, {config: cfg, info: h});
    assert.equal(none.decision, 'clear');
    await screenWithWatchman(client, 'Fakeco Consulting LLC', {type: 'business'}, {config: cfg, info: h});
    assert.ok(w.seen.some((u) => u.searchParams.get('type') === 'organization'), 'businesses also searched in the organization partition');
  } finally { await w.close(); }
});

test('engine selection: Watchman + built-in when both are available; merged worst-case decision', async () => {
  const w = await fakeWatchman();
  try {
    const e = await resolveEngines({engine: 'auto', env: w.env, index});
    assert.deepEqual(e.report.used, ['watchman', 'builtin']);
    assert.equal(e.report.watchman.status, 'running');
    const r = await screenParty({name: 'Ivan Fakeman', type: 'individual', role: 'counterparty'}, e, {config: cfg});
    assert.equal(r.engine, 'watchman+builtin');
    assert.ok(r.hits.some((h) => h.engine === 'watchman') && r.hits.some((h) => h.engine === 'builtin'));
    assert.equal(r.autoAccept, false);
  } finally { await w.close(); }
});

test('fallback to the built-in fuzzy matcher when Watchman is not running (reported)', async () => {
  const e = await resolveEngines({engine: 'auto', env: {NUMINA_WATCHMAN_URL: 'http://127.0.0.1:9'}, index});
  assert.deepEqual(e.report.used, ['builtin']);
  assert.equal(e.report.watchman.status, 'unavailable');
  assert.match(e.report.fallback, /built-in fuzzy matcher/);
  const r = await screenParty({name: 'Ivan Fakeman', type: 'individual', role: 'counterparty'}, e, {config: cfg});
  assert.equal(r.engine, 'builtin');
  await assert.rejects(resolveEngines({engine: 'watchman', env: {NUMINA_WATCHMAN_URL: 'http://127.0.0.1:9'}, index}), /Watchman requested but unavailable/);
  await assert.rejects(resolveEngines({engine: 'auto', env: {NUMINA_WATCHMAN_URL: 'http://127.0.0.1:9', NUMINA_COMPLIANCE_DATA_DIR: '/nonexistent-numina-test'}}), /No screening engine available/);
});

test('Watchman up but lists not loaded counts as unavailable', async () => {
  const w = await fakeWatchman({lists: {}});
  try {
    const e = await resolveEngines({engine: 'auto', env: w.env, index});
    assert.deepEqual(e.report.used, ['builtin']);
    assert.match(e.report.watchman.error, /no lists are loaded/);
  } finally { await w.close(); }
});

test('shipped Watchman config binds to loopback, loads free government lists only, no OpenSanctions', () => {
  const yml = readFileSync(new URL('../../local/compliance/watchman/watchman.yml', import.meta.url), 'utf8');
  assert.match(yml, /BindAddress: "127\.0\.0\.1:8084"/);
  assert.match(yml, /AdminAddress: "127\.0\.0\.1:9094"/);
  for (const l of ['us_ofac', 'us_non_sdn', 'us_csl', 'us_fincen_311', 'uk_csl', 'eu_csl', 'un_csl']) assert.ok(yml.includes(`"${l}"`), l);
  const active = yml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.ok(!/opensanctions|senzing|yente/i.test(active), 'no OpenSanctions/yente configuration');
  const compose = readFileSync(new URL('../../local/compliance/watchman/docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /"127\.0\.0\.1:8084:8084"/);
  assert.ok(!/"8084:8084"|- 8084:8084/.test(compose.replace('"127.0.0.1:8084:8084"', '')), 'no all-interfaces port binding');
});
