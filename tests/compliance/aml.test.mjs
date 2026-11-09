import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {monitor, normalizePayment, paymentsFromCsv, RULES} from '../../local/compliance/lib/aml.mjs';
import {riskScore} from '../../local/compliance/lib/risk.mjs';
import {loadConfig} from '../../local/compliance/lib/util.mjs';
import {fakePayments, fakeKycMap, EXPECTED_RULES} from '../../local/compliance/lib/synthetic.mjs';

const config = loadConfig();
const cfg = config.aml;
const all = monitor(fakePayments(), {kycByCounterparty: fakeKycMap(), config: cfg});
const by = (rule, cp) => all.alerts.filter((a) => a.rule === rule && (!cp || a.counterpartyId === cp));
const T = Date.UTC(2026, 9, 1);
const p = (id, amount, days, extra = {}) => ({id, amount, currency: 'USD', timestamp: new Date(T + days * 86_400_000).toISOString(), counterpartyId: 'cus_FAKE_X', country: 'US', ...extra});
const kycX = new Map([['cus_FAKE_X', {status: 'approved', screeningDecision: 'clear', names: ['Placeholder X LLC'], countries: ['US']}]]);
const only = (records, rule, over = {}) => monitor(records, {kycByCounterparty: kycX, config: {...cfg, ...over}}).alerts.filter((a) => a.rule === rule);

test('every rule fires on the synthetic dataset, with rule, severity and evidence', () => {
  const fired = new Set(all.alerts.map((a) => a.rule));
  for (const r of EXPECTED_RULES) assert.ok(fired.has(r), `missing ${r}`);
  for (const a of all.alerts) { assert.ok(a.id.startsWith('aml_') && a.severity && a.summary && Array.isArray(a.paymentIds)); }
  assert.deepEqual(all.rulesRun.sort(), [...Object.keys(RULES), 'fan_in'].sort());
});

test('structuring: several payments just under $10,000 inside the window', () => {
  const a = by('structuring', 'cus_FAKE_A')[0];
  assert.equal(a.severity, 'high');
  assert.deepEqual(a.paymentIds, ['py_a1', 'py_a2', 'py_a3']);
  assert.equal(only([p('x1', 9500, 0), p('x2', 9600, 30)], 'structuring').length, 0, 'outside the 7-day window');
  assert.equal(only([p('x1', 9500, 0)], 'structuring').length, 0, 'a single payment is not structuring');
  const agg = only([p('x1', 4000, 0), p('x2', 3500, 1), p('x3', 3000, 2)], 'structuring_aggregate');
  assert.equal(agg.length, 1, 'aggregate of sub-threshold pieces >= $10,000');
});

test('threshold-adjacent single payments', () => {
  assert.ok(by('threshold_adjacent', 'cus_FAKE_A').some((a) => a.paymentIds[0] === 'py_a3' && a.severity === 'medium'));
  assert.equal(only([p('x', 2950, 0)], 'threshold_adjacent')[0].evidence.threshold, 3000);
  assert.equal(only([p('x', 9000, 0)], 'threshold_adjacent').length, 0);
});

test('velocity and amount spike vs the counterparty baseline', () => {
  assert.equal(by('velocity', 'cus_FAKE_C').length, 1);
  assert.deepEqual(by('amount_spike', 'cus_FAKE_C').map((a) => a.paymentIds[0]), ['py_c6']);
  const steady = Array.from({length: 12}, (_, i) => p(`s${i}`, 1500, i * 7));
  assert.equal(only(steady, 'velocity').length, 0, 'steady weekly payments are not a spike');
});

test('round-amount pattern', () => {
  assert.equal(by('round_amount', 'cus_FAKE_B')[0].severity, 'low');
  assert.equal(only([p('a', 1500, 0), p('b', 2500, 1), p('c', 3000, 2)], 'round_amount').length, 0);
});

test('high-risk and sanctioned jurisdictions', () => {
  assert.equal(by('high_risk_jurisdiction', 'cus_FAKE_D')[0].severity, 'critical');
  assert.equal(only([p('a', 100, 0, {country: 'MM'})], 'high_risk_jurisdiction')[0].severity, 'high');
  assert.equal(only([p('a', 100, 0, {country: 'RU'})], 'high_risk_jurisdiction')[0].severity, 'medium');
  assert.equal(only([p('a', 100, 0, {country: 'US', ipCountry: 'KP'})], 'high_risk_jurisdiction')[0].severity, 'critical');
});

test('counterparty with a sanctions hit, open review, unapproved KYC, or no KYC', () => {
  assert.equal(by('sanctions_hit', 'cus_FAKE_D')[0].severity, 'critical');
  assert.equal(by('kyc_not_approved', 'cus_FAKE_B')[0].severity, 'medium');
  assert.equal(by('no_kyc', 'cus_FAKE_G')[0].severity, 'high');
  const review = monitor([p('a', 100, 0)], {kycByCounterparty: new Map([['cus_FAKE_X', {status: 'needs_review', screeningDecision: 'review', names: [], countries: []}]]), config: cfg});
  assert.ok(review.alerts.some((a) => a.rule === 'sanctions_review'));
  assert.equal(by('no_kyc', 'cus_FAKE_A').length, 0);
});

test('refund / chargeback churn', () => {
  const a = by('refund_churn', 'cus_FAKE_E')[0];
  assert.equal(a.severity, 'high');
  assert.equal(a.evidence.chargebacks, 2);
  assert.equal(only([p('a', 100, 0), p('b', 100, 1), p('c', 100, 2), p('d', 100, 3), p('r', 100, 4, {type: 'refund'})], 'refund_churn').length, 0, 'one refund is not churn');
});

test('payer vs KYC entity mismatch', () => {
  const a = by('payer_mismatch', 'cus_FAKE_A');
  assert.deepEqual(a.map((x) => x.paymentIds[0]), ['py_a3']);
  assert.equal(only([p('a', 100, 0, {payerName: 'PLACEHOLDER X, L.L.C.'})], 'payer_mismatch').length, 0, 'suffix/punctuation variants match');
});

test('rapid in-and-out', () => {
  const a = by('rapid_in_out', 'cus_FAKE_F')[0];
  assert.equal(a.severity, 'high');
  assert.equal(a.evidence.hours, 5);
  assert.equal(only([p('a', 4000, 0), p('b', 4000, 10, {type: 'refund'})], 'rapid_in_out').length, 0, 'outside 72h');
  assert.equal(only([p('a', 4000, 0), p('b', 1000, 0.1, {type: 'refund'})], 'rapid_in_out').length, 0, 'partial refund');
});

test('many payers to one payee (fan-in)', () => {
  const a = by('fan_in', 'inv_FAKE_1')[0];
  assert.equal(a.evidence.distinctPayers, 3);
  assert.equal(only([p('a', 1, 0, {fingerprint: 'f1'}), p('b', 1, 1, {fingerprint: 'f1'}), p('c', 1, 2, {fingerprint: 'f1'})], 'fan_in').length, 0, 'same payer repeatedly');
});

test('geography mismatch (KYC country vs payment country; card vs IP country)', () => {
  const a = by('geography_mismatch', 'cus_FAKE_A')[0];
  assert.equal(a.severity, 'medium');
  assert.equal(a.evidence.reasons.length, 2);
  assert.equal(only([p('a', 1, 0, {country: 'US'})], 'geography_mismatch').length, 0);
});

test('dormant then active', () => {
  assert.equal(by('dormant_then_active', 'cus_FAKE_H')[0].evidence.dormantDays, 395);
  assert.equal(only([p('a', 1500, 0), p('b', 1500, 30)], 'dormant_then_active').length, 0);
});

test('thresholds are configurable', () => {
  assert.equal(only([p('a', 9500, 0), p('b', 9600, 1)], 'structuring', {structuring: {...cfg.structuring, min_count: 3}}).length, 0);
  assert.equal(only([p('a', 1500, 0), p('b', 3000, 10)], 'dormant_then_active', {dormant: {dormant_days: 5, min_amount: 1000}}).length, 1);
});

test('FX: non-USD payments convert with a rate, otherwise flagged and skipped for thresholds', () => {
  assert.equal(normalizePayment({id: 'e', amount: 100, currency: 'eur', timestamp: T}, {fxRates: {EUR: 1.1}}).amountUsd, 110);
  assert.equal(normalizePayment({id: 'e', amount: 100, currency: 'EUR', timestamp: T}).amountUsd, null);
  assert.ok(by('unconverted_currency', 'cus_FAKE_A').length);
  assert.throws(() => normalizePayment({id: 'z', amount: -1, timestamp: T}), /invalid amount/);
  assert.throws(() => normalizePayment({id: 'z', amount: 1, timestamp: 'nope'}), /invalid timestamp/);
});

test('Stripe payments CSV export is parsed, failed payments skipped, refunds/disputes expanded', () => {
  const recs = paymentsFromCsv(readFileSync(new URL('./fixtures/stripe-payments-synthetic.csv', import.meta.url), 'utf8'));
  assert.deepEqual(recs.map((r) => `${r.id}:${r.type}`), ['ch_FAKE_0001:payment', 'ch_FAKE_0002:payment', 'ch_FAKE_0003:payment', 'ch_FAKE_0004:payment', 'ch_FAKE_0004:refund:refund', 'ch_FAKE_0004:dispute:chargeback']);
  assert.equal(recs[0].amount, 9500);
  assert.equal(recs[0].counterpartyId, 'cus_FAKE_A');
  assert.equal(recs[0].timestamp, Date.parse('2026-10-01T12:00:00Z'));
  const r = monitor(recs, {kycByCounterparty: fakeKycMap(), config: cfg});
  assert.ok(r.alerts.some((a) => a.rule === 'structuring' && a.counterpartyId === 'cus_FAKE_A'));
  assert.ok(r.alerts.some((a) => a.rule === 'payer_mismatch' && a.paymentIds[0] === 'ch_FAKE_0003'));
});

test('per-counterparty risk score combines jurisdiction, screening, KYC state and AML alerts', () => {
  const low = riskScore({counterparty: {type: 'individual', country: 'US'}, status: 'approved', screening: {parties: {}}, idv: {status: 'verified'}, validation: {ok: true}}, [], {config});
  assert.equal(low.score, 0); assert.equal(low.band, 'low');
  const high = riskScore({counterparty: {type: 'business', country: 'IR'}, status: 'needs_review', screening: {parties: {entity: {thresholds: {block: 0.97}, hits: [{uid: 'SDN:1', score: 0.99}]}}}, validation: {ok: true}},
    all.byCounterparty.cus_FAKE_D, {config});
  assert.equal(high.score, 100); assert.equal(high.band, 'high');
  assert.ok(high.components.some((c) => c.factor === 'sanctions_screening' && c.points === 50));
  const fp = riskScore({counterparty: {type: 'individual', country: 'US'}, status: 'approved', idv: {status: 'verified'}, validation: {ok: true},
    screening: {parties: {entity: {hits: [{uid: 'SDN:1', score: 0.9}]}}}, dispositions: [{party: 'entity', hitUid: 'SDN:1', disposition: 'false_positive'}]}, [], {config});
  assert.equal(fp.components.find((c) => c.factor === 'sanctions_screening').points, 5);
});
