import {requestJson} from './http-client.js';
import {verifyTreasuryRecord} from './treasury-proof.js';
import {canonicalTreasuryJson} from './treasury-adjustment.js';

const route = '/api/control/v1/treasury';
const amountPattern = /^[1-9][0-9]{0,77}$/;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
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
  const fields = mint ? ['operation', 'amount', 'networkReference', 'destinationReference', 'reason']
    : ['operation', 'amountMinor', 'currency', 'destinationReference', 'reason'];
  if (!input || Object.getPrototypeOf(input) !== Object.prototype
      || (!mint && input.operation !== 'PREPARE_BANK_TRANSACTION')
      || Object.keys(input).length !== fields.length || fields.some(field => !Object.hasOwn(input, field)))
    fail('INVALID_TREASURY_FIELDS', 'Use only the fields for a mint or USD bank preparation request.');
  const intent = capture(input);
  const amount = mint ? intent.amount : intent.amountMinor;
  if (typeof amount !== 'string' || !amountPattern.test(amount))
    fail('INVALID_TRANSACTION_AMOUNT', 'Enter a positive exact integer amount.');
  const validReference = value => typeof value === 'string' && referencePattern.test(value);
  if (!validReference(intent.destinationReference) || (mint && !validReference(intent.networkReference)) || (!mint && intent.currency !== 'USD'))
    fail('INVALID_TRANSACTION_REFERENCE', 'Use valid public references and USD for bank requests.');
  if (typeof intent.reason !== 'string' || !intent.reason.trim() || intent.reason.length > 1000 || /[\u0000-\u001f]/.test(intent.reason))
    fail('TREASURY_REASON_REQUIRED', 'Enter a reason of 1–1000 characters without control characters.');
  return {intent, mint, amount};
}

// This client records preparation only. It has no provider or wallet write path.
export function createTreasuryPreparation({
  read = () => requestJson(route, {method: 'GET'}),
  write = canonicalBody => requestJson(route, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: canonicalBody}),
  makeId = () => 'treasury-prepare-' + crypto.randomUUID()
} = {}) {
  const drafts = new WeakMap();
  async function prepare(input) {
    const {intent, mint, amount} = validateIntent(input);
    const snapshot = capture(await read());
    if (!await verifyTreasuryRecord(snapshot)) fail('TREASURY_PREPARATION_READ_INVALID', 'The current treasury record could not be verified.');
    if (!Number.isSafeInteger(snapshot.revision + 1)) fail('TREASURY_REVISION_OUT_OF_RANGE', 'The treasury revision is out of range.');
    if (snapshot.projection.transaction_requests.length >= 100) fail('TREASURY_REQUEST_CAPACITY', 'The treasury preparation journal has reached its request capacity.');
    const id = makeId();
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) fail('INVALID_COMMAND_ID', 'The request identifier is invalid.');
    const event = freeze({id, expectedRevision: snapshot.revision, expectedHead: snapshot.head,
      Principal: snapshot.root, Authority: 'NUMINA', Objective: mint ? 'treasury.mint.prepare' : 'treasury.bank.prepare', Intent: intent});
    const transactionRequest = freeze({id, kind: mint ? 'mint_request' : 'bank_transaction_request', status: 'PREPARED',
      destination_reference: intent.destinationReference,
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
        && event?.type === 'treasury' && event.id === draft.event.id && event.actor === snapshot.root
        && event.revision === snapshot.revision + 1 && event.previous === snapshot.head
        && equal(event.command, expectedCommand) && equal(response.projection, expectedProjection)
        && advancement?.advanced === !response.replayed && advancement.previous === snapshot.head
        && advancement.head === response.canonical_proof.hash && advancement.revision === event.revision
        && hash(current?.head) && Number.isSafeInteger(current.revision) && current.revision >= event.revision
        && (current.revision !== event.revision || current.head === response.canonical_proof.hash)
        && await verifyTreasuryRecord({schema: 'numina.treasury.v1', route: response.route, root: snapshot.root,
          status: 'READY', revision: event.revision, head: response.canonical_proof.hash,
          projection: response.projection, canonical_proof: response.canonical_proof, verification_scope: snapshot.verification_scope});
    } catch { valid = false; }
    if (!valid) fail('TREASURY_PREPARATION_PROOF_INVALID', 'The response did not match the reviewed preparation request or its journal proof. Keep the exact request for retry.');
    return response;
  }
  return Object.freeze({prepare, submit});
}
