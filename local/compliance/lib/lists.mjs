// OFAC list download, storage and parsing (SDN list + consolidated non-SDN lists).
// Files live only in the gitignored data dir; nothing here is committed or published.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, existsSync, renameSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {parseCsv} from './csv.mjs';
import {normalizeName} from './normalize.mjs';
import {countryCodeFromText} from './countries.mjs';
import {dataDir, ensureDir, sha256Hex} from './util.mjs';

export const OFAC_BASE = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/';
export const OFAC_FILES = [
  {source: 'SDN', role: 'primary', file: 'SDN.CSV'},
  {source: 'SDN', role: 'alt', file: 'ALT.CSV'},
  {source: 'SDN', role: 'address', file: 'ADD.CSV'},
  {source: 'CONS', role: 'primary', file: 'CONS_PRIM.CSV'},
  {source: 'CONS', role: 'alt', file: 'CONS_ALT.CSV'},
  {source: 'CONS', role: 'address', file: 'CONS_ADD.CSV'},
];

export const listsDir = (env) => join(dataDir(env), 'lists');

/**
 * Download every OFAC file into <data>/lists with sha256 + fetched-at metadata.
 * `fetchImpl` is injectable so tests never touch the network.
 */
export async function updateLists({env = process.env, fetchImpl = globalThis.fetch, base = OFAC_BASE, minPrimaryRows = 100, now = () => new Date(), log = () => {}} = {}) {
  const dir = ensureDir(listsDir(env));
  const fetchedAt = now().toISOString();
  const files = [];
  const staged = [];
  try {
    for (const f of OFAC_FILES) {
      const url = base + f.file;
      log(`GET ${url}`);
      const res = await fetchImpl(url, {redirect: 'follow', headers: {'User-Agent': 'numina-local-compliance/1 (+screening aid)'}});
      if (!res.ok) throw new Error(`${f.file}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const text = buf.toString('utf8');
      const rows = parseCsv(text);
      if (f.role === 'primary' && rows.length < minPrimaryRows) throw new Error(`${f.file}: only ${rows.length} rows, refusing to replace list`);
      if (rows.length && rows[0].length < (f.role === 'primary' ? 12 : f.role === 'alt' ? 5 : 6)) throw new Error(`${f.file}: unexpected column count ${rows[0].length}`);
      const tmp = join(dir, `${f.file}.tmp`);
      writeFileSync(tmp, buf);
      staged.push([tmp, join(dir, f.file)]);
      const finalUrl = res.url || url;
      const pub = /\/(\d{4}-\d{2}-\d{2})\//.exec(finalUrl)?.[1] ?? null;
      files.push({...f, url, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, rows: rows.length,
        lastModified: res.headers?.get?.('last-modified') ?? null, publicationDate: pub});
    }
  } catch (e) {
    for (const [tmp] of staged) rmSync(tmp, {force: true});
    throw e;
  }
  for (const [tmp, final] of staged) renameSync(tmp, final);
  const publicationDate = files.map((f) => f.publicationDate).filter(Boolean).sort().at(-1) ?? null;
  const manifest = {
    schema: 'numina.compliance.lists/v1', fetchedAt, publicationDate, files,
    version: `OFAC@${publicationDate ?? fetchedAt.slice(0, 10)}#${sha256Hex(files.map((f) => f.sha256).join(':')).slice(0, 12)}`,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

const nil = (v) => { const s = String(v ?? '').trim(); return s === '-0-' || s === '' ? null : s; };

const ID_PATTERN = /\b(Passport|National ID No\.|Cedula No\.|Identification Number|Tax ID No\.|Registration ID|Registration Number|Business Registration Number|Company Number|Personal ID Card|Residency Number|D\.N\.I\.|NIT #|RFC|C\.U\.R\.P\.|Driver's License No\.|SSN|Birth Certificate Number|Vessel Registration Identification|IMO|MMSI)\s+([A-Z0-9][A-Z0-9\-\/.]*[A-Z0-9])/gi;

export const normalizeId = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Pull DOBs, places, nationalities, IDs and weak a.k.a.s out of OFAC remarks text. */
export function parseRemarks(remarks) {
  const r = String(remarks ?? '');
  const out = {dobs: [], dobYears: [], countries: [], ids: [], weakAliases: [], gender: null};
  for (const m of r.matchAll(/\bDOB\s+([^;]+)/g)) {
    out.dobs.push(m[1].trim().replace(/\.$/, ''));
    for (const y of m[1].matchAll(/\b(1[89]\d{2}|20\d{2})\b/g)) out.dobYears.push(Number(y[1]));
    const range = /\b(\d{4})\s+to\s+(\d{4})\b/.exec(m[1]);
    if (range) for (let y = Number(range[1]); y <= Number(range[2]) && y - Number(range[1]) < 20; y++) out.dobYears.push(y);
  }
  for (const m of r.matchAll(/\b(?:nationality|citizen|POB)\s+([^;]+)/gi)) {
    const text = m[1].trim().replace(/\.$/, '');
    const last = text.split(',').map((x) => x.trim()).filter(Boolean);
    const code = countryCodeFromText(text) ?? countryCodeFromText(last.at(-1)) ?? countryCodeFromText(last.slice(-2).join(', '));
    if (code) out.countries.push(code);
  }
  for (const m of r.matchAll(ID_PATTERN)) out.ids.push({type: m[1], number: normalizeId(m[2])});
  for (const m of r.matchAll(/a\.k\.a\.\s+'([^']+)'/g)) out.weakAliases.push(m[1].trim());
  const g = /\bGender\s+(Male|Female)\b/i.exec(r);
  if (g) out.gender = g[1].toLowerCase();
  out.dobYears = [...new Set(out.dobYears)];
  out.countries = [...new Set(out.countries)];
  return out;
}

const splitPrograms = (p) => (nil(p) ? p.replace(/^\[|\]$/g, '').split(/\]\s*\[/).map((x) => x.replace(/[[\]]/g, '').trim()).filter(Boolean) : []);
const entryType = (t) => { const s = (nil(t) || '').toLowerCase(); return s === 'individual' ? 'individual' : s === 'vessel' ? 'vessel' : s === 'aircraft' ? 'aircraft' : 'entity'; };

/** Build an in-memory index from raw CSV texts: {SDN:{primary,alt,address}, CONS:{...}}. */
export function buildIndex(texts, meta = {}) {
  const entries = [];
  const byUid = new Map();
  for (const source of ['SDN', 'CONS']) {
    const t = texts[source];
    if (!t?.primary) continue;
    for (const r of parseCsv(t.primary)) {
      if (r.length < 2 || !/^\d+$/.test(r[0].trim())) continue;
      const remarks = nil(r[11]);
      const parsed = parseRemarks(remarks);
      const e = {
        uid: `${source}:${r[0].trim()}`, source, entNum: Number(r[0]), name: nil(r[1]), type: entryType(r[2]), programs: splitPrograms(r[3]),
        title: nil(r[4]), callSign: nil(r[5]), vesselFlag: nil(r[9]), remarks,
        aliases: parsed.weakAliases.map((name) => ({name, kind: 'weak', altType: 'aka'})),
        addresses: [], countries: new Set(parsed.countries), dobs: parsed.dobs, dobYears: parsed.dobYears, ids: parsed.ids, gender: parsed.gender,
      };
      entries.push(e); byUid.set(e.uid, e);
    }
    for (const r of parseCsv(t.alt || '')) {
      const e = byUid.get(`${source}:${String(r[0]).trim()}`);
      const name = nil(r[3]);
      if (!e || !name) continue;
      const altRemarks = nil(r[4]) || '';
      e.aliases.push({name, kind: /weak|low quality/i.test(altRemarks) ? 'weak' : 'aka', altType: (nil(r[2]) || 'aka').toLowerCase()});
    }
    for (const r of parseCsv(t.address || '')) {
      const e = byUid.get(`${source}:${String(r[0]).trim()}`);
      if (!e) continue;
      const country = nil(r[4]);
      const code = country ? countryCodeFromText(country) : null;
      e.addresses.push({address: nil(r[2]), cityStatePostal: nil(r[3]), country, countryCode: code});
      if (code) e.countries.add(code);
    }
  }
  const names = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const nameType = e.type === 'individual' ? 'individual' : 'entity';
    if (e.name) names.push({i, name: e.name, kind: 'primary', norm: normalizeName(e.name, {type: nameType})});
    for (const a of e.aliases) names.push({i, name: a.name, kind: a.kind, norm: normalizeName(a.name, {type: nameType})});
  }
  for (const e of entries) e.countries = [...e.countries];
  return {entries, names, byUid, version: meta.version ?? 'unversioned', manifest: meta};
}

/** Load the downloaded lists from the data dir. Throws if `compliance:update-sdn` has not been run. */
export function loadIndex({env = process.env, dir = listsDir(env)} = {}) {
  const mPath = join(dir, 'manifest.json');
  if (!existsSync(mPath)) throw new Error(`No sanctions lists in ${dir}. Run: npm run compliance:update-sdn`);
  const manifest = JSON.parse(readFileSync(mPath, 'utf8'));
  const texts = {};
  for (const f of manifest.files) {
    const p = join(dir, f.file);
    const buf = readFileSync(p);
    const digest = createHash('sha256').update(buf).digest('hex');
    if (digest !== f.sha256) throw new Error(`${f.file}: sha256 mismatch with manifest (expected ${f.sha256}, got ${digest})`);
    (texts[f.source] ??= {})[f.role] = buf.toString('utf8');
  }
  return buildIndex(texts, manifest);
}
