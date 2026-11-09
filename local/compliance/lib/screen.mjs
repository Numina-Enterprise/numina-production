// Sanctions screening against the OFAC SDN + consolidated index. A screening aid:
// every result above review_threshold goes to manual review; nothing is auto-accepted.
import {normalizeName} from './normalize.mjs';
import {jaroWinkler, tokenSetSimilarity} from './similarity.mjs';
import {normalizeId} from './lists.mjs';
import {loadConfig, round4} from './util.mjs';

function nameScore(q, n) {
  if (!q.tokens.length || !n.tokens.length) return {score: 0, exact: false};
  if (q.key === n.key || q.coreKey === n.coreKey || q.joined === n.joined) return {score: 1, exact: true};
  if (n.joined.length < 3 || q.joined.length < 3) return {score: 0, exact: false}; // very short names: exact only
  const ts = tokenSetSimilarity(q.core, n.core);
  const tsAll = tokenSetSimilarity(q.tokens, n.tokens);
  // Whole-string comparison only helps spacing variants ("AlQaida" vs "Al Qaida"), so use it only when token counts differ.
  const joined = q.tokens.length !== n.tokens.length ? jaroWinkler(q.joined, n.joined) * 0.97 : 0;
  return {score: Math.max(ts, tsAll, joined), exact: false};
}

const yearOf = (dob) => { const m = /^(\d{4})/.exec(String(dob ?? '')); return m ? Number(m[1]) : null; };

/**
 * Screen one name.
 * @param {string} name
 * @param {{type?:'individual'|'business'|'entity', country?:string, countries?:string[], dob?:string, ids?:{type?:string, number:string}[]}} opts
 * @param {{index:object, config?:object, now?:Date}} ctx
 */
export function screen(name, opts = {}, {index, config = loadConfig().screening, now = new Date()} = {}) {
  if (!index) throw new Error('screen(): a loaded sanctions index is required (run npm run compliance:update-sdn)');
  const cfg = config;
  const qType = opts.type === 'business' || opts.type === 'entity' ? 'entity' : opts.type === 'individual' ? 'individual' : null;
  const q = normalizeName(name, {type: qType ?? undefined});
  const qCountries = [...new Set([opts.country, ...(opts.countries || [])].filter(Boolean).map((c) => c.toUpperCase()))];
  const qYear = yearOf(opts.dob);
  const qIds = (opts.ids || []).map((x) => normalizeId(x.number)).filter((x) => x.length >= 4);

  const best = new Map();
  for (const n of index.names) {
    const s = nameScore(q, n.norm);
    if (s.score < cfg.review_threshold - 0.25) continue;
    const cur = best.get(n.i);
    // Weak (low-quality) a.k.a.s only count when (near-)exact, and are capped so they route to review, never block.
    if (n.kind === 'weak' && s.score < 0.95) continue;
    const capped = n.kind === 'weak' ? Math.min(s.score, cfg.weak_alias_cap) : s.score;
    if (!cur || capped > cur.score) best.set(n.i, {score: capped, rawName: s.score, exact: s.exact && n.kind !== 'weak', matchedName: n.name, matchedKind: n.kind});
  }

  const hits = [], discounted = [];
  for (const [i, b] of best) {
    const e = index.entries[i];
    const factors = [];
    let score = b.score;
    if (qIds.length && e.ids.some((id) => qIds.includes(id.number))) { score = 1; factors.push({factor: 'id_match', delta: 'set:1'}); }
    else {
      if (qType) {
        const eKind = e.type === 'individual' ? 'individual' : 'entity';
        if (eKind !== qType) { score -= cfg.type_mismatch_penalty; factors.push({factor: 'type_mismatch', delta: -cfg.type_mismatch_penalty, list: e.type}); }
      }
      if (qYear && e.dobYears.length) {
        if (e.dobYears.some((y) => Math.abs(y - qYear) <= 1)) { score += cfg.dob_match_bonus; factors.push({factor: 'dob_year_match', delta: cfg.dob_match_bonus}); }
        else { score -= cfg.dob_mismatch_penalty; factors.push({factor: 'dob_year_mismatch', delta: -cfg.dob_mismatch_penalty, list: e.dobYears}); }
      }
      if (qCountries.length && e.countries.length) {
        if (e.countries.some((c) => qCountries.includes(c))) { score += cfg.country_match_bonus; factors.push({factor: 'country_match', delta: cfg.country_match_bonus}); }
        else { score -= cfg.country_mismatch_penalty; factors.push({factor: 'country_mismatch', delta: -cfg.country_mismatch_penalty, list: e.countries}); }
      }
      // An exact primary/strong-alias name hit is never pushed below manual review by corroborating data.
      if (b.exact && score < cfg.review_threshold) { score = cfg.review_threshold; factors.push({factor: 'exact_name_floor', delta: `floor:${cfg.review_threshold}`}); }
    }
    score = round4(Math.max(0, Math.min(1, score)));
    const hit = {
      uid: e.uid, source: e.source, entNum: e.entNum, listName: e.name, matchedName: b.matchedName, matchedKind: b.matchedKind,
      exactName: b.exact, nameScore: round4(b.rawName), score, factors, programs: e.programs, type: e.type, countries: e.countries, dobYears: e.dobYears,
    };
    if (score >= cfg.review_threshold) hits.push(hit);
    else if (b.score >= cfg.review_threshold) discounted.push(hit);
  }
  hits.sort((a, b) => b.score - a.score);
  discounted.sort((a, b) => b.score - a.score);
  const top = hits[0]?.score ?? 0;
  const warnings = [];
  const fetchedAt = index.manifest?.fetchedAt ? new Date(index.manifest.fetchedAt) : null;
  if (!fetchedAt) warnings.push('list_fetch_time_unknown');
  else if ((now - fetchedAt) / 86_400_000 > cfg.max_list_age_days) warnings.push('list_stale');
  if (!q.tokens.length) warnings.push('empty_name_after_normalization');
  return {
    schema: 'numina.compliance.screen/v1',
    query: {name, normalized: q.key, type: opts.type ?? null, countries: qCountries, dob: opts.dob ?? null, idCount: qIds.length},
    listVersion: index.version, listFetchedAt: index.manifest?.fetchedAt ?? null, screenedAt: now.toISOString(),
    thresholds: {review: cfg.review_threshold, block: cfg.block_threshold},
    decision: !q.tokens.length ? 'review' : !hits.length ? 'clear' : top >= cfg.block_threshold ? 'potential_match' : 'review',
    autoAccept: false,
    hits: hits.slice(0, cfg.max_hits), discounted: discounted.slice(0, cfg.max_hits), warnings,
  };
}
