// AML transaction monitoring rules over payment records (e.g. a Stripe payments CSV export).
import {normalizeName} from './normalize.mjs';
import {tokenSetSimilarity} from './similarity.mjs';
import {isCountryCode} from './countries.mjs';
import {parseCsvObjects} from './csv.mjs';
import {loadConfig, DAY_MS, sha256Hex, round4} from './util.mjs';

export const SEVERITY_RANK = {info: 0, low: 1, medium: 2, high: 3, critical: 4};
const HOUR_MS = 3_600_000;

/** Normalize one payment record. Amounts are major units (e.g. 1500.00 USD). */
export function normalizePayment(p, {fxRates = {}} = {}) {
  const currency = String(p.currency || 'USD').toUpperCase();
  const amount = Number(p.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`payment ${p.id}: invalid amount ${p.amount}`);
  const ts = typeof p.timestamp === 'number' ? p.timestamp : Date.parse(p.timestamp);
  if (!Number.isFinite(ts)) throw new Error(`payment ${p.id}: invalid timestamp ${p.timestamp}`);
  const type = String(p.type || 'payment').toLowerCase();
  if (!['payment', 'refund', 'chargeback', 'payout'].includes(type)) throw new Error(`payment ${p.id}: unknown type ${type}`);
  const rate = currency === 'USD' ? 1 : fxRates[currency];
  const country = p.country ? String(p.country).toUpperCase() : null;
  return {
    id: String(p.id), amount, currency, amountUsd: rate ? round4(amount * rate) : null, timestamp: ts,
    timestampApprox: Boolean(p.timestampApprox), counterpartyId: p.counterpartyId ? String(p.counterpartyId) : null,
    method: p.method ?? null, country: country && isCountryCode(country) ? country : null, ipCountry: p.ipCountry ? String(p.ipCountry).toUpperCase() : null,
    type, direction: p.direction ?? (type === 'payment' ? 'in' : 'out'), payerName: p.payerName ?? null,
    payeeId: p.payeeId ?? null, fingerprint: p.fingerprint ?? null,
  };
}

const COLS = {
  id: ['id', 'payment id', 'charge id', 'charge_id'],
  amount: ['amount', 'amount (usd)', 'gross'],
  amountRefunded: ['amount refunded', 'amount_refunded'],
  currency: ['currency'],
  created: ['created (utc)', 'created date (utc)', 'created', 'timestamp', 'date (utc)'],
  refundedAt: ['refunded date (utc)', 'refunded_at'],
  customer: ['customer id', 'customer', 'counterparty_id', 'counterparty id'],
  name: ['card name', 'customer name', 'billing details name', 'payer_name', 'customer description'],
  country: ['card issue country', 'card country', 'card address country', 'billing address country', 'country'],
  ipCountry: ['ip country', 'ip_country'],
  fingerprint: ['card fingerprint', 'fingerprint'],
  method: ['payment method type', 'card brand', 'method'],
  status: ['status'],
  disputed: ['disputed amount', 'dispute amount'],
  disputeStatus: ['dispute status'],
  type: ['type'], direction: ['direction'], payee: ['payee_id', 'payee id'],
};
function pick(row, key) {
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]));
  for (const c of COLS[key]) if (lower[c] !== undefined && lower[c] !== '') return lower[c];
  return undefined;
}
const num = (v) => Number(String(v ?? '').replace(/[,$\s]/g, ''));

/**
 * Parse a Stripe payments export (Dashboard > Payments > Export) or the generic CSV schema
 * (id,amount,currency,timestamp,counterparty_id,method,country,type,direction,payer_name,payee_id,fingerprint,ip_country).
 * Refunds and disputes recorded as columns are expanded into separate refund/chargeback records.
 */
export function paymentsFromCsv(text) {
  const out = [];
  for (const row of parseCsvObjects(text)) {
    const status = String(pick(row, 'status') ?? 'paid').toLowerCase();
    if (/failed|canceled|cancelled|requires_|incomplete|blocked/.test(status)) continue;
    const id = pick(row, 'id');
    const created = pick(row, 'created');
    const createdTs = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(created ?? '') ? created : `${String(created).replace(' ', 'T')}Z`);
    const base = {currency: pick(row, 'currency') ?? 'USD', counterpartyId: pick(row, 'customer'), method: pick(row, 'method'), country: pick(row, 'country'),
      ipCountry: pick(row, 'ipCountry'), payerName: pick(row, 'name'), fingerprint: pick(row, 'fingerprint'), payeeId: pick(row, 'payee')};
    const type = (pick(row, 'type') || 'payment').toLowerCase();
    out.push({...base, id, amount: num(pick(row, 'amount')), timestamp: createdTs, type, direction: pick(row, 'direction')});
    const refunded = num(pick(row, 'amountRefunded'));
    if (type === 'payment' && refunded > 0) {
      const at = pick(row, 'refundedAt');
      out.push({...base, id: `${id}:refund`, amount: refunded, type: 'refund', timestamp: at ? Date.parse(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`) : createdTs, timestampApprox: !at});
    }
    const disputed = num(pick(row, 'disputed'));
    if (type === 'payment' && (disputed > 0 || pick(row, 'disputeStatus'))) out.push({...base, id: `${id}:dispute`, amount: disputed || num(pick(row, 'amount')), type: 'chargeback', timestamp: createdTs, timestampApprox: true});
  }
  return out;
}

function alert(rule, severity, counterpartyId, payments, summary, evidence = {}) {
  const paymentIds = payments.map((p) => p.id);
  return {id: `aml_${sha256Hex(`${rule}|${counterpartyId}|${paymentIds.join(',')}`).slice(0, 16)}`, rule, severity, counterpartyId, paymentIds, summary, evidence};
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const usd = (p) => p.amountUsd;

/** Sliding windows: yields maximal groups of items whose timestamps fall within `ms` of the first. */
function windows(items, ms) {
  const groups = [];
  for (let i = 0; i < items.length; i++) {
    const g = [items[i]];
    for (let j = i + 1; j < items.length && items[j].timestamp - items[i].timestamp <= ms; j++) g.push(items[j]);
    groups.push(g);
  }
  return groups;
}
/** Keep only groups not fully contained in an earlier (larger) group. */
function maximal(groups, min) {
  const out = []; const seen = new Set();
  for (const g of groups.filter((x) => x.length >= min).sort((a, b) => b.length - a.length)) {
    const k = g.map((p) => p.id);
    if (k.every((id) => seen.has(id))) continue;
    k.forEach((id) => seen.add(id)); out.push(g);
  }
  return out;
}

export const RULES = {
  structuring(ctx) {
    const {cfg, inbound, cpId} = ctx; const T = cfg.reporting_threshold; const s = cfg.structuring;
    const near = inbound.filter((p) => usd(p) !== null && usd(p) >= T * s.floor_pct && usd(p) < T);
    const out = maximal(windows(near, s.window_days * DAY_MS), s.min_count).map((g) =>
      alert('structuring', 'high', cpId, g, `${g.length} payments between ${T * s.floor_pct} and ${T} USD within ${s.window_days} days (total ${round4(g.reduce((a, p) => a + usd(p), 0))})`, {threshold: T, windowDays: s.window_days, amounts: g.map(usd)}));
    const sub = inbound.filter((p) => usd(p) !== null && usd(p) < T);
    for (const g of maximal(windows(sub, s.window_days * DAY_MS), 3)) {
      const total = g.reduce((a, p) => a + usd(p), 0);
      if (total >= T && !out.some((a) => g.every((p) => a.paymentIds.includes(p.id)))) out.push(alert('structuring_aggregate', 'medium', cpId, g, `${g.length} sub-threshold payments total ${round4(total)} USD (>= ${T}) within ${s.window_days} days`, {threshold: T, total: round4(total)}));
    }
    return out;
  },
  threshold_adjacent(ctx) {
    const {cfg, inbound, cpId} = ctx; const band = cfg.threshold_adjacent.band_pct;
    const out = [];
    for (const p of inbound) {
      if (usd(p) === null) continue;
      for (const T of [cfg.reporting_threshold, ...cfg.secondary_thresholds]) {
        if (usd(p) < T && usd(p) >= T * (1 - band)) { out.push(alert('threshold_adjacent', T === cfg.reporting_threshold ? 'medium' : 'low', cpId, [p], `Payment of ${usd(p)} USD is within ${band * 100}% below the ${T} USD threshold`, {threshold: T, amount: usd(p)})); break; }
      }
    }
    return out;
  },
  velocity(ctx) {
    const {cfg, inbound, cpId} = ctx; const v = cfg.velocity; const out = [];
    for (let i = 0; i < inbound.length; i++) {
      const p = inbound[i];
      const recent = inbound.filter((x) => x.timestamp <= p.timestamp && x.timestamp > p.timestamp - v.window_days * DAY_MS);
      const baseline = inbound.filter((x) => x.timestamp <= p.timestamp - v.window_days * DAY_MS && x.timestamp > p.timestamp - (v.window_days + v.baseline_days) * DAY_MS);
      const expected = (baseline.length / v.baseline_days) * v.window_days;
      if (recent.length >= v.min_count && recent.length > Math.max(1, expected) * v.count_multiplier && !out.some((a) => a.rule === 'velocity' && recent.every((r) => a.paymentIds.includes(r.id))))
        out.push(alert('velocity', 'medium', cpId, recent, `${recent.length} payments in ${v.window_days} days vs ~${round4(expected)} expected from the prior ${v.baseline_days}-day baseline`, {recent: recent.length, expected: round4(expected)}));
      const prior = inbound.slice(0, i).filter((x) => usd(x) !== null && x.timestamp > p.timestamp - v.baseline_days * DAY_MS);
      if (usd(p) !== null && prior.length >= v.min_baseline_payments) {
        const m = median(prior.map(usd));
        if (m > 0 && usd(p) >= m * v.amount_multiplier) out.push(alert('amount_spike', 'medium', cpId, [p], `Payment ${usd(p)} USD is ${round4(usd(p) / m)}x the counterparty's median ${m}`, {median: m, amount: usd(p)}));
      }
    }
    return out;
  },
  round_amount(ctx) {
    const {cfg, inbound, cpId} = ctx; const r = cfg.round_amount;
    const eligible = inbound.filter((p) => usd(p) !== null && p.amount >= r.min_amount);
    const round = eligible.filter((p) => p.amount % r.unit === 0);
    if (round.length >= r.min_count && round.length / Math.max(1, eligible.length) >= r.min_share)
      return [alert('round_amount', 'low', cpId, round, `${round.length} of ${eligible.length} payments are exact multiples of ${r.unit}`, {unit: r.unit, share: round4(round.length / eligible.length)})];
    return [];
  },
  jurisdiction(ctx) {
    const {cfg, payments, cpId} = ctx; const j = cfg.high_risk_jurisdictions; const out = [];
    for (const p of payments) for (const c of [...new Set([p.country, p.ipCountry].filter(Boolean))]) {
      const sev = j.comprehensive_sanctions.includes(c) ? 'critical' : j.fatf_call_for_action.includes(c) ? 'high' : j.elevated.includes(c) ? 'medium' : null;
      if (sev) out.push(alert('high_risk_jurisdiction', sev, cpId, [p], `Payment linked to ${c} (${sev === 'critical' ? 'comprehensively sanctioned' : sev === 'high' ? 'FATF call for action' : 'elevated risk'})`, {country: c, asOf: j.as_of}));
    }
    return out;
  },
  counterparty_status(ctx) {
    const {kyc, payments, cpId} = ctx;
    if (!payments.length) return [];
    if (!kyc) return [alert('no_kyc', 'high', cpId, payments, `No KYC record for counterparty ${cpId ?? '(none)'}`)];
    const out = [];
    if (kyc.status !== 'approved') out.push(alert('kyc_not_approved', 'medium', cpId, payments, `KYC status is ${kyc.status}, not approved with sign-off`, {status: kyc.status}));
    if (kyc.screeningDecision === 'potential_match') out.push(alert('sanctions_hit', 'critical', cpId, payments, 'Counterparty or an owner has a potential sanctions match', {decision: kyc.screeningDecision}));
    else if (kyc.screeningDecision === 'review') out.push(alert('sanctions_review', 'high', cpId, payments, 'Counterparty screening has undispositioned possible matches', {decision: kyc.screeningDecision}));
    return out;
  },
  refund_churn(ctx) {
    const {cfg, payments, inbound, cpId} = ctx; const r = cfg.refund_churn; const out = [];
    const back = payments.filter((p) => p.type === 'refund' || p.type === 'chargeback');
    for (const g of maximal(windows(back, r.window_days * DAY_MS), r.min_count)) {
      const start = g[0].timestamp - r.window_days * DAY_MS, end = g.at(-1).timestamp;
      const base = inbound.filter((p) => p.timestamp >= start && p.timestamp <= end).length;
      const ratio = base ? g.length / base : 1;
      if (ratio >= r.min_ratio) {
        const cb = g.filter((p) => p.type === 'chargeback').length;
        out.push(alert('refund_churn', cb >= 2 ? 'high' : 'medium', cpId, g, `${g.length} refunds/chargebacks (${cb} chargebacks) against ${base} payments in ${r.window_days} days`, {ratio: round4(ratio), chargebacks: cb}));
      }
    }
    return out;
  },
  payer_mismatch(ctx) {
    const {cfg, inbound, kyc, cpId} = ctx;
    if (!kyc?.names?.length) return [];
    const kn = kyc.names.map((n) => normalizeName(n));
    const out = [];
    for (const p of inbound) {
      if (!p.payerName) continue;
      const q = normalizeName(p.payerName);
      const best = Math.max(...kn.map((k) => (k.key === q.key ? 1 : tokenSetSimilarity(q.tokens, k.tokens))));
      if (best < cfg.payer_mismatch.min_similarity) out.push(alert('payer_mismatch', 'medium', cpId, [p], `Payer name does not match the KYC'd entity, DBA or listed owners (similarity ${round4(best)})`, {similarity: round4(best)}));
    }
    return out;
  },
  rapid_in_out(ctx) {
    const {cfg, payments, cpId} = ctx; const r = cfg.rapid_in_out; const out = [];
    const ins = payments.filter((p) => p.direction === 'in' && p.type === 'payment');
    const outs = payments.filter((p) => (p.type === 'refund' || p.type === 'payout' || p.direction === 'out') && p.type !== 'chargeback' && !p.timestampApprox);
    for (const i of ins) for (const o of outs) {
      const dt = o.timestamp - i.timestamp;
      if (dt >= 0 && dt <= r.window_hours * HOUR_MS && Math.abs(o.amount - i.amount) <= i.amount * r.amount_tolerance_pct && o.currency === i.currency)
        out.push(alert('rapid_in_out', 'high', cpId, [i, o], `Funds in (${i.amount} ${i.currency}) and back out (${o.amount}) within ${round4(dt / HOUR_MS)} hours`, {hours: round4(dt / HOUR_MS)}));
    }
    return out;
  },
  geography_mismatch(ctx) {
    const {inbound, kyc, cpId} = ctx; const out = [];
    for (const p of inbound) {
      const reasons = [];
      if (kyc?.countries?.length && p.country && !kyc.countries.includes(p.country)) reasons.push(`payment country ${p.country} not in KYC countries ${kyc.countries.join('/')}`);
      if (p.ipCountry && p.country && p.ipCountry !== p.country) reasons.push(`IP country ${p.ipCountry} differs from card country ${p.country}`);
      if (reasons.length) out.push(alert('geography_mismatch', reasons.length > 1 ? 'medium' : 'low', cpId, [p], reasons.join('; '), {reasons}));
    }
    return out;
  },
  dormant_then_active(ctx) {
    const {cfg, inbound, cpId} = ctx; const d = cfg.dormant; const out = [];
    for (let i = 1; i < inbound.length; i++) {
      const gap = inbound[i].timestamp - inbound[i - 1].timestamp;
      if (gap >= d.dormant_days * DAY_MS && usd(inbound[i]) !== null && usd(inbound[i]) >= d.min_amount)
        out.push(alert('dormant_then_active', 'medium', cpId, [inbound[i - 1], inbound[i]], `Activity of ${usd(inbound[i])} USD after ${Math.floor(gap / DAY_MS)} dormant days`, {dormantDays: Math.floor(gap / DAY_MS)}));
    }
    return out;
  },
  unconverted_currency(ctx) {
    const {payments, cpId} = ctx;
    const u = payments.filter((p) => p.amountUsd === null);
    return u.length ? [alert('unconverted_currency', 'info', cpId, u, `${u.length} non-USD payments without an FX rate; threshold rules skipped for them`)] : [];
  },
};

/** Many distinct payers paying one payee/counterparty within a window (fan-in). Runs across all records. */
function fanIn(all, cfg) {
  const f = cfg.fan_in; const out = [];
  const groups = new Map();
  for (const p of all) if (p.type === 'payment' && p.direction === 'in') { const k = p.payeeId ?? p.counterpartyId; if (k) (groups.get(k) ?? groups.set(k, []).get(k)).push(p); }
  for (const [payee, ps] of groups) {
    ps.sort((a, b) => a.timestamp - b.timestamp);
    for (const g of windows(ps, f.window_days * DAY_MS)) {
      const payers = new Set(g.map((p) => p.fingerprint ?? (p.payerName ? normalizeName(p.payerName).key : null)).filter(Boolean));
      if (payers.size >= f.min_distinct_payers && !out.some((a) => a.counterpartyId === payee && g.every((p) => a.paymentIds.includes(p.id))))
        out.push(alert('fan_in', 'medium', payee, g, `${payers.size} distinct payers paid ${payee} within ${f.window_days} days`, {distinctPayers: payers.size}));
    }
  }
  return out;
}

/**
 * Run every rule. kycByCounterparty: Map(counterpartyId -> {status, screeningDecision, names[], countries[]}).
 * @returns {{alerts:object[], byCounterparty:Object<string,object[]>, rulesRun:string[], paymentCount:number}}
 */
export function monitor(records, {kycByCounterparty = new Map(), config = loadConfig().aml, fxRates = {}} = {}) {
  const all = records.map((r) => normalizePayment(r, {fxRates})).sort((a, b) => a.timestamp - b.timestamp);
  const byCp = new Map();
  for (const p of all) { const k = p.counterpartyId ?? '(unknown)'; (byCp.get(k) ?? byCp.set(k, []).get(k)).push(p); }
  const alerts = [];
  for (const [cpId, payments] of byCp) {
    const ctx = {cfg: config, cpId, payments, inbound: payments.filter((p) => p.type === 'payment' && p.direction === 'in'), kyc: kycByCounterparty.get(cpId) ?? null};
    for (const rule of Object.values(RULES)) alerts.push(...rule(ctx));
  }
  alerts.push(...fanIn(all, config));
  const uniq = [...new Map(alerts.map((a) => [a.id, a])).values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.rule.localeCompare(b.rule));
  const by = {};
  for (const a of uniq) (by[a.counterpartyId] ??= []).push(a);
  return {schema: 'numina.compliance.aml/v1', alerts: uniq, byCounterparty: by, rulesRun: [...Object.keys(RULES), 'fan_in'], paymentCount: all.length};
}
