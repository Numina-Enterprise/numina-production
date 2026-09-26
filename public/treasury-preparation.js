import {requestJson} from './http-client.js';
import {verifyTreasuryRecord,verifyTreasuryWriteRecord} from './treasury-proof.js';
import {canonicalTreasuryJson} from './treasury-adjustment.js';

const route = '/api/control/v1/treasury';
const amountPattern = /^[1-9][0-9]{0,77}$/;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const baseUsdc = Object.freeze({network: 'Base', chain_id: 8453, network_reference: 'eip155:8453', token_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', unit: 'USDC', decimals: 6,
  destination_reference: '0x736bd8f274dce00a8bb374edd85df0d2e631018e', destination_financial_account: 'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',
  destination_financial_address: 'finaddr_61VNd8JyhbqklVBhF16VNcN9EZSQiQliazWdBc8FkRw8', destination_binding_verified: true});
const usdcBlockers = Object.freeze(['SOURCE_WALLET_NOT_RECORDED', 'BASE_SIGNER_CONTROL_NOT_VERIFIED', 'SOURCE_USDC_BALANCE_NOT_VERIFIED', 'BASE_ETH_GAS_BALANCE_NOT_VERIFIED']);
const aggregateEvidence = Object.freeze({ownerApproval: '/owner-approval.js',
  nusd: Object.freeze(['/downloads/nusd/mint-receipt.json', '/downloads/nusd/deployment-verification.json']),
  usdc: Object.freeze(['/api/control/v2/treasury/provider-routes', '/metadata-alignment.json']),
  usd: Object.freeze(['/api/control/v2/treasury/accounts', '/downloads/Provider-Confirmation-Request-v4.md'])});
const uint256Max = (1n << 256n) - 1n;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const equal = (a, b) => canonicalTreasuryJson(a) === canonicalTreasuryJson(b);
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const capture = value => freeze(JSON.parse(canonicalTreasuryJson(value)));

function validateIntent(input) {
  const mint = input?.operation === 'PREPARE_MINT';
  const usdc = input?.operation === 'PREPARE_USDC_DEPOSIT';
  const bank = input?.operation === 'PREPARE_BANK_TRANSACTION';
  const aggregate = input?.operation === 'PREPARE_AGGREGATE_MODEL';
  const fields = mint ? ['operation', 'amount', 'networkReference', 'destinationReference', 'reason']
    : usdc ? ['operation', 'amount', 'destinationReference', 'reason']
      : aggregate ? ['operation', 'aggregateAmount', 'bankAmount', 'stripeAmount', 'nativeAmount', 'reason']
        : ['operation', 'amountMinor', 'currency', 'destinationReference', 'reason'];
  if (!input || Object.getPrototypeOf(input) !== Object.prototype
      || (!mint && !usdc && !bank && !aggregate)
      || Object.keys(input).length !== fields.length || fields.some(field => !Object.hasOwn(input, field)))
    fail('INVALID_TREASURY_FIELDS', 'Use only the fields for a mint, USD bank, Base USDC, or aggregate-model preparation request.');
  const intent = capture(input);
  const amount = mint || usdc ? intent.amount : bank ? intent.amountMinor : null;
  const amounts = aggregate ? ['aggregateAmount', 'bankAmount', 'stripeAmount', 'nativeAmount'].map(field => intent[field]) : [amount];
  if (amounts.some(value => typeof value !== 'string' || !amountPattern.test(value))) fail('INVALID_TRANSACTION_AMOUNT', 'Enter positive exact integer amounts.');
  if (aggregate && BigInt(intent.bankAmount) + BigInt(intent.stripeAmount) + BigInt(intent.nativeAmount) !== BigInt(intent.aggregateAmount))
    fail('AGGREGATE_MODEL_MISMATCH', 'The three separate role amounts must equal the aggregate model amount.');
  if (usdc && BigInt(amount) * (10n ** BigInt(baseUsdc.decimals)) > uint256Max)
    fail('INVALID_TRANSACTION_AMOUNT', 'Enter a USDC amount representable by the token contract.');
  const validReference = value => typeof value === 'string' && referencePattern.test(value);
  if (!aggregate && (!validReference(intent.destinationReference) || (mint && !validReference(intent.networkReference))
      || (usdc && (!evmAddressPattern.test(intent.destinationReference) || intent.destinationReference.toLowerCase() !== baseUsdc.destination_reference)) || (bank && intent.currency !== 'USD')))
    fail('INVALID_TRANSACTION_REFERENCE', 'Use valid public references, a Base address for USDC, and USD for bank requests.');
  if (typeof intent.reason !== 'string' || !intent.reason.trim() || intent.reason.length > 1000 || /[\u0000-\u001f]/.test(intent.reason))
    fail('TREASURY_REASON_REQUIRED', 'Enter a reason of 1–1000 characters without control characters.');
  return {intent, mint, usdc, bank, aggregate, amount};
}

// This client records preparation only. It has no provider or wallet write path.
export function createTreasuryPreparation({
  read = () => requestJson(route, {method: 'GET'}),
  write = canonicalBody => requestJson(route, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: canonicalBody}),
  makeId = () => 'treasury-prepare-' + crypto.randomUUID()
} = {}) {
  const drafts = new WeakMap();
  async function prepare(input) {
    const {intent, mint, usdc, aggregate, amount} = validateIntent(input);
    const snapshot = capture(await read());
    if (!await verifyTreasuryRecord(snapshot)) fail('TREASURY_PREPARATION_READ_INVALID', 'The current treasury record could not be verified.');
    if (!Number.isSafeInteger(snapshot.revision + 1)) fail('TREASURY_REVISION_OUT_OF_RANGE', 'The treasury revision is out of range.');
    if (snapshot.projection.transaction_requests.length >= 100) fail('TREASURY_REQUEST_CAPACITY', 'The treasury preparation journal has reached its request capacity.');
    const id = makeId();
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) fail('INVALID_COMMAND_ID', 'The request identifier is invalid.');
    const event = freeze({id, expectedRevision: snapshot.revision, expectedHead: snapshot.head,
      Principal: snapshot.principal, Authority: 'NUMINA', Objective: mint ? 'treasury.mint.prepare' : usdc ? 'treasury.usdc.prepare' : aggregate ? 'treasury.aggregate.prepare' : 'treasury.bank.prepare', Intent: intent});
    const amountBaseUnits = usdc ? (BigInt(amount) * (10n ** BigInt(baseUsdc.decimals))).toString() : null;
    const transactionRequest = freeze(aggregate ? {
      id, kind: 'aggregate_model_request', status: 'PREPARED_MODEL_ONLY', authority: 'NUMINA',
      owner_approval: {status: 'OWNER_APPROVAL_RECORDED', reference: aggregateEvidence.ownerApproval},
      aggregate_amount: intent.aggregateAmount, aggregation: 'SUM_OF_SEPARATE_ROLE_AMOUNTS',
      components: [
        {id: 'native-nusd', role: 'NATIVE_VALUE', observation_scope: 'RECEIPT_BACKED_ISSUANCE', source: 'NUMINA_CONSTRUCTOR_MINT_RECEIPT', amount: intent.nativeAmount, unit: 'NUSD', status: 'PREPARED_MODEL_ONLY', evidence_references: [...aggregateEvidence.nusd], constructor_mint_block: '51725', constructor_mint_transaction: '0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b', denomination_policy_declaration: '1 NUSD = 1 USDC = 1 USD', issuer_policy_hash: '0x2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5', issuer_policy_approval_reference: aggregateEvidence.ownerApproval, policy_declaration_scope: 'ISSUER_POLICY_DECLARATION_NOT_EXTERNAL_BACKING', burn_observation: {block_number: '51749', scope: 'DATED_DEPLOYMENT_VERIFICATION_OBSERVATION', constructor_issuance_base_units: '1500000000000000000000000000000000', total_supply_base_units: '1500000000000000000000000000000000', recipient_balance_base_units: '1500000000000000000000000000000000', burned_nusd: '0', burned_base_units: '0', current_chain_burn_state_verified: false}, externally_backed_claim: false, external_settlement_usdc: false, reserves_verified: false, external_reserve_verified: false},
        {id: 'stripe-usdc', role: 'DIGITAL_DOLLAR_ROUTE', observation_scope: 'PROVIDER_SCOPED_OBSERVATION', source: 'STRIPE_DESTINATION_OBSERVATION', amount: intent.stripeAmount, unit: 'USDC', status: 'PREPARED_MODEL_ONLY', evidence_references: [...aggregateEvidence.usdc], provider_balance_verified: false, provider_transaction_verified: false},
        {id: 'bank-usd', role: 'BANK_ROUTE', observation_scope: 'NUMINA_SCOPED_OBSERVATION', source: 'OWNER_PROVIDED_BANK_ALIGNMENT', amount: intent.bankAmount, unit: 'USD', status: 'PREPARED_MODEL_ONLY', evidence_references: [...aggregateEvidence.usd], provider_balance_verified: false, provider_transaction_verified: false}
      ],
      external_balance_verified: false, external_provider_verification: false, external_backing_verified: false, external_funds_moved: false,
      execution_performed: false, broadcast_performed: false, submission_performed: false, settlement_performed: false,
      transaction_hash: null, receipt: null, reconciliation: {status: 'PENDING_EVIDENCE', evidence_required: true}
    } : usdc ? {
      id, kind: 'usdc_transfer_request', status: 'PREPARED', destination_reference: baseUsdc.destination_reference,
      destination_financial_account: baseUsdc.destination_financial_account, destination_financial_address: baseUsdc.destination_financial_address, destination_binding_verified: baseUsdc.destination_binding_verified,
      journal_idempotency_key: id, journal_replay_preconditions: ['expectedRevision', 'expectedHead'],
      amount, amount_base_units: amountBaseUnits, network: baseUsdc.network, chain_id: baseUsdc.chain_id, network_reference: baseUsdc.network_reference, token_address: baseUsdc.token_address, unit: baseUsdc.unit, decimals: baseUsdc.decimals,
      source_wallet: null, signer_control_verified: false, source_usdc_balance: null, source_base_eth_gas_balance: null,
      execution_performed: false, broadcast_performed: false, submission_performed: false, transaction_hash: null, receipt: null,
      prerequisite_blockers: [...usdcBlockers]
    } : {id, kind: mint ? 'mint_request' : 'bank_transaction_request', status: 'PREPARED', destination_reference: intent.destinationReference,
      ...(mint ? {amount, unit: 'NUSD', network_reference: intent.networkReference} : {amount_minor: amount, currency: 'USD'}),
      submission_performed: false, receipt: null});
    const draft = freeze({event, canonicalBody: canonicalTreasuryJson(event), beforeBalance: snapshot.projection.balance, transactionRequest});
    drafts.set(draft, snapshot);
    return draft;
  }
  async function submit(draft) {
    const snapshot = drafts.get(draft);
    if (!snapshot) fail('INVALID_TREASURY_DRAFT', 'Review a treasury preparation request before recording it.');
    // Retry exactly these bytes after uncertainty; never replace the ID or head.
    const response = capture(await write(draft.canonicalBody));
    let valid = false;
    try {
      const event = response.canonical_proof?.event, advancement = response.head_advancement, current = response.current_head;
      const expectedCommand = {id: draft.event.id, expectedRevision: draft.event.expectedRevision, type: 'treasury',
        data: {Principal: draft.event.Principal, Authority: 'NUMINA', Objective: draft.event.Objective,
          Intent: draft.event.Intent, expectedHead: draft.event.expectedHead}};
      const expectedProjection = {...snapshot.projection, last_event_id: draft.event.id,
        transaction_requests: [...snapshot.projection.transaction_requests, draft.transactionRequest]};
      valid = response.status === 'FINAL' && response.route === 'numina.treasury.v1' && response.execution_scope === 'Numina-native journal'
        && typeof response.replayed === 'boolean' && response.mint_event === null && response.bank_transaction === null
        && equal(response.transaction_request, draft.transactionRequest) && equal(event?.result?.transaction_request, draft.transactionRequest)
        && event?.type === 'treasury' && event.id === draft.event.id && event.actor === snapshot.principal
        && event.revision === snapshot.revision + 1 && event.previous === snapshot.head
        && equal(event.command, expectedCommand) && equal(response.projection, expectedProjection)
        && advancement?.advanced === !response.replayed && advancement.previous === snapshot.head
        && advancement.head === response.canonical_proof.hash && advancement.revision === event.revision
        && hash(current?.head) && Number.isSafeInteger(current.revision) && current.revision >= event.revision
        && (current.revision !== event.revision || current.head === response.canonical_proof.hash)
        && await verifyTreasuryWriteRecord(snapshot,response);
    } catch { valid = false; }
    if (!valid) fail('TREASURY_PREPARATION_PROOF_INVALID', 'The response did not match the reviewed preparation request or its journal proof. Keep the exact request for retry.');
    return response;
  }
  return Object.freeze({prepare, submit});
}
