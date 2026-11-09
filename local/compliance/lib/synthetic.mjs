// Synthetic, clearly fake fixtures for the self-check and tests. No real persons, entities or sanctions data.
export const FAKE_LISTS = {
  SDN: {
    primary: [
      '9000001,"FAKEMAN, Ivan Testovich","individual","ZZ-TEST] [ZZ-FAKE",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 01 Jan 1970; POB Testgrad, Russia; nationality Russia; Passport ZZ1234567 (Russia); a.k.a. \'TESTY\'."',
      '9000002,"ZZFAKE TRADING CO., LTD.",-0- ,"ZZ-FAKE",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"Registration Number ZZREG0001 (Russia); Linked To: FAKEMAN, Ivan Testovich."',
      '9000003,"AL-FAKIRI, Abu Testah","individual","ZZ-FAKE",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 1965; nationality Iran."',
      '9000004,"MUELLERFAKE, Joerg","individual","ZZ-TEST",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 12 Mar 1980; nationality Germany."',
      '9000005,"TESTVESSEL FAKESTAR",vessel,"ZZ-FAKE",-0- ,"ZZCALL",-0- ,-0- ,-0- ,"Panama",-0- ,"IMO 0000001."',
    ].join('\r\n') + '\r\n\x1a',
    alt: [
      '9000001,1,"aka","FEYKMAN, Ivan",-0- ',
      '9000002,2,"fka","ZZFAKE IMPEX GMBH",-0- ',
      '9000003,3,"aka","AL FAKIRI, Abou Testa",-0- ',
      '9000004,4,"aka","MÜLLERFAKE, Jörg",-0- ',
    ].join('\r\n') + '\r\n',
    address: [
      '9000002,10,"1 Fake Street","Testgrad","Russia",-0- ',
      '9000004,11,-0- ,"Berlin","Germany",-0- ',
    ].join('\r\n') + '\r\n',
  },
  CONS: {
    primary: '9100001,"TESTOVA, Fakeya","individual","ZZ-NS-TEST",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 1990; nationality Belarus."\r\n',
    alt: '9100001,20,"aka","TESTOVA, Fakeia",-0- \r\n',
    address: '9100001,21,-0- ,"Testsk","Belarus",-0- \r\n',
  },
};

export const FAKE_MANIFEST = {version: 'SYNTHETIC@2026-11-09#selfcheck', fetchedAt: new Date().toISOString(), publicationDate: '2026-11-09', files: []};

/** A valid fake business intake whose beneficial owner collides with a synthetic SDN entry. */
export function fakeBusiness(overrides = {}) {
  return {
    type: 'business', legalName: 'Fakeco Consulting LLC', dba: 'Fakeco Labs',
    address: {line1: '100 Example Ave', city: 'Springfield', region: 'IL', postalCode: '62701', country: 'US'},
    country: 'US', incorporationDate: '2019-04-01', incorporationCountry: 'US', einLast4: '0000', email: 'ops@fakeco.example', website: 'https://fakeco.example',
    externalIds: ['cus_FAKE_A'],
    controlPerson: {legalName: 'Jane Q Example', dob: '1980-02-02', country: 'US', title: 'CEO'},
    beneficialOwners: [{legalName: 'Jane Q Example', dob: '1980-02-02', country: 'US', ownershipPct: 60}, {legalName: 'Ivan Testovich Fakeman', dob: '1970-01-01', country: 'RU', ownershipPct: 30}],
    ...overrides,
  };
}
export function fakeIndividual(overrides = {}) {
  return {type: 'individual', legalName: 'John Q Placeholder', address: {line1: '1 Sample Rd', city: 'Madison', region: 'WI', postalCode: '53703', country: 'US'},
    country: 'US', dob: '1985-06-15', tinLast4: '1234', email: 'john@placeholder.example', externalIds: ['cus_FAKE_I'], ...overrides};
}

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const d = (days, hours = 0) => new Date(T0 + days * 86_400_000 + hours * 3_600_000).toISOString();

/** Payments that exercise every AML rule. */
export function fakePayments() {
  return [
    // structuring + threshold_adjacent + payer_mismatch + geography_mismatch (cus_FAKE_A, KYC'd as Fakeco, US)
    {id: 'py_a1', amount: 9500, currency: 'USD', timestamp: d(0), counterpartyId: 'cus_FAKE_A', method: 'card', country: 'US', payerName: 'Fakeco Consulting LLC'},
    {id: 'py_a2', amount: 9800, currency: 'USD', timestamp: d(2), counterpartyId: 'cus_FAKE_A', method: 'card', country: 'US', payerName: 'Fakeco Labs'},
    {id: 'py_a3', amount: 9900, currency: 'USD', timestamp: d(4), counterpartyId: 'cus_FAKE_A', method: 'card', country: 'CA', ipCountry: 'BR', payerName: 'Totally Unrelated Person'},
    // round amounts + kyc_not_approved (cus_FAKE_B)
    {id: 'py_b1', amount: 2000, currency: 'USD', timestamp: d(-30), counterpartyId: 'cus_FAKE_B', method: 'ach', country: 'US'},
    {id: 'py_b2', amount: 4000, currency: 'USD', timestamp: d(-20), counterpartyId: 'cus_FAKE_B', method: 'ach', country: 'US'},
    {id: 'py_b3', amount: 6000, currency: 'USD', timestamp: d(-10), counterpartyId: 'cus_FAKE_B', method: 'ach', country: 'US'},
    // velocity + amount spike (cus_FAKE_C)
    {id: 'py_c0', amount: 1500, currency: 'USD', timestamp: d(-70), counterpartyId: 'cus_FAKE_C', country: 'US'},
    {id: 'py_c1', amount: 1500, currency: 'USD', timestamp: d(-50), counterpartyId: 'cus_FAKE_C', country: 'US'},
    {id: 'py_c2', amount: 1500, currency: 'USD', timestamp: d(-30), counterpartyId: 'cus_FAKE_C', country: 'US'},
    {id: 'py_c3', amount: 1450, currency: 'USD', timestamp: d(0), counterpartyId: 'cus_FAKE_C', country: 'US'},
    {id: 'py_c4', amount: 1550, currency: 'USD', timestamp: d(1), counterpartyId: 'cus_FAKE_C', country: 'US'},
    {id: 'py_c5', amount: 1525, currency: 'USD', timestamp: d(2), counterpartyId: 'cus_FAKE_C', country: 'US'},
    {id: 'py_c6', amount: 15200, currency: 'USD', timestamp: d(3), counterpartyId: 'cus_FAKE_C', country: 'US'},
    // high-risk jurisdiction + sanctions hit (cus_FAKE_D)
    {id: 'py_d1', amount: 1500, currency: 'USD', timestamp: d(0), counterpartyId: 'cus_FAKE_D', country: 'IR'},
    // refund / chargeback churn (cus_FAKE_E)
    {id: 'py_e1', amount: 1500, currency: 'USD', timestamp: d(0), counterpartyId: 'cus_FAKE_E', country: 'US'},
    {id: 'py_e2', amount: 1500, currency: 'USD', timestamp: d(1), counterpartyId: 'cus_FAKE_E', country: 'US'},
    {id: 'py_e3', amount: 1500, currency: 'USD', timestamp: d(2), counterpartyId: 'cus_FAKE_E', country: 'US'},
    {id: 'py_e4', amount: 1500, currency: 'USD', timestamp: d(10), counterpartyId: 'cus_FAKE_E', type: 'chargeback', timestampApprox: true},
    {id: 'py_e5', amount: 1500, currency: 'USD', timestamp: d(11), counterpartyId: 'cus_FAKE_E', type: 'chargeback', timestampApprox: true},
    // rapid in-and-out (cus_FAKE_F)
    {id: 'py_f1', amount: 4000, currency: 'USD', timestamp: d(0), counterpartyId: 'cus_FAKE_F', country: 'US'},
    {id: 'py_f2', amount: 3950, currency: 'USD', timestamp: d(0, 5), counterpartyId: 'cus_FAKE_F', type: 'refund'},
    // fan-in: many payers to one payee (inv_FAKE_1)
    {id: 'py_g1', amount: 1500, currency: 'USD', timestamp: d(0), counterpartyId: 'cus_FAKE_G', payeeId: 'inv_FAKE_1', fingerprint: 'fp_1', country: 'US'},
    {id: 'py_g2', amount: 1500, currency: 'USD', timestamp: d(1), counterpartyId: 'cus_FAKE_G', payeeId: 'inv_FAKE_1', fingerprint: 'fp_2', country: 'US'},
    {id: 'py_g3', amount: 1500, currency: 'USD', timestamp: d(2), counterpartyId: 'cus_FAKE_G', payeeId: 'inv_FAKE_1', fingerprint: 'fp_3', country: 'US'},
    // dormant then active (cus_FAKE_H)
    {id: 'py_h1', amount: 1500, currency: 'USD', timestamp: d(-400), counterpartyId: 'cus_FAKE_H', country: 'US'},
    {id: 'py_h2', amount: 7500, currency: 'USD', timestamp: d(-5), counterpartyId: 'cus_FAKE_H', country: 'US'},
    // unconverted currency (cus_FAKE_A)
    {id: 'py_a4', amount: 1200, currency: 'EUR', timestamp: d(5), counterpartyId: 'cus_FAKE_A', country: 'US', payerName: 'Fakeco Consulting LLC'},
  ];
}

export function fakeKycMap() {
  return new Map([
    ['cus_FAKE_A', {status: 'approved', screeningDecision: 'clear', names: ['Fakeco Consulting LLC', 'Fakeco Labs', 'Jane Q Example'], countries: ['US']}],
    ['cus_FAKE_B', {status: 'needs_review', screeningDecision: 'clear', names: ['Placeholder B LLC'], countries: ['US']}],
    ['cus_FAKE_C', {status: 'approved', screeningDecision: 'clear', names: ['Placeholder C'], countries: ['US']}],
    ['cus_FAKE_D', {status: 'needs_review', screeningDecision: 'potential_match', names: ['Placeholder D'], countries: ['US']}],
    ['cus_FAKE_E', {status: 'approved', screeningDecision: 'clear', names: ['Placeholder E'], countries: ['US']}],
    ['cus_FAKE_F', {status: 'approved', screeningDecision: 'clear', names: ['Placeholder F'], countries: ['US']}],
    ['cus_FAKE_H', {status: 'approved', screeningDecision: 'clear', names: ['Placeholder H'], countries: ['US']}],
  ]);
}

export const EXPECTED_RULES = ['structuring', 'threshold_adjacent', 'payer_mismatch', 'geography_mismatch', 'round_amount', 'kyc_not_approved', 'velocity',
  'amount_spike', 'high_risk_jurisdiction', 'sanctions_hit', 'refund_churn', 'rapid_in_out', 'fan_in', 'dormant_then_active', 'no_kyc', 'unconverted_currency'];
