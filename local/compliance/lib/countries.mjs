// ISO 3166-1 alpha-2 codes and name matching helpers for OFAC address / nationality text.
import {fold} from './normalize.mjs';

export const ISO_ALPHA2 = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM ' +
  'GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT ' +
  'LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN ' +
  'PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));

export const isCountryCode = (c) => typeof c === 'string' && ISO_ALPHA2.has(c.toUpperCase()) && c.length === 2;

// Names OFAC uses that differ from the CLDR English short name.
const OFAC_ALIASES = {
  KP: ['korea, north', 'north korea', 'democratic peoples republic of korea'], KR: ['korea, south', 'south korea'],
  RU: ['russia', 'russian federation'], IR: ['iran'], SY: ['syria'], VE: ['venezuela'], BO: ['bolivia'], TZ: ['tanzania'],
  CD: ['congo, democratic republic of the', 'democratic republic of the congo'], CG: ['congo, republic of the'],
  PS: ['palestinian', 'west bank', 'gaza', 'palestinian territories'], MM: ['burma', 'myanmar'], CI: ["cote d ivoire", 'ivory coast'],
  GB: ['united kingdom', 'uk', 'great britain'], US: ['united states', 'usa'], AE: ['united arab emirates', 'uae'],
  MK: ['north macedonia', 'macedonia'], CZ: ['czech republic', 'czechia'], TR: ['turkey', 'turkiye'], LA: ['laos'], VN: ['vietnam'],
  MD: ['moldova'], BY: ['belarus'], UA: ['ukraine', 'crimea'], CV: ['cabo verde', 'cape verde'], SZ: ['eswatini', 'swaziland'],
};

let displayNames;
try { displayNames = new Intl.DisplayNames(['en'], {type: 'region'}); } catch { displayNames = null; }

const simple = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

export function countryNames(code) {
  const c = String(code || '').toUpperCase();
  const names = new Set((OFAC_ALIASES[c] || []).map(simple));
  const dn = displayNames?.of(c);
  if (dn && dn !== c) names.add(simple(dn));
  return [...names];
}

/** True when free text (an OFAC address country or a remark) refers to the ISO country. */
export function textMentionsCountry(text, code) {
  const t = ` ${simple(text)} `;
  return countryNames(code).some((n) => n && t.includes(` ${n} `));
}

let nameIndex;
/** Resolve free text like "Iran" or "Korea, North" to an ISO code, else null. */
export function countryCodeFromText(text) {
  const t = simple(text);
  if (!t) return null;
  if (!nameIndex) {
    nameIndex = new Map();
    for (const code of ISO_ALPHA2) for (const n of countryNames(code)) if (!nameIndex.has(n)) nameIndex.set(n, code);
  }
  return nameIndex.get(t) ?? null;
}
