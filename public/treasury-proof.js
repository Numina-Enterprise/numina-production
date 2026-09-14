// Checks internal record consistency. Trust in the source and current journal ancestry
// still comes from the authenticated server; a SHA-256 digest is not a signature.
const treasuryHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const treasuryText = value => typeof value === 'string' && value.length > 0;
const treasuryRevision = value => Number.isSafeInteger(value) && value >= 0;
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
    if (data?.schema !== 'numina.treasury.v1' || data.route !== 'numina.treasury.v1' || !treasuryText(data.root) || !treasuryHash(data.head) || !treasuryRevision(data.revision) || data.verification_scope !== 'Numina-native model and journal integrity') return false;
    if (data.status === 'NOT_INITIALIZED') return allowUninitialized && data.projection === null && data.canonical_proof === null;
    if (data.status !== 'READY') return false;
    const p = data.projection, proof = data.canonical_proof, event = proof?.event, command = event?.command;
    if (p?.schema !== 'numina.treasury.projection.v1' || p.unit !== 'NUSD' || p.authority !== 'NUMINA' || p.verification !== 'VERIFIED' || p.system_of_record !== 'NUMINA' || p.scope !== 'Numina-native' || typeof p.balance !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(p.balance) || !treasuryText(p.last_event_id) || !Array.isArray(p.transaction_requests) || p.transaction_requests.length > 100) return false;
    if (proof?.algorithm !== 'SHA-256' || proof.canonicalization !== 'Numina canonical JSON' || proof.scope !== 'Numina-native journal record' || !treasuryHash(proof.hash)) return false;
    if (event?.type !== 'treasury' || event.id !== p.last_event_id || event.actor !== data.root || !treasuryRevision(event.revision) || event.revision < 1 || event.revision > data.revision || !treasuryHash(event.previous) || !treasuryHash(event.stateHash)) return false;
    if (command?.type !== 'treasury' || command.id !== event.id || command.expectedRevision !== event.revision - 1 || command.data?.expectedHead !== event.previous || command.data.Principal !== data.root || command.data.Authority !== 'NUMINA') return false;
    if (event.result?.outcome !== 'FINAL' || event.result.route !== data.route || event.result.execution_scope !== 'Numina-native journal' || event.result.mint_event !== null || event.result.bank_transaction !== null || treasuryCanonical(p) !== treasuryCanonical(event.result.projection)) return false;
    if (await treasuryDigest(command) !== event.commandHash || await treasuryDigest(event) !== proof.hash) return false;
    // Other journal operations may advance the head after the last treasury event.
    return event.revision !== data.revision || data.head === proof.hash;
  } catch { return false; }
}

export async function verifyTreasuryAccountView(view) {
  try {
    if (!await verifyTreasuryRecord(view?.treasury, {allowUninitialized: true}) || !Array.isArray(view.accounts)) return false;
    const t = view.treasury, p = t.projection, ref = view.canonicalTreasury, funding = view.nativeFundingView;
    const route = '/api/control/v1/treasury', evidenceRoute = '/api/control/v2/treasury/evidence';
    if (funding?.schema !== 'numina.treasury.native-funding-view.v1' || funding.head !== t.head || funding.revision !== t.revision || funding.treasuryProjectionChanged !== false || funding.verificationScope !== t.verification_scope) return false;
    if (p) {
      if (ref?.schema !== 'numina.treasury.canonical-reference.v1' || ref.id !== 'numina:treasury:' + encodeURIComponent(t.root) || ref.root !== t.root || ref.head !== t.head || ref.revision !== t.revision || ref.route !== route || ref.evidence?.route !== evidenceRoute) return false;
      if (ref.native?.amount !== p.balance || ref.native.unit !== p.unit || ref.native.eventId !== p.last_event_id || ref.native.verificationScope !== t.verification_scope || ref.accounting?.balanceCount !== 1 || ref.accounting.providerCurrenciesCombined !== false || ref.accounting.providerBalancesChanged !== false) return false;
      const valuation = view.nativeValuation;
      if (valuation?.schema !== 'numina.treasury.declared-value.v1' || valuation.amount !== p.balance || valuation.unit !== 'USD' || valuation.basis !== 'owner_authorized_denomination_policy' || valuation.sharedAcrossAccounts !== true || valuation.providerBalance !== false || valuation.executableConversionVerified !== false || valuation.rate?.base !== 'NUSD' || valuation.rate.quote !== 'USD' || valuation.rate.numerator !== '1' || valuation.rate.denominator !== '1') return false;
      if (funding.nativeTarget?.amount !== p.balance || funding.nativeTarget.unit !== p.unit || funding.nativeTarget.sharedAcrossAccounts !== true) return false;
    } else if (ref !== null || view.nativeValuation !== null || funding.nativeTarget !== null) return false;
    for (const account of view.accounts) {
      if (account.nativeTreasuryRoute !== route || account.sharedNativeProjection !== true || account.allocatedAmount !== null) return false;
      if (!p) { if (account.treasuryRef !== null || account.sharedNativeTreasury !== null) return false; continue; }
      if (account.treasuryRef?.id !== ref.id || account.treasuryRef.route !== route || account.treasuryRef.evidenceRoute !== evidenceRoute) return false;
      const shared = account.sharedNativeTreasury;
      if (shared?.schema !== 'numina.treasury.shared-balance-reference.v1' || shared.amount !== p.balance || shared.unit !== p.unit || shared.authority !== p.authority || shared.systemOfRecord !== p.system_of_record || shared.head !== t.head || shared.revision !== t.revision || shared.eventId !== p.last_event_id || shared.verificationScope !== t.verification_scope || shared.sharedAcrossAccounts !== true || shared.providerBalance !== false) return false;
    }
    return true;
  } catch { return false; }
}
