import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIndex, parseRemarks, loadIndex, updateLists, OFAC_FILES, OFAC_BASE} from '../../local/compliance/lib/lists.mjs';
import {screen} from '../../local/compliance/lib/screen.mjs';
import {loadConfig} from '../../local/compliance/lib/util.mjs';
import {FAKE_LISTS} from '../../local/compliance/lib/synthetic.mjs';
import {tempEnv} from './helpers/env.mjs';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const cfg = loadConfig().screening;
const index = buildIndex(FAKE_LISTS, {version: 'TEST', fetchedAt: new Date().toISOString()});
const run = (name, opts = {}) => screen(name, opts, {index, config: cfg});

test('index parses SDN + consolidated entries, programs, aliases, addresses and remarks', () => {
  assert.equal(index.entries.length, 6);
  const e = index.byUid.get('SDN:9000001');
  assert.deepEqual(e.programs, ['ZZ-TEST', 'ZZ-FAKE']);
  assert.equal(e.type, 'individual');
  assert.deepEqual(e.dobYears, [1970]);
  assert.ok(e.countries.includes('RU'));
  assert.deepEqual(e.ids, [{type: 'Passport', number: 'ZZ1234567'}]);
  assert.deepEqual(e.aliases.map((a) => [a.name, a.kind]), [['TESTY', 'weak'], ['FEYKMAN, Ivan', 'aka']]);
  assert.equal(index.byUid.get('SDN:9000002').type, 'entity');
  assert.ok(index.byUid.get('SDN:9000002').countries.includes('RU'));
  assert.equal(index.byUid.get('SDN:9000005').type, 'vessel');
  assert.equal(index.byUid.get('CONS:9100001').source, 'CONS');
});

test('remarks parser extracts DOB ranges, nationality, IDs, weak a.k.a.s and gender', () => {
  const r = parseRemarks("DOB 1955 to 1957; POB Testgrad, Iran; nationality Iran; National ID No. 123-ZZ-45 (Iran); Gender Male; a.k.a. 'ZEDDY'.");
  assert.deepEqual(r.dobYears.sort(), [1955, 1956, 1957]);
  assert.deepEqual(r.countries, ['IR']);
  assert.deepEqual(r.ids, [{type: 'National ID No.', number: '123ZZ45'}]);
  assert.deepEqual(r.weakAliases, ['ZEDDY']);
  assert.equal(r.gender, 'male');
});

test('exact match on primary name -> potential_match with uid, programs and list version', () => {
  const r = run('Ivan Testovich Fakeman', {type: 'individual'});
  assert.equal(r.decision, 'potential_match');
  assert.equal(r.autoAccept, false);
  const h = r.hits[0];
  assert.equal(h.uid, 'SDN:9000001');
  assert.equal(h.entNum, 9000001);
  assert.equal(h.score, 1);
  assert.deepEqual(h.programs, ['ZZ-TEST', 'ZZ-FAKE']);
  assert.equal(r.listVersion, 'TEST');
});

test('alias (aka / fka) matches, including transliterated and diacritic forms', () => {
  assert.equal(run('Ivan Feykman', {type: 'individual'}).hits[0].matchedName, 'FEYKMAN, Ivan');
  assert.equal(run('Иван Фейкман', {type: 'individual'}).hits[0].uid, 'SDN:9000001');
  assert.equal(run('ZZFAKE IMPEX', {type: 'business'}).hits[0].uid, 'SDN:9000002');
  assert.equal(run('Jörg Müllerfake', {type: 'individual'}).hits[0].uid, 'SDN:9000004');
  assert.equal(run('Joerg Muellerfake').hits[0].uid, 'SDN:9000004');
});

test('company suffix and word-order variants still match the entity', () => {
  for (const n of ['Zzfake Trading LLC', 'ZZFAKE TRADING GMBH', 'Trading Zzfake Ltd']) assert.equal(run(n, {type: 'business'}).hits[0]?.uid, 'SDN:9000002', n);
});

test('fuzzy spelling variants go to review; unrelated names are clear', () => {
  const r = run('Ivan Fakemann', {type: 'individual'});
  assert.ok(['review', 'potential_match'].includes(r.decision));
  assert.ok(r.hits[0].score >= cfg.review_threshold && r.hits[0].score < 1);
  for (const n of ['John Q Placeholder', 'Fakeco Consulting LLC', 'Jane Q Example', 'Numina Labs']) assert.equal(run(n).decision, 'clear', n);
});

test('weak aliases never block: an exact weak a.k.a. is capped into manual review', () => {
  const r = run('Testy', {type: 'individual'});
  assert.equal(r.decision, 'review');
  assert.equal(r.hits[0].matchedKind, 'weak');
  assert.equal(r.hits[0].score, cfg.weak_alias_cap);
  assert.equal(run('Testi', {type: 'individual'}).hits.filter((h) => h.matchedKind === 'weak').length, 0, 'fuzzy weak alias ignored');
});

test('DOB and country corroboration discount look-alikes but an exact name never drops below review', () => {
  const fuzzy = run('Ivan Fakeman', {type: 'individual', dob: '1990-01-01', country: 'US'});
  assert.equal(fuzzy.decision, 'clear');
  assert.equal(fuzzy.discounted[0].uid, 'SDN:9000001');
  assert.ok(fuzzy.discounted[0].factors.some((f) => f.factor === 'dob_year_mismatch'));
  const exact = run('Ivan Testovich Fakeman', {type: 'individual', dob: '1990-01-01', country: 'US'});
  assert.equal(exact.decision, 'review');
  const sdn = exact.hits.find((h) => h.uid === 'SDN:9000001');
  assert.equal(sdn.score, cfg.review_threshold);
  assert.ok(sdn.factors.some((f) => f.factor === 'exact_name_floor'));
  const corroborated = run('Ivan Fakemann', {type: 'individual', dob: '1970-01-01', country: 'RU'});
  assert.ok(corroborated.hits[0].factors.some((f) => f.factor === 'dob_year_match'));
  assert.ok(corroborated.hits[0].factors.some((f) => f.factor === 'country_match'));
});

test('type mismatch lowers the score; an ID match forces 1.0', () => {
  const t = run('Zzfake Trading', {type: 'individual'});
  assert.ok(!t.hits.length || t.hits[0].factors.some((f) => f.factor === 'type_mismatch'));
  const id = run('I Fakeman', {type: 'individual', ids: [{type: 'passport', number: 'zz-1234567'}]});
  assert.equal(id.hits[0].score, 1);
  assert.equal(id.decision, 'potential_match');
});

test('consolidated non-SDN list is screened', () => {
  const r = run('Fakeia Testova', {type: 'individual'});
  assert.equal(r.hits[0].uid, 'CONS:9100001');
  assert.equal(r.hits[0].source, 'CONS');
});

test('thresholds are configurable; nothing is ever auto-accepted', () => {
  const strict = screen('Ivan Fakemann', {type: 'individual'}, {index, config: {...cfg, review_threshold: 0.99, block_threshold: 0.995}});
  assert.equal(strict.decision, 'clear');
  const loose = screen('Ivan Fakemann', {type: 'individual'}, {index, config: {...cfg, block_threshold: 0.88}});
  assert.equal(loose.decision, 'potential_match');
  assert.ok([run('Ivan Fakeman'), run('nobody at all')].every((r) => r.autoAccept === false));
  assert.equal(run('...').decision, 'review', 'an empty normalized name is not cleared');
});

test('stale list produces a warning', () => {
  const old = buildIndex(FAKE_LISTS, {version: 'OLD', fetchedAt: '2020-01-01T00:00:00Z'});
  assert.ok(screen('x y', {}, {index: old, config: cfg}).warnings.includes('list_stale'));
});

test('update-sdn downloads all six official files with sha256 + fetched-at (fake fetch, no network)', async () => {
  const t = tempEnv();
  try {
    const roleText = {'SDN.CSV': FAKE_LISTS.SDN.primary, 'ALT.CSV': FAKE_LISTS.SDN.alt, 'ADD.CSV': FAKE_LISTS.SDN.address, 'CONS_PRIM.CSV': FAKE_LISTS.CONS.primary, 'CONS_ALT.CSV': FAKE_LISTS.CONS.alt, 'CONS_ADD.CSV': FAKE_LISTS.CONS.address};
    const seen = [];
    const fetchImpl = async (url) => { seen.push(url); const f = url.split('/').pop(); return {ok: true, status: 200, url: `https://example.invalid/Published/x/2026-11-05/y/${f}`, headers: new Headers({'last-modified': 'Thu, 05 Nov 2026 19:00:00 GMT'}), arrayBuffer: async () => new TextEncoder().encode(roleText[f]).buffer}; };
    const m = await updateLists({env: t.env, fetchImpl, minPrimaryRows: 1, now: () => new Date('2026-11-09T15:00:00Z')});
    assert.deepEqual(seen, OFAC_FILES.map((f) => OFAC_BASE + f.file));
    assert.ok(OFAC_BASE.startsWith('https://sanctionslistservice.ofac.treas.gov/'));
    assert.equal(m.fetchedAt, '2026-11-09T15:00:00.000Z');
    assert.equal(m.publicationDate, '2026-11-05');
    assert.match(m.version, /^OFAC@2026-11-05#[0-9a-f]{12}$/);
    assert.ok(m.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
    const idx = loadIndex({env: t.env});
    assert.equal(idx.entries.length, 6);
    // tampering with a stored file is detected
    const p = join(t.env.NUMINA_COMPLIANCE_DATA_DIR, 'lists', 'SDN.CSV');
    writeFileSync(p, readFileSync(p, 'utf8') + '9999999,"X",individual,"Z",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- \n');
    assert.throws(() => loadIndex({env: t.env}), /sha256 mismatch/);
  } finally { t.cleanup(); }
});

test('update-sdn refuses a truncated or failed download and keeps the old files', async () => {
  const t = tempEnv();
  try {
    await assert.rejects(updateLists({env: t.env, fetchImpl: async () => ({ok: false, status: 503})}), /HTTP 503/);
    await assert.rejects(updateLists({env: t.env, minPrimaryRows: 100, fetchImpl: async () => ({ok: true, status: 200, url: '', headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode(FAKE_LISTS.SDN.primary).buffer})}), /refusing to replace/);
    assert.throws(() => loadIndex({env: t.env}), /compliance:update-sdn/);
  } finally { t.cleanup(); }
});
