// KYC intake schema and validation for individual and business counterparties.
import {isCountryCode} from './countries.mjs';
import {loadConfig} from './util.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR GU VI AS MP'.split(' '));

/** Field reference (documentation + used by the packet). */
export const SCHEMA = {
  individual: {
    required: ['type', 'legalName', 'address', 'country', 'dob', 'email'],
    optional: ['dba', 'tinLast4', 'website', 'externalIds', 'ids', 'notes'],
  },
  business: {
    required: ['type', 'legalName', 'address', 'country', 'incorporationDate', 'einLast4', 'email', 'controlPerson', 'beneficialOwners'],
    optional: ['dba', 'incorporationCountry', 'website', 'externalIds', 'noBeneficialOwnersAttestation', 'notes'],
  },
  address: {required: ['line1', 'city', 'country'], optional: ['line2', 'region', 'postalCode']},
  person: {required: ['legalName', 'dob', 'country'], optional: ['address', 'ownershipPct', 'title', 'ids']},
};

function parseDate(s) {
  const m = DATE.exec(String(s ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}
export function ageOn(dob, now) {
  const d = parseDate(dob); if (!d) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const md = now.getUTCMonth() - d.getUTCMonth();
  if (md < 0 || (md === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

function checkLast4(v, path, errors) {
  if (v === undefined || v === null || v === '') return false;
  const s = String(v);
  const digits = s.replace(/\D/g, '');
  if (digits.length > 4) errors.push({path, code: 'full_tin_not_allowed', message: 'Only the last 4 digits may be stored; remove the full SSN/EIN/TIN.'});
  else if (!/^\d{4}$/.test(s)) errors.push({path, code: 'invalid_last4', message: 'Must be exactly 4 digits.'});
  return true;
}

function checkName(v, path, errors) {
  if (typeof v !== 'string' || v.trim().length < 2) { errors.push({path, code: 'required', message: 'Name is required (min 2 characters).'}); return; }
  if (v.length > 200) errors.push({path, code: 'too_long', message: 'Name exceeds 200 characters.'});
  if (!/\p{L}/u.test(v)) errors.push({path, code: 'invalid_name', message: 'Name must contain letters.'});
}

function checkCountry(v, path, errors) {
  if (!isCountryCode(v)) errors.push({path, code: 'invalid_country', message: 'Use an ISO 3166-1 alpha-2 code (e.g. US).'});
  else if (v !== v.toUpperCase()) errors.push({path, code: 'country_case', message: 'Country code must be uppercase.'});
}

function checkAddress(a, path, errors) {
  if (!a || typeof a !== 'object') { errors.push({path, code: 'required', message: 'Address is required.'}); return; }
  for (const k of SCHEMA.address.required) if (!a[k] || !String(a[k]).trim()) errors.push({path: `${path}.${k}`, code: 'required', message: `${k} is required.`});
  if (a.country) checkCountry(a.country, `${path}.country`, errors);
  if (a.country === 'US') {
    if (!US_STATES.has(String(a.region || '').toUpperCase())) errors.push({path: `${path}.region`, code: 'invalid_us_state', message: 'US addresses need a 2-letter state code.'});
    if (!/^\d{5}(-\d{4})?$/.test(String(a.postalCode || ''))) errors.push({path: `${path}.postalCode`, code: 'invalid_zip', message: 'US ZIP must be 12345 or 12345-6789.'});
  }
  if (/\bP\.?\s*O\.?\s*Box\b/i.test(String(a.line1 || ''))) errors.push({path: `${path}.line1`, code: 'po_box', message: 'A residential or business street address is required (no PO boxes).'});
}

function checkDob(v, path, errors, cfg, now) {
  const d = parseDate(v);
  if (!d) { errors.push({path, code: 'invalid_date', message: 'Use YYYY-MM-DD.'}); return; }
  if (d > now) { errors.push({path, code: 'future_date', message: 'Date of birth is in the future.'}); return; }
  const age = ageOn(v, now);
  if (age < cfg.min_age_years) errors.push({path, code: 'under_age', message: `Must be at least ${cfg.min_age_years}.`});
  if (age > 120) errors.push({path, code: 'implausible_age', message: 'Age over 120.'});
}

function checkPerson(p, path, errors, warnings, cfg, now, {owner = false} = {}) {
  if (!p || typeof p !== 'object') { errors.push({path, code: 'required', message: 'Person record is required.'}); return; }
  checkName(p.legalName, `${path}.legalName`, errors);
  checkDob(p.dob, `${path}.dob`, errors, cfg, now);
  checkCountry(p.country, `${path}.country`, errors);
  if (p.address) checkAddress(p.address, `${path}.address`, errors);
  if (owner) {
    const pct = Number(p.ownershipPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) errors.push({path: `${path}.ownershipPct`, code: 'invalid_pct', message: 'ownershipPct must be >0 and <=100.'});
    else if (pct < cfg.beneficial_owner_threshold_pct) warnings.push({path: `${path}.ownershipPct`, code: 'below_bo_threshold', message: `Listed owner holds under ${cfg.beneficial_owner_threshold_pct}%; kept for screening.`});
  }
}

/**
 * Validate a KYC intake. Returns {ok, errors[], warnings[]}. Pure; never stores anything.
 */
export function validateCounterparty(cp, {config = loadConfig().kyc, now = new Date()} = {}) {
  const errors = [], warnings = [];
  if (!cp || typeof cp !== 'object') return {ok: false, errors: [{path: '', code: 'required', message: 'Counterparty object required.'}], warnings};
  if (cp.type !== 'individual' && cp.type !== 'business') errors.push({path: 'type', code: 'invalid_type', message: 'type must be "individual" or "business".'});
  const spec = SCHEMA[cp.type] ?? SCHEMA.individual;
  const allowed = new Set([...spec.required, ...spec.optional]);
  for (const k of Object.keys(cp)) if (!allowed.has(k)) errors.push({path: k, code: 'unknown_field', message: `Unknown field "${k}" (unexpected fields are rejected to avoid collecting extra PII).`});
  checkName(cp.legalName, 'legalName', errors);
  if (cp.dba !== undefined && cp.dba !== '') checkName(cp.dba, 'dba', errors);
  checkAddress(cp.address, 'address', errors);
  checkCountry(cp.country, 'country', errors);
  if (cp.address?.country && cp.country && cp.address.country !== cp.country) warnings.push({path: 'country', code: 'address_country_differs', message: 'Country differs from address country.'});
  if (typeof cp.email !== 'string' || !EMAIL.test(cp.email)) errors.push({path: 'email', code: 'invalid_email', message: 'A valid email is required.'});
  if (cp.website !== undefined && cp.website !== '') {
    let u; try { u = new URL(cp.website); } catch { /* invalid */ }
    if (!u || !/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) errors.push({path: 'website', code: 'invalid_url', message: 'website must be an http(s) URL.'});
  }
  if (cp.externalIds !== undefined && (!Array.isArray(cp.externalIds) || cp.externalIds.some((x) => typeof x !== 'string' || !x))) errors.push({path: 'externalIds', code: 'invalid', message: 'externalIds must be an array of strings (e.g. Stripe customer ids).'});
  if (cp.type === 'individual') {
    checkDob(cp.dob, 'dob', errors, config, now);
    checkLast4(cp.tinLast4, 'tinLast4', errors);
  }
  if (cp.type === 'business') {
    const d = parseDate(cp.incorporationDate);
    if (!d) errors.push({path: 'incorporationDate', code: 'invalid_date', message: 'Use YYYY-MM-DD.'});
    else if (d > now) errors.push({path: 'incorporationDate', code: 'future_date', message: 'Incorporation date is in the future.'});
    if (cp.incorporationCountry !== undefined) checkCountry(cp.incorporationCountry, 'incorporationCountry', errors);
    if (!checkLast4(cp.einLast4, 'einLast4', errors)) errors.push({path: 'einLast4', code: 'required', message: 'EIN last 4 is required for businesses.'});
    checkPerson(cp.controlPerson, 'controlPerson', errors, warnings, config, now);
    if (!Array.isArray(cp.beneficialOwners)) errors.push({path: 'beneficialOwners', code: 'required', message: 'beneficialOwners array is required (list every owner of 25% or more).'});
    else {
      if (!cp.beneficialOwners.length && cp.noBeneficialOwnersAttestation !== true) errors.push({path: 'beneficialOwners', code: 'bo_required', message: 'List each 25%+ owner, or set noBeneficialOwnersAttestation: true if no individual owns 25% or more.'});
      cp.beneficialOwners.forEach((o, i) => checkPerson(o, `beneficialOwners[${i}]`, errors, warnings, config, now, {owner: true}));
      const total = cp.beneficialOwners.reduce((s, o) => s + (Number(o?.ownershipPct) || 0), 0);
      if (total > 100.0001) errors.push({path: 'beneficialOwners', code: 'ownership_over_100', message: `Ownership totals ${total}%.`});
      const names = cp.beneficialOwners.map((o) => String(o?.legalName || '').toLowerCase().trim());
      if (new Set(names).size !== names.length) errors.push({path: 'beneficialOwners', code: 'duplicate_owner', message: 'Duplicate beneficial owner.'});
    }
  }
  if (config.require_idv) warnings.push({path: '', code: 'idv_required', message: 'Config requires IDV via a licensed provider before approval.'});
  return {ok: errors.length === 0, errors, warnings};
}

/** Parties that must each be screened before approval. */
export function partiesOf(cp) {
  const type = cp.type === 'business' ? 'business' : 'individual';
  const parties = [{key: 'entity', role: 'counterparty', name: cp.legalName, type, country: cp.country, dob: type === 'individual' ? cp.dob : undefined, ids: cp.ids, countries: [cp.address?.country, cp.incorporationCountry].filter(Boolean)}];
  if (cp.dba) parties.push({key: 'dba', role: 'dba', name: cp.dba, type, country: cp.country, countries: [cp.address?.country].filter(Boolean)});
  if (type === 'business') {
    if (cp.controlPerson) parties.push({key: 'control', role: 'control_person', name: cp.controlPerson.legalName, type: 'individual', country: cp.controlPerson.country, dob: cp.controlPerson.dob, ids: cp.controlPerson.ids});
    (cp.beneficialOwners || []).forEach((o, i) => parties.push({key: `bo${i}`, role: 'beneficial_owner', name: o.legalName, type: 'individual', country: o.country, dob: o.dob, ids: o.ids}));
  }
  return parties;
}
