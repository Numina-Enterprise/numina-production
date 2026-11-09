// Stripe Prohibited & Restricted Businesses as merchant rules for Numina Labs (a consulting practice).
// Source: https://stripe.com/legal/restricted-businesses — page "Last updated: 2026-09-22", fetched 2026-11-09.
// This is a screening checklist over Numina's own offerings and counterparties, not Stripe's decision.
import {fold} from './normalize.mjs';

export const STRIPE_SOURCE = {
  url: 'https://stripe.com/legal/restricted-businesses',
  lastUpdated: '2026-09-22',
  fetchedAt: '2026-11-09',
  maxAgeDays: 180,
};

// Jurisdictions Stripe prohibits outright (persons located/resident/citizens, goods or services from).
export const STRIPE_PROHIBITED_JURISDICTIONS = ['CU', 'IR', 'KP', 'SY'];
export const STRIPE_PROHIBITED_REGIONS = ['crimea', 'donetsk', 'luhansk', 'lugansk', 'sevastopol'];
// Stripe: management consulting, IT consultancy and design, accounting, quantum computing (and more)
// services may not be supplied to any person located in Russia — directly applicable to Numina Labs.
export const STRIPE_CONSULTING_PROHIBITED_TO = ['RU'];

/** Representative categories with keyword patterns (folded, lower-case). P = prohibited, R = restricted. */
export const CATEGORIES = [
  {id: 'p2p_money_transmission', level: 'P', label: 'Peer-to-peer money transmission, money orders, check cashing, shell banks, bearer shares, payable-through accounts', patterns: [/peer[- ]to[- ]peer (money|payment|transfer)/, /money order/, /check cashing/, /shell bank/, /bearer share/, /payable[- ]through account/]},
  {id: 'debt_relief', level: 'P', label: 'Debt settlement / negotiation / consolidation; debt collection', patterns: [/debt (settlement|negotiation|consolidation|relief|collection)/]},
  {id: 'gambling', level: 'P', label: 'Gambling, lotteries, sweepstakes with prizes', patterns: [/gambling/, /casino/, /lotter(y|ies)/, /sweepstake/, /sports betting/]},
  {id: 'crypto_mining_ico', level: 'P', label: 'Crypto mining/staking, ICOs, secondary NFT sales', patterns: [/initial coin offering/, /\bico\b/, /\bstaking\b/, /crypto(currency)? mining/, /nft (resale|secondary)/]},
  {id: 'get_rich_quick', level: 'P', label: 'Get-rich-quick, pyramid/MLM, unrealistic incentives, predatory investment opportunities', patterns: [/get rich/, /guaranteed (return|profit|income)/, /passive income/, /pyramid/, /multi[- ]?level marketing/, /\bmlm\b/]},
  {id: 'credit_repair', level: 'P', label: 'Credit repair and counselling; loan repayments with credit cards', patterns: [/credit repair/, /credit counsel/]},
  {id: 'id_services', level: 'P', label: 'Fake references / ID-providing services; document falsification', patterns: [/fake (id|reference)/, /document falsification/, /novelty id/]},
  {id: 'crypto_exchange', level: 'R', label: 'Cryptocurrency exchanges and wallets', patterns: [/crypto(currency)? (exchange|wallet)/, /\bstablecoin\b/, /\btoken (sale|offering|issuance)\b/, /\bnusd\b/]},
  {id: 'financial_services', level: 'R', label: 'Investment/brokerage, lending, bank account funding, BNPL, money transmitters/MSBs, escrow, neobanks, other financial services', patterns: [/\btreasury\b/, /investment (service|advisory|fund)/, /brokerage/, /\blending\b/, /\bloans?\b/, /escrow/, /money transmi/, /remittance/, /currency exchange/, /neobank/, /buy now,? pay later/, /\bbnpl\b/, /custody/, /settlement service/, /\bach (origination|execution)\b/]},
  {id: 'stored_value', level: 'R', label: 'Stored value, gift cards, credits issued by third parties; in-game currency', patterns: [/stored value/, /gift card/, /prepaid card/, /virtual credits?/]},
  {id: 'payment_facilitation', level: 'R', label: 'Third-party agents: payment facilitation and aggregation', patterns: [/payment facilitat/, /payment aggregat/, /on behalf of (third[- ]party )?sellers/]},
  {id: 'crowdfunding', level: 'R', label: 'Crowdfunding and fundraising', patterns: [/crowdfund/, /fundrais/, /donations?/]},
  {id: 'telemedicine_pharma', level: 'R', label: 'Pharmaceuticals, telemedicine', patterns: [/telemedicine/, /telehealth/, /pharmacy/]},
];

/** Scan offering / marketing text for prohibited (P) or restricted (R) categories. */
export function scanText(text, {source = 'text'} = {}) {
  const t = ` ${fold(text).replace(/\s+/g, ' ')} `;
  const findings = [];
  for (const c of CATEGORIES) for (const p of c.patterns) {
    const m = p.exec(t);
    if (m) { findings.push({category: c.id, level: c.level, label: c.label, match: m[0].trim(), source}); break; }
  }
  return findings;
}

/** Counterparty-level merchant rules (jurisdictions + Russia consulting prohibition). */
export function counterpartyMerchantFindings(cp) {
  const findings = [];
  const parties = [cp, cp.controlPerson, ...(cp.beneficialOwners || [])].filter(Boolean);
  for (const p of parties) {
    const countries = [p.country, p.address?.country, p.incorporationCountry].filter(Boolean);
    for (const c of countries) {
      if (STRIPE_PROHIBITED_JURISDICTIONS.includes(c)) findings.push({rule: 'stripe_prohibited_jurisdiction', level: 'P', country: c, detail: 'Stripe prohibits dealings with persons located in, resident in or citizens of this jurisdiction.'});
      if (STRIPE_CONSULTING_PROHIBITED_TO.includes(c)) findings.push({rule: 'stripe_consulting_to_russia', level: 'P', country: c, detail: 'Stripe prohibits supplying management consulting / IT consultancy services to persons located in Russia.'});
    }
    const addr = fold([p.address?.line1, p.address?.line2, p.address?.city, p.address?.region].filter(Boolean).join(' '));
    for (const r of STRIPE_PROHIBITED_REGIONS) if (addr.includes(r)) findings.push({rule: 'stripe_prohibited_region', level: 'P', region: r, detail: 'Crimea, Donetsk and Luhansk regions are prohibited.'});
  }
  return [...new Map(findings.map((f) => [JSON.stringify(f), f])).values()];
}

export function sourceAgeDays(now = new Date()) {
  return Math.floor((now - new Date(`${STRIPE_SOURCE.lastUpdated}T00:00:00Z`)) / 86_400_000);
}
