// Internal design baseline only. No official NCUA Schedule J account codes are inferred.
// Sources: Federal Register 91 FR 64699 (2026-10-09), OMB 3133-0004.
export const SCHEDULE_J_PROPOSAL = Object.freeze({
  sourceUrl: 'https://www.federalregister.gov/documents/2026/10/09/2026-20729/proposed-agency-information-collection-activities-comment-request',
  publicationDate: '2026-10-09',
  status: 'PROPOSED_INFORMATION_COLLECTION',
  proposedFirstReportingDate: '2027-03-31',
  commentDeadline: '2026-12-08',
  ombControlNumber: '3133-0004',
  respondents: 'FEDERALLY_INSURED_CREDIT_UNIONS',
  numinaApplicability: 'NOT_ESTABLISHED',
});
const CATEGORIES = Object.freeze([
  {prefix: 'RC', count: 8, name: 'Third-party permitted issuer reserve-asset custody',
   fields: ['asset_owner','reserve_custodian','asset_symbol','asset_quantity','source_evidence']},
  {prefix: 'KC', count: 9, name: 'Cryptographic-key custody and control',
   fields: ['key_controller','signing_authority','authorization_evidence','network_chain_id']},
  {prefix: 'IE', count: 5, name: 'Direct permitted-issuer exposure',
   fields: ['issuer','counterparty','exposure_amount','source_evidence']},
  {prefix: 'BS', count: 4, name: 'Balance-sheet payment stablecoins',
   fields: ['legal_entity','asset_symbol','asset_quantity','accounting_classification','reconciliation_status']},
]);
export const SCHEDULE_J_CATEGORIES = CATEGORIES;
export const EVIDENCE_DIMENSIONS = Object.freeze([
  'documentedDesign','implementedControls','independentVerification','legalApplicability',
]);
const emptyStatus = () => ({status: 'NOT_EVIDENCED', reviewer: null, sourceRefs: [], reviewedAt: null});
const assertNonempty = x => typeof x === 'string' && x.trim().length > 0;
const assertDigest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const freezeSnapshot = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freezeSnapshot);
  }
  return value;
};

export function buildScheduleJRegistry() {
  return CATEGORIES.flatMap(category => Array.from({length: category.count}, (_, index) => ({
    internalId: 'SJ-' + category.prefix + '-' + String(index + 1).padStart(2, '0'),
    category: category.name,
    proposedInternalFields: [...category.fields],
    officialAccountCode: null,
    officialDefinition: null,
    officialSource: null,
    accountDefinitionStatus: 'UNVERIFIED',
    regulatoryStatus: SCHEDULE_J_PROPOSAL.status,
    evidence: Object.fromEntries(EVIDENCE_DIMENSIONS.map(key => [key, emptyStatus()])),
  })));
}

// An official field may only be staged after a separately implemented source
// verifier has matched the exact code and definition to an authoritative document.
// Matching a URL string or a caller-supplied "verified" boolean is insufficient.
export async function stageScheduleJMapping(row, candidate, {verifyOfficialSource} = {}) {
  // Preserve exactly what is reviewed, including the row's nested evidence,
  // while the independent verifier retrieves its source asynchronously.
  const rowSnapshot = row ? freezeSnapshot(structuredClone(row)) : null;
  const mapping = Object.freeze({
    internalId: rowSnapshot?.internalId,
    accountCode: candidate?.accountCode,
    definition: candidate?.definition,
    sourceUrl: candidate?.sourceUrl,
    sourceRevision: candidate?.sourceRevision,
    sourceSha256: candidate?.sourceSha256,
  });
  if (!rowSnapshot || rowSnapshot.accountDefinitionStatus !== 'UNVERIFIED' ||
      !/^SJ-(RC|KC|IE|BS)-\d{2}$/.test(mapping.internalId) ||
      !assertNonempty(mapping.accountCode) ||
      !assertNonempty(mapping.definition) ||
      !assertNonempty(mapping.sourceUrl) ||
      !assertNonempty(mapping.sourceRevision) ||
      !assertDigest(mapping.sourceSha256) ||
      typeof verifyOfficialSource !== 'function') {
    throw new Error('OFFICIAL_ACCOUNT_EVIDENCE_REQUIRED');
  }
  const verification = await verifyOfficialSource(mapping);
  if (verification?.authority !== 'NCUA' ||
      verification?.exactMatch !== true ||
      verification?.independentlyRetrieved !== true ||
      verification?.sourceSha256 !== mapping.sourceSha256) {
    throw new Error('OFFICIAL_ACCOUNT_SOURCE_NOT_VERIFIED');
  }
  return {
    ...rowSnapshot,
    officialAccountCode: mapping.accountCode,
    officialDefinition: mapping.definition,
    officialSource: {
      url: mapping.sourceUrl,
      revision: mapping.sourceRevision,
      sha256: mapping.sourceSha256,
    },
    accountDefinitionStatus: 'SOURCE_MATCHED_PENDING_REVIEW',
  };
}

// Distinct assertions remain distinct even when their internal journal shares
// one singular treasury identity. Never elevate a software reference to a bank,
// provider, reserve, or blockchain attestation.
export const TREASURY_ASSERTION_TYPES = Object.freeze([
  'ASSET_OWNERSHIP', 'TOKEN_ISSUANCE', 'RESERVE_BACKING',
  'NATIVE_LEDGER_BALANCE', 'EXTERNAL_PROVIDER_BALANCE',
  'ONCHAIN_FINALITY', 'PROVIDER_SETTLEMENT', 'RECONCILIATION',
]);
export function recordTreasuryAssertion(kind, {sourceClass, reference, recordedAt} = {}) {
  if (!TREASURY_ASSERTION_TYPES.includes(kind)) throw new Error('UNKNOWN_ASSERTION_TYPE');
  // Do not let a caller label its own record "independently verified". An independently
  // verified receipt belongs in a separately trusted verification pipeline.
  if (!['INTERNAL_SOFTWARE', 'PROVIDER_OBSERVATION'].includes(sourceClass) ||
      !assertNonempty(reference) || !assertNonempty(recordedAt)) {
    throw new Error('EVIDENCE_PROVENANCE_REQUIRED');
  }
  return Object.freeze({
    kind, sourceClass, reference, recordedAt,
    independentlyVerified: false,
    reconciliationStatus: 'NOT_RECONCILED',
  });
}
