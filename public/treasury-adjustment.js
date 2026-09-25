import {requestJson} from './http-client.js';
import {verifyTreasuryRecord,verifyTreasuryWriteRecord} from './treasury-proof.js';

const route = '/api/control/v1/treasury';
const unsigned = /^(0|[1-9][0-9]{0,77})$/;
const signed = /^-?[1-9][0-9]{0,77}$/;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };

// Match the journal's canonical JSON; never round an integer or omit a value.
export function canonicalTreasuryJson(value) {
  const ancestors = new Set();
  function encode(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isSafeInteger(item) && !Object.is(item, -0)) return JSON.stringify(item);
    if (!item || typeof item !== 'object' || ancestors.has(item)) throw Error('Invalid canonical JSON');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const values = [];
        for (let index = 0; index < item.length; index++) {
          if (!Object.hasOwn(item, index)) throw Error('Invalid canonical JSON');
          values.push(encode(item[index]));
        }
        return '[' + values.join(',') + ']';
      }
      if (Object.getPrototypeOf(item) === Object.prototype) return '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}';
      throw Error('Invalid canonical JSON');
    } finally { ancestors.delete(item); }
  }
  return encode(value);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const capture = value => freeze(JSON.parse(canonicalTreasuryJson(value)));

export function createTreasuryAdjustment({
  read = () => requestJson(route, {method: 'GET'}),
  write = canonicalBody => requestJson(route, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: canonicalBody}),
  makeId = () => 'treasury-adjust-' + crypto.randomUUID()
} = {}) {
  const drafts = new WeakMap();

  async function prepare({delta, reason} = {}) {
    if (typeof delta !== 'string' || !signed.test(delta)) fail('INVALID_TREASURY_DELTA', 'Enter a nonzero exact integer adjustment.');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000 || /[\u0000-\u001f]/.test(reason)) fail('TREASURY_REASON_REQUIRED', 'Enter a reason of 1–1000 characters without control characters.');
    // Clone before proof hashing yields, so the reviewed values cannot change.
    const snapshot = capture(await read());
    if (!await verifyTreasuryRecord(snapshot)) fail('TREASURY_ADJUSTMENT_READ_INVALID', 'The current treasury record could not be verified.');
    if (!Number.isSafeInteger(snapshot.revision + 1)) fail('TREASURY_REVISION_OUT_OF_RANGE', 'The treasury revision is out of range.');
    const afterBalance = (BigInt(snapshot.projection.balance) + BigInt(delta)).toString();
    if (!unsigned.test(afterBalance)) fail('TREASURY_BALANCE_OUT_OF_RANGE', 'The resulting treasury balance is out of range.');
    const id = makeId();
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) fail('INVALID_COMMAND_ID', 'The adjustment identifier is invalid.');
    const event = freeze({id, expectedRevision: snapshot.revision, expectedHead: snapshot.head,
      Principal: snapshot.principal, Authority: 'NUMINA', Objective: 'treasury.project',
      Intent: {operation: 'ADJUST_PROJECTION', delta, reason}});
    const draft = freeze({event, beforeBalance: snapshot.projection.balance, afterBalance, canonicalBody: canonicalTreasuryJson(event)});
    drafts.set(draft, snapshot);
    return draft;
  }

  async function submit(draft) {
    const snapshot = drafts.get(draft);
    if (!snapshot) fail('INVALID_TREASURY_DRAFT', 'Review a treasury adjustment before submitting it.');
    // Every explicit attempt uses the original bytes, ID, revision and head.
    // A failed or uncertain attempt remains available for an exact retry.
    const response = capture(await write(draft.canonicalBody));
    let valid = false;
    try {
      const event = response.canonical_proof?.event;
      const advancement = response.head_advancement;
      const current = response.current_head;
      const expectedCommand = {id: draft.event.id, expectedRevision: draft.event.expectedRevision, type: 'treasury',
        data: {Principal: draft.event.Principal, Authority: draft.event.Authority, Objective: draft.event.Objective,
          Intent: draft.event.Intent, expectedHead: draft.event.expectedHead}};
      const expectedProjection = {...snapshot.projection, balance: draft.afterBalance, last_event_id: draft.event.id};
      valid = response.status === 'FINAL' && response.route === 'numina.treasury.v1' && response.execution_scope === 'Numina-native journal'
        && typeof response.replayed === 'boolean' && response.transaction_request === null && response.mint_event === null && response.bank_transaction === null
        && event?.type === 'treasury' && event.id === draft.event.id && event.actor === snapshot.principal
        && event.revision === snapshot.revision + 1 && event.previous === snapshot.head && event.result?.transaction_request === null
        && canonicalTreasuryJson(event.command) === canonicalTreasuryJson(expectedCommand)
        && canonicalTreasuryJson(response.projection) === canonicalTreasuryJson(expectedProjection)
        && advancement?.advanced === !response.replayed && advancement.previous === snapshot.head
        && advancement.head === response.canonical_proof.hash && advancement.revision === event.revision
        && hash(current?.head) && revision(current.revision) && current.revision >= event.revision
        && (current.revision !== event.revision || current.head === response.canonical_proof.hash)
        && await verifyTreasuryWriteRecord(snapshot,response);
    } catch { valid = false; }
    if (!valid) fail('TREASURY_ADJUSTMENT_PROOF_INVALID', 'The adjustment response did not match the reviewed draft or its journal proof.');
    return response;
  }

  return Object.freeze({prepare, submit});
}
