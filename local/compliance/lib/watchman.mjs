// Client for a local Moov Watchman (Apache-2.0) sanctions screener, bound to loopback.
// Watchman's API is unauthenticated by design, so this client refuses non-local URLs.
import {round4} from './util.mjs';

export const DEFAULT_WATCHMAN_URL = 'http://127.0.0.1:8084';

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i;
const PRIVATE = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

export function watchmanUrl(env = process.env) {
  const raw = env.NUMINA_WATCHMAN_URL || DEFAULT_WATCHMAN_URL;
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('NUMINA_WATCHMAN_URL must be http(s)');
  const host = u.hostname;
  if (!LOOPBACK.test(host) && !(env.NUMINA_WATCHMAN_ALLOW_LAN === '1' && PRIVATE.test(host)))
    throw new Error(`Refusing Watchman URL ${raw}: only loopback (or a private LAN address with NUMINA_WATCHMAN_ALLOW_LAN=1) is allowed`);
  return u.origin;
}

async function getJson(fetchImpl, url, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {signal: ac.signal, headers: {Accept: 'application/json'}});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export class WatchmanClient {
  constructor({env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 2500} = {}) {
    this.base = watchmanUrl(env);
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
  /** {ok, lists, listHashes, startedAt, endedAt, version} or {ok:false, error} */
  async health() {
    try {
      const info = await getJson(this.fetch, `${this.base}/v2/listinfo`, this.timeoutMs);
      const total = Object.values(info.lists || {}).reduce((a, b) => a + b, 0);
      if (!total) return {ok: false, error: 'Watchman is up but no lists are loaded yet'};
      return {ok: true, lists: info.lists, listHashes: info.listHashes || {}, startedAt: info.startedAt, endedAt: info.endedAt, version: info.version || null};
    } catch (e) {
      return {ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e)};
    }
  }
  /** Raw /v2/search call. */
  async search({name, type, dob, minMatch = 0.8, limit = 10}) {
    const q = new URLSearchParams({name, minMatch: String(minMatch), limit: String(limit)});
    const wType = type === 'individual' ? 'person' : type === 'business' || type === 'entity' ? 'business' : null;
    if (wType) q.set('type', wType);
    if (wType === 'person' && dob) q.set('birthDate', dob);
    return getJson(this.fetch, `${this.base}/v2/search?${q}`, this.timeoutMs * 4);
  }
}

/** Screen with Watchman and shape the result like the built-in screen() output. */
export async function screenWithWatchman(client, name, opts = {}, {config, info, now = new Date()} = {}) {
  const cfg = config;
  const minMatch = cfg.watchman_min_match ?? 0.8;
  const types = opts.type ? [opts.type] : ['individual', 'business'];
  const entities = [];
  for (const t of types) {
    const r = await client.search({name, type: t, dob: opts.dob, minMatch, limit: cfg.max_hits});
    for (const e of r.entities || []) entities.push(e);
    // Businesses and organizations are separate partitions in Watchman.
    if (t !== 'individual') {
      const q = new URLSearchParams({name, minMatch: String(minMatch), limit: String(cfg.max_hits), type: 'organization'});
      const org = await getJson(client.fetch, `${client.base}/v2/search?${q}`, client.timeoutMs * 4).catch(() => ({entities: []}));
      for (const e of org.entities || []) entities.push(e);
    }
  }
  const hits = entities.map((e) => ({
    uid: `${e.sourceList}:${e.sourceID}`, source: e.sourceList, entNum: e.sourceID, listName: e.name, matchedName: e.name, matchedKind: 'watchman',
    exactName: false, nameScore: null, score: round4(Number(e.match) || 0), factors: [{factor: 'watchman_match', engine: 'watchman'}],
    programs: e.sanctionsInfo?.programs ?? [], type: e.entityType, countries: [], dobYears: e.person?.birthDate ? [Number(String(e.person.birthDate).slice(0, 4))] : [],
  })).filter((h) => h.score >= minMatch);
  const uniq = [...new Map(hits.map((h) => [h.uid, h])).values()].sort((a, b) => b.score - a.score);
  const top = uniq[0]?.score ?? 0;
  return {
    schema: 'numina.compliance.screen/v1', engine: 'watchman',
    query: {name, type: opts.type ?? null, countries: [opts.country].filter(Boolean), dob: opts.dob ?? null},
    listVersion: `watchman:${Object.entries(info?.listHashes || {}).map(([k, v]) => `${k}=${String(v).slice(0, 12)}`).join(',')}`,
    listFetchedAt: info?.endedAt ?? null, lists: info?.lists ?? null, screenedAt: now.toISOString(),
    thresholds: {review: minMatch, block: cfg.block_threshold},
    decision: !uniq.length ? 'clear' : top >= cfg.block_threshold ? 'potential_match' : 'review', autoAccept: false,
    hits: uniq.slice(0, cfg.max_hits), discounted: [], warnings: [],
  };
}
