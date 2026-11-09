// KYC / AML case workflow: screening with engine selection, dispositions, manual checks,
// approval blockers, AML payment cases. Final approval happens only in signoff.mjs.
import {screen} from './screen.mjs';
import {WatchmanClient, screenWithWatchman} from './watchman.mjs';
import {loadIndex} from './lists.mjs';
import {validateCounterparty, partiesOf} from './kyc-schema.mjs';
import {monitor, SEVERITY_RANK} from './aml.mjs';
import {riskScore} from './risk.mjs';
import {counterpartyMerchantFindings} from './merchant-rules.mjs';
import {notPerformed} from './idv-provider.mjs';
import {appendAudit} from './audit.mjs';
import {loadConfig, DAY_MS, sha256Hex} from './util.mjs';

export const OFAC_SLS_URL = 'https://ofac.treasury.gov/sanctions-list-search-tool';

/**
 * Pick the screening engines. engine: 'auto' (Watchman if reachable, plus built-in if lists are downloaded),
 * 'watchman', 'builtin' or 'both'. Returns {watchman?, builtin?, report}.
 */
export async function resolveEngines({engine = loadConfig().screening.engine, env = process.env, index, watchmanClient, fetchImpl} = {}) {
  const report = {requested: engine, watchman: null, builtin: null};
  let wm = null, info = null, idx = index ?? null;
  if (engine !== 'builtin') {
    try {
      const client = watchmanClient ?? new WatchmanClient({env, fetchImpl});
      info = await client.health();
      report.watchman = info.ok ? {status: 'running', base: client.base, lists: info.lists} : {status: 'unavailable', base: client.base, error: info.error};
      if (info.ok) wm = client;
    } catch (e) { report.watchman = {status: 'unavailable', error: String(e.message || e)}; }
  }
  if (engine !== 'watchman' && !idx) {
    try { idx = loadIndex({env}); } catch (e) { report.builtin = {status: 'unavailable', error: String(e.message || e)}; }
  }
  if (idx) report.builtin = {status: 'ready', listVersion: idx.version, entries: idx.entries.length};
  if (engine === 'watchman' && !wm) throw new Error(`Watchman requested but unavailable: ${report.watchman?.error}`);
  if (engine === 'builtin' && !idx) throw new Error(`Built-in matcher requested but no lists: ${report.builtin?.error}`);
  if (engine === 'both' && (!wm || !idx)) throw new Error('Both engines requested but one is unavailable');
  if (!wm && !idx) throw new Error('No screening engine available: start Watchman (local/compliance/watchman) or run npm run compliance:update-sdn');
  report.used = [wm && 'watchman', idx && 'builtin'].filter(Boolean);
  if (engine === 'auto' && !wm) report.fallback = 'Watchman not running; used the built-in fuzzy matcher';
  return {watchman: wm, watchmanInfo: info, index: idx, report};
}

const WORST = {clear: 0, review: 1, potential_match: 2};

/** Screen one party with every resolved engine and merge (worst decision wins, hits unioned). */
export async function screenParty(party, engines, {config = loadConfig().screening, now = new Date()} = {}) {
  const per = {};
  if (engines.watchman) per.watchman = await screenWithWatchman(engines.watchman, party.name, party, {config, info: engines.watchmanInfo, now});
  if (engines.index) per.builtin = {...screen(party.name, party, {index: engines.index, config, now}), engine: 'builtin'};
  const results = Object.values(per);
  const decision = results.map((r) => r.decision).sort((a, b) => WORST[b] - WORST[a])[0];
  const hits = results.flatMap((r) => r.hits.map((h) => ({...h, engine: r.engine})));
  return {
    schema: 'numina.compliance.party-screen/v1', role: party.role, engine: Object.keys(per).join('+'), decision, autoAccept: false,
    hits, discounted: results.flatMap((r) => r.discounted.map((h) => ({...h, engine: r.engine}))),
    thresholds: {review: config.review_threshold, block: config.block_threshold, watchmanMinMatch: config.watchman_min_match},
    listVersion: results.map((r) => r.listVersion).join(' | '), screenedAt: now.toISOString(),
    warnings: results.flatMap((r) => r.warnings.map((w) => `${r.engine}:${w}`)), engines: per,
  };
}

/** Create a counterparty case from intake (status draft). */
export function createCounterpartyCase(store, counterparty, {actor = 'local', now = new Date()} = {}) {
  const validation = validateCounterparty(counterparty, {now});
  return store.create('counterparty', {counterparty, validation, idv: notPerformed(), merchantRules: counterpartyMerchantFindings(counterparty)}, {actor});
}

export function updateCounterparty(store, c, counterparty, {actor = 'local', now = new Date()} = {}) {
  if (!['draft'].includes(c.status)) throw new Error(`intake can only be edited in draft (case is ${c.status})`);
  c.counterparty = counterparty;
  c.validation = validateCounterparty(counterparty, {now});
  c.merchantRules = counterpartyMerchantFindings(counterparty);
  c.screening = null; c.dispositions = []; c.manualChecks = [];
  store.save(c);
  appendAudit({caseId: c.id, event: 'intake_updated', actor, valid: c.validation.ok}, store.env);
  return c;
}

export function submit(store, c, {actor = 'local', now = new Date()} = {}) {
  c.validation = validateCounterparty(c.counterparty, {now});
  if (!c.validation.ok) { store.save(c); throw new Error(`cannot submit: ${c.validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`); }
  return store.transition(c, 'submitted', {actor});
}

/** submitted|needs_review|approved -> screening -> needs_review. Screens entity, DBA, control person and every beneficial owner. */
export async function runScreening(store, c, {engines, actor = 'local', config = loadConfig(), now = new Date()} = {}) {
  store.transition(c, 'screening', {actor});
  const parties = {};
  for (const p of partiesOf(c.counterparty)) parties[p.key] = await screenParty(p, engines, {config: config.screening, now});
  c.screening = {screenedAt: now.toISOString(), engines: engines.report, parties};
  c.dispositions = (c.dispositions || []).filter((d) => parties[d.party]?.hits.some((h) => h.uid === d.hitUid));
  c.risk = riskScore({...c, status: 'needs_review'}, c.aml?.alerts || [], {config});
  store.save(c);
  appendAudit({caseId: c.id, event: 'screened', actor, engines: engines.report.used.join('+'),
    decisions: Object.fromEntries(Object.entries(parties).map(([k, v]) => [k, v.decision])), screenSha256: sha256Hex(JSON.stringify(parties))}, store.env);
  return store.transition(c, 'needs_review', {actor, reason: 'screening complete; awaiting human review and sign-off'});
}

/** Record a human disposition of a screening hit (false_positive or true_match). */
export function disposition(store, c, {party, hitUid, as, reason, actor = 'local', config = loadConfig()}) {
  if (c.status !== 'needs_review') throw new Error('dispositions are recorded during needs_review');
  const r = c.screening?.parties?.[party];
  const hit = r?.hits.find((h) => h.uid === hitUid);
  if (!hit) throw new Error(`no hit ${hitUid} for party ${party}`);
  if (!['false_positive', 'true_match'].includes(as)) throw new Error('disposition must be false_positive or true_match');
  if (!reason || reason.trim().length < 10) throw new Error('a disposition needs a written reason (10+ characters)');
  if (as === 'false_positive' && hit.score >= config.screening.block_threshold) throw new Error(`hit scores ${hit.score} >= block threshold ${config.screening.block_threshold}; it cannot be dispositioned as a false positive locally. Escalate to counsel / OFAC hotline.`);
  c.dispositions = (c.dispositions || []).filter((d) => !(d.party === party && d.hitUid === hitUid));
  c.dispositions.push({party, hitUid, disposition: as, reason, by: actor, at: new Date().toISOString()});
  c.risk = riskScore(c, c.aml?.alerts || [], {config});
  store.save(c);
  appendAudit({caseId: c.id, event: 'disposition', party, hitUid, disposition: as, actor}, store.env);
  return c;
}

/** Record the human cross-check in OFAC's Sanctions List Search (not automated). */
export function manualCheck(store, c, {party, result, note = '', actor = 'local'}) {
  if (!['no_match', 'possible_match'].includes(result)) throw new Error('result must be no_match or possible_match');
  const parties = c.caseType === 'counterparty' ? partiesOf(c.counterparty).map((p) => p.key) : ['entity'];
  if (!parties.includes(party)) throw new Error(`unknown party ${party}; expected one of ${parties.join(', ')}`);
  c.manualChecks = (c.manualChecks || []).filter((m) => m.party !== party);
  c.manualChecks.push({check: 'ofac_sanctions_list_search', url: OFAC_SLS_URL, party, result, note, by: actor, at: new Date().toISOString(), automated: false});
  store.save(c);
  appendAudit({caseId: c.id, event: 'manual_check', party, result, actor}, store.env);
  return c;
}

export function screeningSummary(c, config = loadConfig()) {
  let worst = 'clear';
  const fp = new Set((c.dispositions || []).filter((d) => d.disposition === 'false_positive').map((d) => `${d.party}|${d.hitUid}`));
  for (const [party, r] of Object.entries(c.screening?.parties || {})) for (const h of r.hits) {
    if (h.score >= config.screening.block_threshold || (c.dispositions || []).some((d) => d.party === party && d.hitUid === h.uid && d.disposition === 'true_match')) worst = 'potential_match';
    else if (!fp.has(`${party}|${h.uid}`) && worst === 'clear') worst = 'review';
  }
  return c.screening ? worst : 'not_screened';
}

/** Everything that prevents approval/clearance. Empty array == eligible for sign-off. */
export function approvalBlockers(c, {config = loadConfig(), now = new Date(), store} = {}) {
  const b = [];
  if (c.status !== 'needs_review') b.push(`case status is ${c.status}; sign-off happens from needs_review`);
  if (c.caseType === 'counterparty') {
    if (!c.validation?.ok) b.push('KYC validation has errors');
    if (!c.screening) b.push('not screened');
    else {
      const age = (now - new Date(c.screening.screenedAt)) / DAY_MS;
      if (age > config.screening.max_screen_age_days) b.push(`screening is ${Math.floor(age)} days old (max ${config.screening.max_screen_age_days})`);
      for (const p of partiesOf(c.counterparty)) {
        const r = c.screening.parties[p.key];
        if (!r) { b.push(`party ${p.key} (${p.role}) not screened`); continue; }
        for (const w of r.warnings) if (/list_stale|empty_name/.test(w)) b.push(`party ${p.key}: ${w}`);
        for (const h of r.hits) {
          const d = (c.dispositions || []).find((x) => x.party === p.key && x.hitUid === h.uid);
          if (h.score >= config.screening.block_threshold) b.push(`party ${p.key}: potential sanctions match ${h.uid} (score ${h.score}) - escalate, cannot approve`);
          else if (!d) b.push(`party ${p.key}: possible match ${h.uid} (score ${h.score}) needs a disposition`);
          else if (d.disposition === 'true_match') b.push(`party ${p.key}: ${h.uid} dispositioned as TRUE MATCH`);
        }
      }
    }
    if (config.kyc.require_manual_ofac_check) for (const p of partiesOf(c.counterparty)) {
      const m = (c.manualChecks || []).find((x) => x.party === p.key);
      if (!m) b.push(`party ${p.key}: manual OFAC Sanctions List Search cross-check not recorded (${OFAC_SLS_URL})`);
      else if (m.result !== 'no_match') b.push(`party ${p.key}: manual OFAC check found a possible match`);
    }
    for (const f of c.merchantRules || []) if (f.level === 'P') b.push(`merchant rule ${f.rule}: ${f.detail}`);
    if (config.kyc.require_idv && c.idv?.status !== 'verified') b.push('licensed IDV verification required by config but not performed');
  } else if (c.caseType === 'payment') {
    if (store && c.kycCaseId) {
      let k = null; try { k = store.get(c.kycCaseId); } catch { /* missing */ }
      if (!k || !store.isEffectivelyApproved(k)) b.push(`counterparty KYC case ${c.kycCaseId} is not approved with a valid sign-off`);
    } else b.push('no approved KYC case linked to this counterparty');
    for (const a of c.aml?.alerts || []) {
      const d = (c.dispositions || []).find((x) => x.alertId === a.id);
      if (a.severity === 'critical') b.push(`critical AML alert ${a.rule} (${a.id}) cannot be cleared locally`);
      else if (SEVERITY_RANK[a.severity] >= SEVERITY_RANK.medium && !d) b.push(`AML alert ${a.rule} (${a.id}, ${a.severity}) needs a review note`);
    }
  }
  for (const a of c.caseType === 'counterparty' ? c.aml?.alerts || [] : []) if (a.severity === 'critical') b.push(`critical AML alert ${a.rule} on this counterparty`);
  return b;
}

/** Map counterpartyId -> KYC facts for AML rules. Keys: case id and each externalId. */
export function kycIndex(store, config = loadConfig()) {
  const m = new Map();
  for (const c of store.list().filter((x) => x.caseType === 'counterparty')) {
    const cp = c.counterparty;
    const facts = {
      caseId: c.id, status: c.status === 'approved' && !store.isEffectivelyApproved(c) ? 'approved_signoff_invalid' : c.status,
      screeningDecision: screeningSummary(c, config),
      names: [cp.legalName, cp.dba, cp.controlPerson?.legalName, ...(cp.beneficialOwners || []).map((o) => o.legalName)].filter(Boolean),
      countries: [...new Set([cp.country, cp.address?.country, cp.incorporationCountry, ...(cp.beneficialOwners || []).map((o) => o.country)].filter(Boolean))],
    };
    for (const k of [c.id, ...(cp.externalIds || [])]) m.set(k, facts);
  }
  return m;
}

/** Run AML monitoring, attach alerts to counterparty cases, optionally open payment review cases. */
export function runAml(store, records, {openCases = false, actor = 'local', config = loadConfig(), fxRates} = {}) {
  const kyc = kycIndex(store, config);
  const result = monitor(records, {kycByCounterparty: kyc, config: config.aml, fxRates});
  const opened = [];
  for (const [cpId, alerts] of Object.entries(result.byCounterparty)) {
    const facts = kyc.get(cpId);
    if (facts && facts.status !== 'approved') {
      // Approved cases are not mutated (that would void the signed hash); their alerts go to payment cases.
      const c = store.get(facts.caseId);
      c.aml = {scannedAt: new Date().toISOString(), alerts, rulesRun: result.rulesRun};
      c.risk = riskScore(c, alerts, {config});
      store.save(c);
      appendAudit({caseId: c.id, event: 'aml_alerts', count: alerts.length, actor}, store.env);
    }
    if (openCases && alerts.some((a) => SEVERITY_RANK[a.severity] >= SEVERITY_RANK.low)) {
      const ids = new Set(alerts.flatMap((a) => a.paymentIds));
      const payments = records.filter((r) => ids.has(String(r.id)));
      const p = store.create('payment', {counterpartyId: cpId, kycCaseId: facts?.caseId ?? null, payments, aml: {scannedAt: new Date().toISOString(), alerts, rulesRun: result.rulesRun},
        risk: riskScore({counterparty: facts ? store.get(facts.caseId).counterparty : {}, status: facts?.status, screening: facts ? store.get(facts.caseId).screening : null}, alerts, {config})}, {actor});
      opened.push(p.id);
    }
  }
  return {...result, openedCases: opened};
}

/** Review note on an AML alert inside a payment case. */
export function alertNote(store, c, {alertId, note, actor = 'local'}) {
  if (c.caseType !== 'payment') throw new Error('alert notes apply to payment cases');
  if (!(c.aml?.alerts || []).some((a) => a.id === alertId)) throw new Error(`no alert ${alertId}`);
  if (!note || note.trim().length < 10) throw new Error('note must be 10+ characters');
  c.dispositions = (c.dispositions || []).filter((d) => d.alertId !== alertId);
  c.dispositions.push({alertId, disposition: 'reviewed', reason: note, by: actor, at: new Date().toISOString()});
  store.save(c);
  appendAudit({caseId: c.id, event: 'alert_note', alertId, actor}, store.env);
  return c;
}
