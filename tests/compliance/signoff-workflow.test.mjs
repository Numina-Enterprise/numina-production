import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildIndex} from '../../local/compliance/lib/lists.mjs';
import {createCounterpartyCase, updateCounterparty, submit, runScreening, disposition, manualCheck, approvalBlockers, runAml, alertNote, kycIndex, OFAC_SLS_URL} from '../../local/compliance/lib/workflow.mjs';
import {performSignoff} from '../../local/compliance/lib/signoff.mjs';
import {createSignoff, verifySignoff, outputSha256, loadSigners, loadPrivateKey, SIGNER_LABEL} from '../../local/compliance/lib/signoff-core.mjs';
import {buildPacket, markdownToHtml} from '../../local/compliance/lib/packet.mjs';
import {verifyAudit, readAudit} from '../../local/compliance/lib/audit.mjs';
import {loadConfig, canonicalJson} from '../../local/compliance/lib/util.mjs';
import {FAKE_LISTS, fakeBusiness, fakeIndividual, fakePayments} from '../../local/compliance/lib/synthetic.mjs';
import {tempEnv} from './helpers/env.mjs';

const config = loadConfig();
const engines = {index: buildIndex(FAKE_LISTS, {version: 'TEST', fetchedAt: new Date().toISOString()}), report: {used: ['builtin'], requested: 'builtin'}};
const yes = () => true;

async function screenedBusiness(t, overrides) {
  const s = t.store();
  const c = createCounterpartyCase(s, fakeBusiness(overrides));
  submit(s, c);
  await runScreening(s, c, {engines, config});
  return {s, c};
}
const checkAll = (s, c) => { for (const p of Object.keys(c.screening.parties)) manualCheck(s, c, {party: p, result: 'no_match', note: 'searched; no match'}); };

test('approval requires a clear screen on the entity AND every beneficial owner', async () => {
  const t = tempEnv();
  try {
    const {s, c} = await screenedBusiness(t);
    assert.equal(c.status, 'needs_review');
    assert.equal(c.screening.parties.entity.decision, 'clear');
    assert.equal(c.screening.parties.bo1.decision, 'potential_match', 'exact name + DOB + country of a synthetic SDN entry');
    checkAll(s, c);
    const b = approvalBlockers(c, {config, store: s});
    assert.ok(b.some((x) => /bo1: potential sanctions match SDN:9000001/.test(x)));
    assert.ok(b.some((x) => /stripe_consulting_to_russia/.test(x)), 'Stripe: no consulting to persons in Russia');
    assert.throws(() => disposition(s, c, {party: 'bo1', hitUid: 'SDN:9000001', as: 'false_positive', reason: 'trying to wave it through', config}), /cannot be dispositioned/);
    await assert.rejects(performSignoff({store: s, caseId: c.id, privateKey: t.privateKey, confirm: yes, config}), /cannot approve: \d+ blocker/);
    assert.equal(s.get(c.id).status, 'needs_review');
    const r = await performSignoff({store: s, caseId: c.id, privateKey: t.privateKey, decision: 'reject', confirm: yes, config});
    assert.equal(r.caseRecord.status, 'rejected');
    assert.equal(r.record.payload.decision, 'reject');
  } finally { t.cleanup(); }
});

test('possible match -> written disposition + manual OFAC check -> Ed25519 sign-off -> approved', async () => {
  const t = tempEnv();
  try {
    const {s, c} = await screenedBusiness(t, {beneficialOwners: [{legalName: 'Jane Q Example', dob: '1980-02-02', country: 'US', ownershipPct: 60}, {legalName: 'Ivan Testovich Fakeman', dob: '1991-05-05', country: 'US', ownershipPct: 30}]});
    const hit = c.screening.parties.bo1.hits.find((h) => h.uid === 'SDN:9000001');
    assert.equal(c.screening.parties.bo1.decision, 'review');
    assert.equal(hit.score, config.screening.review_threshold, 'exact name floored at review despite DOB/country mismatch');
    let b = approvalBlockers(c, {config, store: s});
    assert.ok(b.some((x) => /needs a disposition/.test(x)));
    assert.ok(b.some((x) => x.includes(OFAC_SLS_URL)), 'manual cross-check link is required');
    assert.throws(() => disposition(s, c, {party: 'bo1', hitUid: hit.uid, as: 'false_positive', reason: 'short', config}), /written reason/);
    for (const h of c.screening.parties.bo1.hits) disposition(s, c, {party: 'bo1', hitUid: h.uid, as: 'false_positive', reason: 'DOB 1991 vs listed DOB; US national vs listed nationality; different person.', config});
    checkAll(s, c);
    assert.equal(c.manualChecks[0].automated, false);
    b = approvalBlockers(c, {config, store: s});
    assert.deepEqual(b, []);
    // confirmation declined -> nothing signed
    await assert.rejects(performSignoff({store: s, caseId: c.id, privateKey: t.privateKey, confirm: () => false, config}), /not confirmed/);
    assert.equal(s.get(c.id).status, 'needs_review');
    // a key that is not the committed signer key is refused
    await assert.rejects(performSignoff({store: s, caseId: c.id, privateKey: generateKeyPairSync('ed25519').privateKey, confirm: yes, config}), /does not match the committed/);
    let shown = '';
    const r = await performSignoff({store: s, caseId: c.id, privateKey: t.privateKey, confirm: yes, config, out: (md) => { shown = md; }});
    assert.ok(shown.includes('## Sanctions screening') && shown.includes('## AML monitoring') && shown.includes('## Approval blockers'), 'full output shown before signing');
    const saved = s.get(c.id);
    assert.equal(saved.status, 'approved');
    assert.ok(s.isEffectivelyApproved(saved));
    const p = r.record.payload;
    assert.equal(p.signer, SIGNER_LABEL);
    assert.equal(p.caseId, c.id);
    assert.equal(p.decision, 'approve');
    assert.equal(p.outputSha256, outputSha256(saved));
    assert.ok(Date.parse(p.signedAt));
    assert.equal(Buffer.from(r.record.signature, 'base64').length, 64);
    const ev = readAudit(t.env).filter((e) => e.caseId === c.id).map((e) => e.event);
    assert.ok(ev.includes('signoff') && ev.includes('disposition') && ev.includes('manual_check'));
    assert.equal(verifyAudit(t.env).valid, true);
  } finally { t.cleanup(); }
});

test('sign-off verification: content tampering, signature tampering, registry mismatch', async () => {
  const t = tempEnv();
  try {
    const s = t.store();
    const c = createCounterpartyCase(s, fakeIndividual());
    submit(s, c); await runScreening(s, c, {engines, config}); manualCheck(s, c, {party: 'entity', result: 'no_match'});
    await performSignoff({store: s, caseId: c.id, privateKey: t.privateKey, confirm: yes, config});
    const saved = s.get(c.id);
    assert.equal(verifySignoff(saved.signoff, {signers: s.signers, caseRecord: saved}).valid, true);
    const edited = structuredClone(saved); edited.screening.parties.entity.hits.push({uid: 'SDN:1', score: 0.99});
    assert.match(verifySignoff(edited.signoff, {signers: s.signers, caseRecord: edited}).problems.join(), /content changed/);
    const forged = structuredClone(saved.signoff); forged.payload.decision = 'reject';
    assert.match(verifySignoff(forged, {signers: s.signers}).problems.join(), /signature invalid/);
    const other = tempEnv();
    try { assert.equal(verifySignoff(saved.signoff, {signers: loadSigners(other.env)}).valid, false); } finally { other.cleanup(); }
    assert.equal(s.isEffectivelyApproved(edited), false);
    // re-screening an approved case supersedes its sign-off
    await runScreening(s, saved, {engines, config});
    assert.equal(saved.status, 'needs_review');
    assert.equal(saved.signoff, null);
    assert.ok(saved.history.some((h) => h.supersededSignoff));
  } finally { t.cleanup(); }
});

test('the signed payload covers case id, output hash, decision and timestamp (canonical JSON)', () => {
  const t = tempEnv();
  try {
    const s = t.store();
    const c = s.create('counterparty', {counterparty: fakeIndividual()});
    const rec = createSignoff({caseRecord: c, decision: 'approve', privateKey: t.privateKey, signers: s.signers, now: new Date('2026-11-09T15:40:00Z')});
    assert.deepEqual(Object.keys(JSON.parse(canonicalJson(rec.payload))), ['caseId', 'caseType', 'decision', 'organization', 'outputSha256', 'publicKeySha256', 'schema', 'signedAt', 'signer']);
    assert.equal(rec.payload.signedAt, '2026-11-09T15:40:00.000Z');
    assert.throws(() => createSignoff({caseRecord: c, decision: 'clear', privateKey: t.privateKey, signers: s.signers}), /decision must be/);
    const keyPath = join(t.dir, 'k.pem');
    writeFileSync(keyPath, generateKeyPairSync('x25519').privateKey.export({type: 'pkcs8', format: 'pem'}));
    assert.throws(() => loadPrivateKey(keyPath), /Ed25519/);
    assert.equal(loadPrivateKey(t.keyFile).asymmetricKeyType, 'ed25519');
  } finally { t.cleanup(); }
});

test('intake edits only in draft and reset screening; invalid intake cannot be submitted', async () => {
  const t = tempEnv();
  try {
    const s = t.store();
    const c = createCounterpartyCase(s, fakeIndividual({email: 'bad'}));
    assert.equal(c.validation.ok, false);
    assert.throws(() => submit(s, c), /cannot submit/);
    updateCounterparty(s, c, fakeIndividual());
    submit(s, c);
    assert.throws(() => updateCounterparty(s, c, fakeIndividual()), /only be edited in draft/);
  } finally { t.cleanup(); }
});

test('AML payment case: alerts recorded, review notes, clearance only with approved KYC and sign-off', async () => {
  const t = tempEnv();
  try {
    const s = t.store();
    const c = createCounterpartyCase(s, fakeIndividual({externalIds: ['cus_FAKE_A']}));
    submit(s, c); await runScreening(s, c, {engines, config}); manualCheck(s, c, {party: 'entity', result: 'no_match'});
    const records = fakePayments().filter((p) => p.counterpartyId === 'cus_FAKE_A' && p.currency === 'USD');
    // before KYC approval: alerts attach to the KYC case and payment case cannot be cleared
    let r = runAml(s, records, {openCases: true, config});
    assert.ok(s.get(c.id).aml.alerts.some((a) => a.rule === 'structuring'));
    const pay = s.get(r.openedCases[0]);
    assert.equal(pay.caseType, 'payment');
    let b = approvalBlockers(pay, {config, store: s});
    assert.ok(b.some((x) => /not approved with a valid sign-off/.test(x)));
    assert.ok(b.some((x) => /needs a review note/.test(x)));
    await assert.rejects(performSignoff({store: s, caseId: pay.id, privateKey: t.privateKey, confirm: yes, config}), /cannot clear/);
    // approve the KYC case (its AML alerts are high, not critical, so it can be signed)
    await performSignoff({store: s, caseId: c.id, privateKey: t.privateKey, confirm: yes, config});
    assert.equal(kycIndex(s, config).get('cus_FAKE_A').status, 'approved');
    r = runAml(s, records, {openCases: true, config});
    assert.ok(s.isEffectivelyApproved(s.get(c.id)), 'AML re-runs do not void an approved KYC sign-off');
    const pay2 = s.get(r.openedCases[0]);
    for (const a of pay2.aml.alerts) if (['medium', 'high'].includes(a.severity)) alertNote(s, pay2, {alertId: a.id, note: 'Reviewed invoices; three milestone payments per signed SOW.'});
    b = approvalBlockers(pay2, {config, store: s});
    assert.deepEqual(b, []);
    const res = await performSignoff({store: s, caseId: pay2.id, privateKey: t.privateKey, confirm: yes, config});
    assert.equal(res.caseRecord.status, 'cleared');
    assert.equal(res.record.payload.decision, 'clear');
    // critical alerts block clearance
    const crit = s.create('payment', {counterpartyId: 'cus_FAKE_A', kycCaseId: c.id, aml: {alerts: [{id: 'aml_x', rule: 'sanctions_hit', severity: 'critical', paymentIds: [], summary: 's'}]}});
    assert.ok(approvalBlockers(crit, {config, store: s}).some((x) => /critical AML alert/.test(x)));
  } finally { t.cleanup(); }
});

test('review packet: Markdown and print-ready HTML with an unsigned signature block for Sam Kott and the attorney-review line', async () => {
  const t = tempEnv();
  try {
    const {s, c} = await screenedBusiness(t);
    const {markdown, blockers} = buildPacket(c, {config, signers: s.signers, store: s});
    assert.ok(blockers.length > 0);
    assert.match(markdown, /Signer: \*\*Sam Kott\*\*, Owner, S K Consulting LLC dba Numina Labs/);
    assert.match(markdown, /Signature: _{10,}/);
    assert.match(markdown, /signature: _unsigned_/);
    assert.match(markdown, /npm run compliance:signoff -- --case cp_[0-9a-f]{16} --key/);
    assert.match(markdown, /Attorney review: \*\*PENDING\*\* — dated follow-up due \*\*2026-12-09\*\*\. Blocks the launch of any financial service.*Does not block the numinalabs\.xyz site push\./);
    assert.match(markdown, /OFAC Sanctions List Search\]\(https:\/\/ofac\.treasury\.gov\/sanctions-list-search-tool\)/);
    assert.match(markdown, /does not replace a licensed identity-verification \(IDV\) provider or an attorney/);
    assert.ok(markdown.includes('••••0000'));
    const redacted = buildPacket(c, {config, signers: s.signers, store: s, includePii: false}).markdown;
    assert.ok(!redacted.includes('Jane Q Example') && !redacted.includes('100 Example Ave'));
    const html = markdownToHtml(markdown);
    assert.match(html, /^<!doctype html>/);
    assert.ok(html.includes('<table>') && html.includes('@media print') && html.includes('noindex'));
    assert.ok(!/<script/i.test(html));
    assert.ok(markdownToHtml('| a |\n| --- |\n| <script>x</script> |').includes('&lt;script&gt;'));
  } finally { t.cleanup(); }
});
