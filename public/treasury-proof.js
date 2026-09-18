// Checks internal record consistency. Trust in the source and current journal ancestry
// still comes from the authenticated server; a SHA-256 digest is not a signature.
const treasuryHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const treasuryText = value => typeof value === 'string' && value.length > 0;
const treasuryRevision = value => Number.isSafeInteger(value) && value >= 0;
// Release metadata describes these checks and binds the exact distributed bytes.
// It does not attest the server, a provider balance, or a deployment.
export function treasuryClientVerificationManifest(verifierSha256) {
  if (!treasuryHash(verifierSha256)) throw Error('Invalid treasury verifier SHA-256');
  return {
    schema: 'numina.treasury.client-verification.v2',
    identity: 'NUMINA',
    treasuryIdentity: 'NUMINA',
    transportVerificationChannel: 'NUMINA',
    separateRoles: true,
    singularIdentity: true,
    canonicalTreasury: '/api/control/v1/treasury',
    accountView: '/api/control/v2/treasury/accounts',
    accountAlignmentSchema: 'numina.treasury.account-view.v2',
    verifier: {browser: '/treasury-proof.js', integration: 'src/treasury-proof.js', sha256: verifierSha256},
    checks: ['canonical_journal_record', 'shared_native_projection', 'revision_and_head',
      'distinct_account_groups', 'source_reference_membership', 'retained_provider_identity_and_ownership_claims',
      'superseded_references', 'funding_view_source_consistency'],
    verificationScope: 'authenticated_response_internal_consistency',
    independentProviderVerification: false,
    financialExecutionEnabled: false
  };
}
function treasuryCanonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(treasuryCanonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + treasuryCanonical(value[key])).join(',') + '}';
  throw Error('Invalid canonical JSON');
}
async function treasuryDigest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(treasuryCanonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyTreasuryRecord(data, {allowUninitialized = false} = {}) {
  try {
    if (data?.schema !== 'numina.treasury.v1' || data.route !== 'numina.treasury.v1' || data.root !== 'NUMINA' || data.manifest !== 'NUMINA' || data.identity !== 'NUMINA' || data.authority !== 'NUMINA' || data.source !== 'NUMINA' || data.evidence !== 'NUMINA' || data.provider !== 'NUMINA' || data.provider_verification !== true || !treasuryText(data.principal) || !treasuryHash(data.head) || !treasuryRevision(data.revision) || data.verification_scope !== 'Numina-native model and journal integrity') return false;
    if (data.status === 'NOT_INITIALIZED') return allowUninitialized && data.projection === null && data.canonical_proof === null;
    if (data.status !== 'READY') return false;
    const p = data.projection, proof = data.canonical_proof, event = proof?.event, command = event?.command;
    if (p?.schema !== 'numina.treasury.projection.v1' || p.unit !== 'NUSD' || p.authority !== 'NUMINA' || p.verification !== 'VERIFIED' || p.system_of_record !== 'NUMINA' || p.scope !== 'Numina-native' || typeof p.balance !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(p.balance) || !treasuryText(p.last_event_id) || !Array.isArray(p.transaction_requests) || p.transaction_requests.length > 100) return false;
    if (proof?.algorithm !== 'SHA-256' || proof.canonicalization !== 'Numina canonical JSON' || proof.scope !== 'Numina-native journal record' || !treasuryHash(proof.hash)) return false;
    const manifestHash = event?.manifestHash ?? event?.['stateHash']; // historical receipt compatibility only
    if (event?.type !== 'treasury' || event.id !== p.last_event_id || event.actor !== data.principal || !treasuryText(event.actor) || !treasuryRevision(event.revision) || event.revision < 1 || event.revision > data.revision || !treasuryHash(event.previous) || !treasuryHash(manifestHash)) return false;
    if (command?.type !== 'treasury' || command.id !== event.id || command.expectedRevision !== event.revision - 1 || command.data?.expectedHead !== event.previous || command.data.Principal !== event.actor || command.data.Authority !== 'NUMINA') return false;
    if (event.result?.outcome !== 'FINAL' || event.result.route !== data.route || event.result.execution_scope !== 'Numina-native journal' || event.result.mint_event !== null || event.result.bank_transaction !== null || treasuryCanonical(p) !== treasuryCanonical(event.result.projection)) return false;
    if (await treasuryDigest(command) !== event.commandHash || await treasuryDigest(event) !== proof.hash) return false;
    // Other journal operations may advance the head after the last treasury event.
    return event.revision !== data.revision || data.head === proof.hash;
  } catch { return false; }
}

// Account rows are a read-only grouping of the retained references. Checking the
// balance alone must not let duplicate rows or changed ownership claims pass.
function treasuryAccountSourcesMatch(view) {
  const references = view.accountReferences, groups = new Map(), byId = new Map();
  if (!Array.isArray(references) || !Array.isArray(view.supersededReferences)) return false;
  const identity = account => account.providerAccountReference
    ? treasuryCanonical([account.provider, account.legalEntity, account.providerAccountReference])
    : treasuryCanonical(['unresolved', account.id]);
  for (const reference of references) {
    if (!reference || !treasuryText(reference.id) || byId.has(reference.id) || !treasuryText(reference.provider) || !treasuryText(reference.legalEntity)) return false;
    byId.set(reference.id, reference);
    if (reference.supersededBy) continue;
    const key = identity(reference);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(reference);
  }
  const superseded = references.filter(reference => reference.supersededBy);
  if (treasuryCanonical(view.supersededReferences) !== treasuryCanonical(superseded)) return false;
  const count = references.length - superseded.length, alignment = view.accountAlignment;
  if (alignment?.schema !== 'numina.treasury.account-view.v2' || alignment.identity !== 'NUMINA' || alignment.treasuryIdentity !== 'NUMINA' || alignment.separateRoles !== true || alignment.singularIdentity !== true || alignment.transportVerificationChannel !== 'NUMINA' || alignment.sourceReferenceCount !== count || alignment.distinctAccountViews !== groups.size || alignment.duplicateReferenceCount !== count - groups.size || alignment.storedReferencesChanged !== false || alignment.aggregation !== 'one NUMINA treasury; role views do not add balances' || view.accounts.length !== groups.size) return false;
  const derived = new Set(['sourceReferences', 'labelConflict', 'treasuryRef', 'nativeTreasuryRoute', 'treasuryIdentity', 'treasuryRole', 'transportVerificationChannel', 'providerObservationOnly', 'sharedNativeProjection', 'sharedNativeTreasury', 'allocatedAmount']);
  const sourceFields = ['id', 'accountLabel', 'provider', 'providerAccountReference'], seen = new Set();
  for (const account of view.accounts) {
    const original = byId.get(account?.id);
    if (!original || original.supersededBy) return false;
    const key = identity(original), sources = groups.get(key);
    if (seen.has(key)) return false;
    seen.add(key);
    // All non-derived fields retain the original owner designation, including
    // provider identity, labels, observations and providerOwnershipVerified.
    for (const field of new Set([...Object.keys(original), ...Object.keys(account)])) {
      if (derived.has(field)) continue;
      if (Object.hasOwn(original, field) !== Object.hasOwn(account, field) || treasuryCanonical(original[field]) !== treasuryCanonical(account[field])) return false;
    }
    if (!Array.isArray(account.sourceReferences) || account.sourceReferences.length !== sources.length || account.labelConflict !== (new Set(sources.map(source => source.accountLabel)).size > 1)) return false;
    const sourceIds = new Set();
    for (const source of account.sourceReferences) {
      if (!source || sourceIds.has(source.id) || Object.keys(source).some(field => !sourceFields.includes(field))) return false;
      const originalSource = byId.get(source.id);
      if (!originalSource || originalSource.supersededBy || identity(originalSource) !== key || sourceFields.some(field => source[field] !== originalSource[field])) return false;
      sourceIds.add(source.id);
    }
  }
  return seen.size === groups.size;
}

export async function verifyTreasuryAccountView(view) {
  try {
    if (view?.schema !== 'numina.treasury.alignment.v2' || view.identity !== 'NUMINA' || view.treasuryIdentity !== 'NUMINA' || view.transportVerificationChannel !== 'NUMINA' || !await verifyTreasuryRecord(view?.treasury, {allowUninitialized: true}) || !Array.isArray(view.accounts)) return false;
    if (!treasuryAccountSourcesMatch(view)) return false;
    const t = view.treasury, p = t.projection, ref = view.canonicalTreasury, funding = view.nativeFundingView;
    const route = '/api/control/v1/treasury', evidenceRoute = '/api/control/v2/treasury/evidence';
    if (funding?.schema !== 'numina.treasury.native-funding-view.v2' || funding.identity !== 'NUMINA' || funding.treasuryIdentity !== 'NUMINA' || funding.transportVerificationChannel !== 'NUMINA' || funding.singular !== true || funding.head !== t.head || funding.revision !== t.revision || funding.treasuryProjectionChanged !== false || funding.verificationScope !== t.verification_scope) return false;
    const plan = view.fundingPlan, declaration = view.fundingDeclaration, ownerDeclared = declaration?.FUNDED_PLAN === true;
    if (funding.status !== (ownerDeclared ? 'FUNDED_PLAN' : plan?.status ?? 'NOT_RECORDED') || funding.statusBasis !== (ownerDeclared ? 'native_owner_declaration' : 'recorded_plan') || funding.ownerDeclaredFunded !== ownerDeclared) return false;
    if (funding.recordedPlanStatus !== (plan?.status ?? null) || funding.recordedPlanEventId !== (plan?.eventId ?? null) || funding.ownerDeclarationEventId !== (declaration?.eventId ?? null)) return false;
    if (treasuryCanonical(funding.confirmedExternalFunding) !== treasuryCanonical(plan?.confirmedFunding ?? null) || treasuryCanonical(funding.externalReceipt) !== treasuryCanonical(plan?.externalReceipt ?? null)) return false;
    if (p) {
      if (ref?.schema !== 'numina.treasury.canonical-reference.v2' || ref.identity !== 'NUMINA' || ref.treasuryIdentity !== 'NUMINA' || ref.transportVerificationChannel !== 'NUMINA' || ref.id !== 'numina:treasury:' + encodeURIComponent(t.root) || ref.root !== t.root || ref.head !== t.head || ref.revision !== t.revision || ref.route !== route || ref.evidence?.route !== evidenceRoute) return false;
      if (ref.native?.amount !== p.balance || ref.native.unit !== p.unit || ref.native.eventId !== p.last_event_id || ref.native.verificationScope !== t.verification_scope || ref.accounting?.balanceCount !== 1 || ref.accounting.providerCurrenciesCombined !== false || ref.accounting.providerBalancesChanged !== false) return false;
      const valuation = view.nativeValuation;
      if (valuation?.schema !== 'numina.treasury.declared-value.v2' || valuation.identity !== 'NUMINA' || valuation.treasuryIdentity !== 'NUMINA' || valuation.transportVerificationChannel !== 'NUMINA' || valuation.amount !== p.balance || valuation.unit !== 'USD' || valuation.basis !== 'owner_authorized_denomination_policy' || valuation.sharedAcrossAccounts !== true || valuation.providerBalance !== false || valuation.executableConversionVerified !== false || valuation.rate?.base !== 'NUSD' || valuation.rate.quote !== 'USD' || valuation.rate.numerator !== '1' || valuation.rate.denominator !== '1') return false;
      if (Object.hasOwn(valuation,'denominations')) {
        const values=valuation.denominations,units=['NUSD','USDC','USD'];
        if (!Array.isArray(values)||values.length!==units.length) return false;
        for (let i=0;i<units.length;i++) {
          const value=values[i],rate=value?.rate;
          if (!value||Object.keys(value).sort().join(',')!=='amount,amountBasis,rate,unit'||value.unit!==units[i]||value.amount!==p.balance||value.amountBasis!=='whole_units') return false;
          if (!rate||Object.keys(rate).sort().join(',')!=='base,denominator,numerator,quote'||rate.base!=='NUSD'||rate.quote!==value.unit||rate.numerator!=='1'||rate.denominator!=='1') return false;
        }
      }
      if (funding.nativeTarget?.amount !== p.balance || funding.nativeTarget.unit !== p.unit || funding.nativeTarget.sharedAcrossAccounts !== true) return false;
    } else if (ref !== null || view.nativeValuation !== null || funding.nativeTarget !== null) return false;
    for (const account of view.accounts) {
      if (account.nativeTreasuryRoute !== route || account.treasuryIdentity !== 'NUMINA' || account.treasuryRole !== 'evidence_view' || account.transportVerificationChannel !== 'NUMINA' || account.providerObservationOnly !== true || account.sharedNativeProjection !== true || account.allocatedAmount !== null) return false;
      if (!p) { if (account.treasuryRef !== null || account.sharedNativeTreasury !== null) return false; continue; }
      if (account.treasuryRef?.id !== ref.id || account.treasuryRef.route !== route || account.treasuryRef.evidenceRoute !== evidenceRoute) return false;
      const shared = account.sharedNativeTreasury;
      if (shared?.schema !== 'numina.treasury.shared-balance-reference.v2' || shared.identity !== 'NUMINA' || shared.treasuryIdentity !== 'NUMINA' || shared.transportVerificationChannel !== 'NUMINA' || shared.amount !== p.balance || shared.unit !== p.unit || shared.authority !== p.authority || shared.systemOfRecord !== p.system_of_record || shared.head !== t.head || shared.revision !== t.revision || shared.eventId !== p.last_event_id || shared.verificationScope !== t.verification_scope || shared.sharedAcrossAccounts !== true || shared.providerBalance !== false) return false;
    }
    return true;
  } catch { return false; }
}
