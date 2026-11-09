import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCounterparty, partiesOf, ageOn} from '../../local/compliance/lib/kyc-schema.mjs';
import {fakeBusiness, fakeIndividual} from '../../local/compliance/lib/synthetic.mjs';

const now = new Date('2026-11-09T12:00:00Z');
const v = (cp) => validateCounterparty(cp, {now, config: {min_age_years: 18, beneficial_owner_threshold_pct: 25, require_idv: false}});
const codes = (r) => r.errors.map((e) => `${e.path}:${e.code}`);

test('valid individual and business intakes pass', () => {
  assert.deepEqual(v(fakeIndividual()).errors, []);
  assert.deepEqual(v(fakeBusiness()).errors, []);
});

test('required fields and type', () => {
  assert.ok(codes(v({type: 'other'})).includes('type:invalid_type'));
  const r = v({type: 'individual'});
  for (const c of ['legalName:required', 'address:required', 'country:invalid_country', 'email:invalid_email', 'dob:invalid_date']) assert.ok(codes(r).includes(c), c);
  const b = v({...fakeBusiness(), einLast4: undefined, controlPerson: undefined, beneficialOwners: undefined});
  for (const c of ['einLast4:required', 'controlPerson:required', 'beneficialOwners:required']) assert.ok(codes(b).includes(c), c);
});

test('unknown fields are rejected (data minimisation)', () => {
  assert.ok(codes(v({...fakeIndividual(), ssn: '000000000'})).includes('ssn:unknown_field'));
});

test('TIN/EIN: last 4 digits only, full numbers refused', () => {
  assert.ok(codes(v(fakeIndividual({tinLast4: '123456789'}))).includes('tinLast4:full_tin_not_allowed'));
  assert.ok(codes(v(fakeIndividual({tinLast4: '12a4'}))).includes('tinLast4:invalid_last4'));
  assert.ok(codes(v(fakeBusiness({einLast4: '00-0000000'}))).includes('einLast4:full_tin_not_allowed'));
});

test('dates, age and incorporation date', () => {
  assert.equal(ageOn('2008-11-10', now), 17);
  assert.equal(ageOn('2008-11-09', now), 18);
  assert.ok(codes(v(fakeIndividual({dob: '2010-01-01'}))).includes('dob:under_age'));
  assert.ok(codes(v(fakeIndividual({dob: '2027-01-01'}))).includes('dob:future_date'));
  assert.ok(codes(v(fakeIndividual({dob: '1985-02-30'}))).includes('dob:invalid_date'));
  assert.ok(codes(v(fakeIndividual({dob: '1890-01-01'}))).includes('dob:implausible_age'));
  assert.ok(codes(v(fakeBusiness({incorporationDate: '2030-01-01'}))).includes('incorporationDate:future_date'));
});

test('country codes, US state/ZIP, PO boxes, email and website formats', () => {
  assert.ok(codes(v(fakeIndividual({country: 'USA'}))).includes('country:invalid_country'));
  assert.ok(codes(v(fakeIndividual({country: 'us'}))).length > 0);
  const addr = {line1: 'PO Box 12', city: 'Madison', region: 'ZZ', postalCode: '5370', country: 'US'};
  const c = codes(v(fakeIndividual({address: addr})));
  for (const x of ['address.region:invalid_us_state', 'address.postalCode:invalid_zip', 'address.line1:po_box']) assert.ok(c.includes(x), x);
  assert.ok(codes(v(fakeIndividual({email: 'not-an-email'}))).includes('email:invalid_email'));
  assert.ok(codes(v(fakeIndividual({website: 'ftp://x.example'}))).includes('website:invalid_url'));
  assert.deepEqual(v(fakeIndividual({address: {line1: '1 Rue Exemple', city: 'Paris', country: 'FR'}, country: 'FR'})).errors, []);
  assert.ok(v(fakeIndividual({country: 'CA'})).warnings.some((w) => w.code === 'address_country_differs'));
});

test('beneficial owners: 25%+ rule, totals, duplicates, attestation, owner age', () => {
  assert.ok(codes(v(fakeBusiness({beneficialOwners: []}))).includes('beneficialOwners:bo_required'));
  assert.deepEqual(v(fakeBusiness({beneficialOwners: [], noBeneficialOwnersAttestation: true})).errors, []);
  const over = fakeBusiness({beneficialOwners: [{legalName: 'A Example', dob: '1980-01-01', country: 'US', ownershipPct: 70}, {legalName: 'B Example', dob: '1980-01-01', country: 'US', ownershipPct: 40}]});
  assert.ok(codes(v(over)).includes('beneficialOwners:ownership_over_100'));
  const dup = fakeBusiness({beneficialOwners: [{legalName: 'A Example', dob: '1980-01-01', country: 'US', ownershipPct: 30}, {legalName: 'a example', dob: '1980-01-01', country: 'US', ownershipPct: 30}]});
  assert.ok(codes(v(dup)).includes('beneficialOwners:duplicate_owner'));
  const small = v(fakeBusiness({beneficialOwners: [{legalName: 'A Example', dob: '1980-01-01', country: 'US', ownershipPct: 10}]}));
  assert.ok(small.warnings.some((w) => w.code === 'below_bo_threshold'));
  const minor = v(fakeBusiness({beneficialOwners: [{legalName: 'A Example', dob: '2015-01-01', country: 'US', ownershipPct: 30}]}));
  assert.ok(codes(minor).includes('beneficialOwners[0].dob:under_age'));
  assert.ok(codes(v(fakeBusiness({beneficialOwners: [{legalName: 'A Example', dob: '1980-01-01', country: 'US', ownershipPct: 0}]}))).includes('beneficialOwners[0].ownershipPct:invalid_pct'));
});

test('partiesOf lists the entity, DBA, control person and every beneficial owner for screening', () => {
  const p = partiesOf(fakeBusiness());
  assert.deepEqual(p.map((x) => x.key), ['entity', 'dba', 'control', 'bo0', 'bo1']);
  assert.equal(p[0].type, 'business');
  assert.equal(p[4].type, 'individual');
  assert.equal(p[4].dob, '1970-01-01');
  assert.deepEqual(partiesOf(fakeIndividual()).map((x) => x.key), ['entity']);
});
