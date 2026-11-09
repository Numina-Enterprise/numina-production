// Per-counterparty risk score (0-100) combining jurisdiction, sanctions screening, KYC state and AML alerts.
import {loadConfig} from './util.mjs';

const AML_POINTS = {critical: 40, high: 20, medium: 10, low: 3, info: 0};

/**
 * @param {{counterparty?:object, status?:string, screening?:object, dispositions?:object[], validation?:object, idv?:object, merchantRules?:object[]}} c
 * @param {object[]} amlAlerts alerts for this counterparty
 */
export function riskScore(c, amlAlerts = [], {config = loadConfig()} = {}) {
  const j = config.aml.high_risk_jurisdictions;
  const components = [];
  const add = (factor, points, detail) => { if (points) components.push({factor, points, detail}); };
  const cp = c.counterparty || {};
  const countries = new Set([cp.country, cp.address?.country, cp.incorporationCountry, cp.controlPerson?.country, ...(cp.beneficialOwners || []).map((o) => o.country)].filter(Boolean));
  for (const a of amlAlerts) if (a.evidence?.country) countries.add(a.evidence.country);
  let jPts = 0, jWhy = null;
  for (const k of countries) {
    const p = j.comprehensive_sanctions.includes(k) ? 40 : j.fatf_call_for_action.includes(k) ? 30 : j.elevated.includes(k) ? 15 : 0;
    if (p > jPts) { jPts = p; jWhy = k; }
  }
  add('jurisdiction', jPts, jWhy && `highest-risk country ${jWhy}`);

  const dispositioned = new Set((c.dispositions || []).filter((d) => d.disposition === 'false_positive').map((d) => `${d.party}|${d.hitUid}`));
  let sPts = 0;
  for (const [party, r] of Object.entries(c.screening?.parties || {})) {
    for (const h of r.hits || []) {
      const open = !dispositioned.has(`${party}|${h.uid}`);
      const p = h.score >= (r.thresholds?.block ?? 0.97) ? 50 : open ? 25 : 5;
      if (p > sPts) sPts = p;
    }
  }
  add('sanctions_screening', sPts, sPts >= 50 ? 'potential match at/above block threshold' : sPts >= 25 ? 'undispositioned possible match' : sPts ? 'possible match dispositioned false positive' : null);
  if (!c.screening) add('not_screened', 20, 'no sanctions screen on record');

  if (c.validation && !c.validation.ok) add('kyc_invalid', 10, `${c.validation.errors.length} validation errors`);
  if (c.status && c.status !== 'approved') add('kyc_not_approved', 10, `status ${c.status}`);
  if (!c.idv || c.idv.status !== 'verified') add('idv_not_performed', 5, 'no licensed IDV result');
  if (cp.type === 'business' && cp.noBeneficialOwnersAttestation) add('no_bo_attestation', 5, 'no 25%+ owners attested');
  if ((c.merchantRules || []).some((f) => f.level === 'P')) add('merchant_prohibited', 40, 'Stripe prohibited jurisdiction/region/service');

  const amlPts = Math.min(50, amlAlerts.reduce((s, a) => s + (AML_POINTS[a.severity] ?? 0), 0));
  add('aml_alerts', amlPts, amlAlerts.length ? `${amlAlerts.length} alerts` : null);

  const score = Math.min(100, components.reduce((s, x) => s + x.points, 0));
  const b = config.risk.bands;
  const band = score >= b.high ? 'high' : score >= b.medium ? 'medium' : 'low';
  return {schema: 'numina.compliance.risk/v1', score, band, components};
}
