import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLocalWalletSigning} from '../public/local-wallet-signing-ui.js';
import {SIGNING_PINS} from '../public/wallet-signing-model.js';

const timestamp = Date.parse('2026-09-16T04:00:00.000Z');
// Public structural fixture, deliberately synthetic: no real wallet, key or private file.
const backupText = () => JSON.stringify({address: SIGNING_PINS.sender.slice(2), version: 3,
  id: '11111111-1111-1111-1111-111111111111', Crypto: {cipher: 'aes-128-ctr',
    cipherparams: {iv: '11'.repeat(16)}, ciphertext: '22'.repeat(32), mac: '33'.repeat(32),
    kdf: 'scrypt', kdfparams: {salt: '44'.repeat(32), n: 131072, r: 8, p: 1, dklen: 32}}});
const profile = () => ({constructorData: 'public-review-fixture', unresolvedReviews: [{id: 'independentSecurityAudit'}]});
const quote = (gasPrice = '11') => ({gasLimit: '9007199254740993', gasPrice,
  calculatedTotalBaseUnits: (9007199254740993n * BigInt(gasPrice)).toString(),
  balanceBaseUnits: '990791918021509250', balanceSufficient: true,
  observedAt: new Date(timestamp).toISOString(), expiresAt: new Date(timestamp + 60000).toISOString()});
const handoff = () => ({status: 'UNSIGNED_UNVERIFIED_HANDOFF', signed: false, broadcast: false, minted: false, receipt: null});
const error = code => Object.assign(new Error('Synthetic failure'), {code});
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }

class Element {
  constructor(tag = 'div', type = '') { this.tagName = tag; this.type = type; this.children = []; this.textContent = ''; this._value = ''; this.hidden = false; this.disabled = false; if (type === 'file') this.files = []; }
  get value() { return this._value; }
  set value(value) { this._value = value; if (this.type === 'file' && value === '') this.files = []; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  click() { return this.onclick?.(); }
  remove() {}
}

function harness(options = {}) {
  const nodes = new Map(), events = new Map(), timers = new Map(), downloads = [];
  const calls = {review: [], estimate: [], prepare: [], fileReads: 0};
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element(id === 'local-signing-file' ? 'input' : 'div', id === 'local-signing-file' ? 'file' : '')); return nodes.get(id); };
  const doc = {getElementById: node, createElement: tag => new Element(tag), body: new Element('body')};
  let timerId = 0;
  const win = {setTimeout: (handler, delay) => { timers.set(++timerId, {handler, delay}); return timerId; },
    clearTimeout: id => timers.delete(id), addEventListener: (name, handler) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(handler); },
    removeEventListener: (name, handler) => events.get(name)?.delete(handler)};
  const now = () => timestamp;
  const mounted = mountLocalWalletSigning({doc, win, now,
    loadReview: signal => { calls.review.push(signal); return options.loadReview ? options.loadReview(signal) : Promise.resolve(profile()); },
    loadEstimate: signal => { calls.estimate.push(signal); return options.loadEstimate ? options.loadEstimate(signal, calls.estimate.length) : Promise.resolve(quote()); },
    prepare: value => { calls.prepare.push(value); return options.prepare ? options.prepare(value) : Promise.resolve(handoff()); },
    download: value => { if (options.download) options.download(value); downloads.push(value); }});
  const select = ({text = backupText(), size = new TextEncoder().encode(text).length, read} = {}) => {
    const file = node('local-signing-file'); file.value = 'C:\\fakepath\\public-structural-fixture.json';
    file.files = [{name: 'public-structural-fixture.json', size, text: () => { calls.fileReads++; return read ? read() : Promise.resolve(text); }}];
    return file.onchange();
  };
  return {node, calls, downloads, timers, mounted, select, now,
    emit: name => { for (const handler of [...(events.get(name) ?? [])]) handler({type: name}); },
    snapshot: () => Array.from(nodes, ([id, n]) => ({id, text: n.textContent, value: n.value, hidden: n.hidden, disabled: n.disabled, fileCount: n.files?.length}))};
}
async function selected(h) { await h.mounted.ready; await h.select(); }
async function estimated(h) { await selected(h); await h.node('local-signing-estimate').click(); }

test('import and review loading never select a backup or automatically read a network estimate', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('Unexpected network request'); });
  assert.equal(typeof globalThis.document, 'undefined');
  const h = harness(); await h.mounted.ready;
  assert.equal(h.calls.review.length, 1); assert.equal(h.calls.fileReads, 0);
  assert.equal(h.calls.estimate.length, 0); assert.equal(h.calls.prepare.length, 0);
  await h.node('local-signing-estimate').click(); await h.node('local-signing-download').click();
  assert.equal(h.calls.estimate.length, 0); assert.equal(h.downloads.length, 0);
  assert.equal(h.node('local-signing-estimate').disabled, true);
  await h.select();
  assert.equal(h.calls.fileReads, 1); assert.equal(h.calls.estimate.length, 0);
  assert.equal(h.node('local-signing-file').value, ''); assert.equal(h.node('local-signing-file').files.length, 0);
  assert.match(h.node('local-signing-address').textContent, new RegExp(SIGNING_PINS.sender));
  assert.match(h.node('local-signing-address').textContent, /wallet remains locked/);
  assert.equal(h.node('local-signing-estimate').disabled, false);
  assert.equal(h.node('local-signing-download').disabled, true);
  h.mounted.dispose();
});

test('estimate and export require separate clicks; export refreshes the quote and passes only public backup metadata', async () => {
  const review = profile(), observed = quote(), refreshed = quote('12'), expected = handoff();
  const h = harness({loadReview: () => Promise.resolve(review), loadEstimate: (signal, count) => Promise.resolve(count === 1 ? observed : refreshed), prepare: () => Promise.resolve(expected)});
  await selected(h); await h.node('local-signing-download').click(); assert.equal(h.calls.estimate.length, 0);
  await h.node('local-signing-estimate').click();
  assert.equal(h.calls.estimate.length, 1); assert.equal(h.calls.prepare.length, 0); assert.equal(h.downloads.length, 0);
  assert.equal(h.node('local-signing-maximum').value, '99079191802150923');
  assert.match(h.node('local-signing-values').textContent, /9007199254740993/);
  assert.match(h.node('local-signing-values').textContent, /99079191802150923/);
  assert.equal(h.node('local-signing-quote').hidden, false);
  h.node('local-signing-maximum').value = '  108086391056891916  '; h.node('local-signing-maximum').oninput();
  await h.node('local-signing-download').click();
  assert.equal(h.calls.estimate.length, 2); assert.equal(h.calls.estimate[0].aborted, true);
  assert.equal(h.calls.prepare.length, 1);
  const args = h.calls.prepare[0];
  assert.strictEqual(args.review, review); assert.strictEqual(args.quote, refreshed);
  assert.equal(args.maximumFeeBaseUnits, '108086391056891916'); assert.strictEqual(args.now, h.now);
  assert.deepEqual(args.backup, {address: SIGNING_PINS.sender, backupFormatChecked: true, signingControlVerified: false});
  assert.ok(Object.isFrozen(args.backup));
  assert.deepEqual(Object.keys(args).sort(), ['backup', 'maximumFeeBaseUnits', 'now', 'quote', 'review']);
  assert.doesNotMatch(JSON.stringify(args), /ciphertext|cipherparams|kdfparams|fakepath|public-structural-fixture/);
  assert.strictEqual(h.downloads[0], expected); assert.equal(h.node('local-signing-file').value, '');
  assert.equal(h.node('local-signing-maximum').value, ''); assert.equal(h.node('local-signing-quote').hidden, true);
  assert.match(h.node('local-signing-status').textContent, /Unsigned handoff downloaded/);
  assert.match(h.node('local-signing-status').textContent, /wallet remains locked/);
  await h.node('local-signing-download').click(); assert.equal(h.downloads.length, 1); assert.equal(h.calls.estimate.length, 2);
  h.mounted.dispose();
});

test('cancelled file selection clears prior selection and fee observations without reading a file', async () => {
  const h = harness(); await estimated(h);
  h.node('local-signing-file').files = []; await h.node('local-signing-file').onchange();
  assert.equal(h.calls.fileReads, 1); assert.equal(h.node('local-signing-file').value, '');
  assert.equal(h.node('local-signing-address').textContent, 'No backup selected.');
  assert.equal(h.node('local-signing-maximum').value, ''); assert.equal(h.node('local-signing-values').textContent, '');
  await h.node('local-signing-estimate').click(); await h.node('local-signing-download').click();
  assert.equal(h.calls.estimate.length, 1); assert.equal(h.downloads.length, 0); h.mounted.dispose();
});

test('invalid, oversized, unreadable and wrong-address backups cannot enable network reads and clear the file value', async () => {
  const mismatch = JSON.parse(backupText()); mismatch.address = '12'.repeat(20);
  for (const candidate of [{text: '{}'}, {text: JSON.stringify(mismatch)}, {size: 0}, {size: 8193}, {size: 1.5}, {read: () => Promise.reject(Error('file unavailable'))}]) {
    const h = harness(); await h.mounted.ready; await h.select(candidate);
    assert.equal(h.node('local-signing-file').value, ''); assert.equal(h.node('local-signing-file').files.length, 0);
    assert.equal(h.node('local-signing-estimate').disabled, true); assert.equal(h.node('local-signing-download').disabled, true);
    await h.node('local-signing-estimate').click(); await h.node('local-signing-download').click();
    assert.equal(h.calls.estimate.length, 0); assert.equal(h.calls.prepare.length, 0); assert.equal(h.downloads.length, 0);
    if (Object.hasOwn(candidate, 'size')) assert.equal(h.calls.fileReads, 0);
    h.mounted.dispose();
  }
});

for (const phase of ['file', 'estimate', 'refresh', 'handoff']) {
  for (const invalidation of ['clear', 'pagehide']) {
    for (const resolution of ['resolve', 'reject']) {
      test(`${invalidation} suppresses a late ${phase} ${resolution} and clears selection, quote and file value`, async () => {
        const pending = deferred(), result = phase === 'file' ? backupText() : phase === 'handoff' ? handoff() : quote();
        const h = harness({loadEstimate: (signal, count) => (phase === 'estimate' || (phase === 'refresh' && count === 2)) ? pending.promise : Promise.resolve(quote()),
          prepare: () => phase === 'handoff' ? pending.promise : Promise.resolve(handoff())});
        await h.mounted.ready;
        let operation;
        if (phase === 'file') operation = h.select({read: () => pending.promise});
        else {
          await h.select();
          if (phase !== 'estimate') await h.node('local-signing-estimate').click();
          operation = h.node(phase === 'estimate' ? 'local-signing-estimate' : 'local-signing-download').click();
          await Promise.resolve();
        }
        if (phase === 'handoff') assert.equal(h.calls.prepare.length, 1);
        assert.equal(h.node('local-signing-file').value, '');
        assert.equal(h.node('local-signing-clear').disabled, false);
        if (invalidation === 'clear') h.node('local-signing-clear').click(); else h.emit('pagehide');
        assert.equal(h.node('local-signing-file').value, ''); assert.equal(h.node('local-signing-file').files.length, 0);
        assert.equal(h.node('local-signing-address').textContent, 'No backup selected.');
        assert.equal(h.node('local-signing-maximum').value, ''); assert.equal(h.node('local-signing-values').textContent, '');
        assert.equal(h.node('local-signing-quote').hidden, true); assert.equal(h.timers.size, 0);
        for (const signal of h.calls.estimate) assert.equal(signal.aborted, true);
        if (invalidation === 'pagehide') {
          assert.equal(h.calls.review[0].aborted, true);
          for (const id of ['file', 'clear', 'estimate', 'maximum', 'download']) assert.equal(h.node('local-signing-' + id).disabled, true);
        }
        const cleared = h.snapshot(), before = {estimate: h.calls.estimate.length, prepare: h.calls.prepare.length};
        if (resolution === 'reject') pending.reject(Error('late synthetic failure')); else pending.resolve(result);
        await operation;
        assert.deepEqual(h.snapshot(), cleared); assert.equal(h.downloads.length, 0);
        assert.deepEqual({estimate: h.calls.estimate.length, prepare: h.calls.prepare.length}, before);
        await h.node('local-signing-estimate').click(); await h.node('local-signing-download').click();
        assert.deepEqual({estimate: h.calls.estimate.length, prepare: h.calls.prepare.length}, before);
        if (invalidation === 'clear') { await h.select(); assert.equal(h.node('local-signing-estimate').disabled, false); }
        h.mounted.dispose();
      });
    }
  }
}

test('pending work blocks duplicate selection, estimates and exports while clear remains available', async () => {
  const pending = deferred(), h = harness({loadEstimate: () => pending.promise}); await selected(h);
  const operation = h.node('local-signing-estimate').click();
  for (const id of ['file', 'estimate', 'maximum', 'download']) assert.equal(h.node('local-signing-' + id).disabled, true);
  assert.equal(h.node('local-signing-clear').disabled, false);
  await h.node('local-signing-file').onchange(); await h.node('local-signing-estimate').click(); await h.node('local-signing-download').click();
  assert.equal(h.calls.fileReads, 1); assert.equal(h.calls.estimate.length, 1); assert.equal(h.calls.prepare.length, 0);
  pending.resolve(quote()); await operation; h.mounted.dispose();
});

test('expiry erases fee data and requires a new explicit estimate before export', async () => {
  const h = harness(); await estimated(h);
  assert.equal(h.timers.size, 1); const timer = [...h.timers.values()][0]; assert.equal(timer.delay, 60000); timer.handler();
  assert.equal(h.node('local-signing-maximum').value, ''); assert.equal(h.node('local-signing-values').textContent, '');
  assert.equal(h.node('local-signing-quote').hidden, true); assert.equal(h.node('local-signing-download').disabled, true);
  assert.match(h.node('local-signing-status').textContent, /expired/);
  await h.node('local-signing-download').click(); assert.equal(h.calls.prepare.length, 0); assert.equal(h.calls.estimate.length, 1);
  await h.node('local-signing-estimate').click(); assert.equal(h.calls.estimate.length, 2); assert.equal(h.node('local-signing-download').disabled, false);
  h.mounted.dispose();
});

test('estimate failure produces no quote or export and can be retried explicitly', async () => {
  const h = harness({loadEstimate: (signal, count) => count === 1 ? Promise.reject(error('ESTIMATE_UNAVAILABLE')) : Promise.resolve(quote())});
  await selected(h); await h.node('local-signing-estimate').click();
  assert.match(h.node('local-signing-status').textContent, /estimate is unavailable/);
  assert.equal(h.node('local-signing-quote').hidden, true); assert.equal(h.node('local-signing-maximum').value, '');
  await h.node('local-signing-download').click(); assert.equal(h.calls.estimate.length, 1); assert.equal(h.calls.prepare.length, 0);
  await h.node('local-signing-estimate').click(); assert.equal(h.calls.estimate.length, 2); assert.equal(h.node('local-signing-quote').hidden, false);
  h.mounted.dispose();
});

for (const phase of ['refresh', 'prepare', 'download']) test(`export ${phase} failure clears the quote without producing a successful download`, async () => {
  const h = harness({loadEstimate: (signal, count) => phase === 'refresh' && count === 2 ? Promise.reject(error('ESTIMATE_UNAVAILABLE')) : Promise.resolve(quote()),
    prepare: () => phase === 'prepare' ? Promise.reject(error('FEE_BUDGET_EXCEEDED')) : Promise.resolve(handoff()),
    download: () => { if (phase === 'download') throw Error('download failed'); }});
  await estimated(h); await h.node('local-signing-download').click();
  assert.equal(h.calls.estimate.length, 2); assert.equal(h.calls.prepare.length, phase === 'refresh' ? 0 : 1);
  assert.equal(h.downloads.length, 0); assert.equal(h.node('local-signing-quote').hidden, true);
  assert.equal(h.node('local-signing-maximum').value, ''); assert.equal(h.node('local-signing-file').value, '');
  assert.doesNotMatch(h.node('local-signing-status').textContent, /Unsigned handoff downloaded/);
  await h.node('local-signing-download').click(); assert.equal(h.calls.estimate.length, 2); h.mounted.dispose();
});

test('review load failure keeps backup preparation disabled and performs no estimate', async () => {
  const h = harness({loadReview: () => Promise.reject(Error('review unavailable'))}); await h.mounted.ready;
  assert.equal(h.node('local-signing-file').disabled, true); assert.match(h.node('local-signing-status').textContent, /review is unavailable/);
  await h.select(); await h.node('local-signing-estimate').click(); await h.node('local-signing-download').click();
  assert.equal(h.calls.fileReads, 0); assert.equal(h.calls.estimate.length, 0); assert.equal(h.downloads.length, 0); h.mounted.dispose();
});

for (const resolution of ['resolve', 'reject']) test(`pagehide suppresses a late review ${resolution}`, async () => {
  const pending = deferred(), h = harness({loadReview: () => pending.promise}); h.emit('pagehide');
  const cleared = h.snapshot(); assert.equal(h.calls.review[0].aborted, true);
  if (resolution === 'reject') pending.reject(Error('late review failure')); else pending.resolve(profile());
  await h.mounted.ready; assert.deepEqual(h.snapshot(), cleared);
  await h.node('local-signing-file').onchange(); await h.node('local-signing-estimate').click();
  assert.equal(h.calls.fileReads, 0); assert.equal(h.calls.estimate.length, 0); assert.equal(h.downloads.length, 0); h.mounted.dispose();
});
