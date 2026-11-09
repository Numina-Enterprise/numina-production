import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {scanText, counterpartyMerchantFindings, STRIPE_SOURCE, sourceAgeDays, CATEGORIES} from '../../local/compliance/lib/merchant-rules.mjs';
import {fakeBusiness, fakeIndividual} from '../../local/compliance/lib/synthetic.mjs';

test('Stripe source is recorded with its own last-updated date', () => {
  assert.equal(STRIPE_SOURCE.url, 'https://stripe.com/legal/restricted-businesses');
  assert.equal(STRIPE_SOURCE.lastUpdated, '2026-09-22');
  assert.equal(sourceAgeDays(new Date('2026-11-09T00:00:00Z')), 48);
  assert.ok(CATEGORIES.every((c) => ['P', 'R'].includes(c.level)));
});

test('consulting offering text is clean; prohibited and restricted language is flagged', () => {
  assert.deepEqual(scanText('AI consulting: $1,500 diagnostic, optional $7,500 implementation.'), []);
  const f = (t) => scanText(t).map((x) => `${x.level}:${x.category}`);
  assert.ok(f('Join our initial coin offering').includes('P:crypto_mining_ico'));
  assert.ok(f('Guaranteed returns, passive income!').includes('P:get_rich_quick'));
  assert.ok(f('NUSD stablecoin native treasury').includes('R:crypto_exchange'));
  assert.ok(f('Treasury and escrow settlement services').includes('R:financial_services'));
  assert.ok(f('peer-to-peer money transfers').includes('P:p2p_money_transmission'));
  assert.ok(f('We act as a payment facilitator').includes('R:payment_facilitation'));
});

test('counterparty rules: Stripe prohibited jurisdictions, regions and consulting to Russia', () => {
  assert.deepEqual(counterpartyMerchantFindings(fakeIndividual()), []);
  assert.equal(counterpartyMerchantFindings(fakeIndividual({country: 'IR', address: {line1: 'x', city: 'y', country: 'IR'}}))[0].rule, 'stripe_prohibited_jurisdiction');
  assert.ok(counterpartyMerchantFindings(fakeIndividual({address: {line1: '1 Test St', city: 'Sevastopol, Crimea', country: 'UA'}, country: 'UA'})).some((x) => x.rule === 'stripe_prohibited_region'));
  assert.ok(counterpartyMerchantFindings(fakeBusiness()).some((x) => x.rule === 'stripe_consulting_to_russia'), 'a 30% owner located in Russia');
});
