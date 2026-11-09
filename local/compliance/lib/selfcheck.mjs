// End-to-end self-check with synthetic data in a temp dir. No network (loopback Watchman probe only).
import {mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, extname} from 'node:path';
import {generateKeyPairSync, createPublicKey, randomBytes} from 'node:crypto';
import {buildIndex} from './lists.mjs';
import {CaseStore} from './store.mjs';
import {loadSigners, spkiSha256, verifySignoff, SIGNER_LABEL} from './signoff-core.mjs';
import {performSignoff} from './signoff.mjs';
import {createCounterpartyCase, submit, runScreening, disposition, manualCheck, approvalBlockers, resolveEngines} from './workflow.mjs';
import {verifyAudit} from './audit.mjs';
import {encryptJson, decryptJson} from './crypto-store.mjs';
import {monitor} from './aml.mjs';
import {buildPacket} from './packet.mjs';
import {scanText, sourceAgeDays, STRIPE_SOURCE} from './merchant-rules.mjs';
import {WatchmanClient, screenWithWatchman} from './watchman.mjs';
import {FAKE_LISTS, FAKE_MANIFEST, fakeBusiness, fakePayments, fakeKycMap, EXPECTED_RULES} from './synthetic.mjs';
import {loadConfig, MODULE_ROOT, REPO_ROOT} from './util.mjs';
import {checkComposeFiles, checkChecklistAndMapping, COMPOSE_FILES} from './configs.mjs';

const NUMINA_OFFERING = 'Numina Labs (S K Consulting LLC) offers AI and software consulting engagements: a $1,500 diagnostic and an optional $7,500 implementation engagement, paid by card through Stripe Checkout.';

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'data' || f.startsWith('.git')) continue;
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

export async function selfCheck({log = () => {}, probeWatchman = true, repoRoot = REPO_ROOT} = {}) {
  const checks = [];
  const check = async (name, fn) => {
    try { const detail = await fn(); checks.push({name, ok: true, detail: detail ?? null}); log(`ok   ${name}${detail ? ` - ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
    catch (e) { checks.push({name, ok: false, error: String(e.message || e)}); log(`FAIL ${name} - ${e.message || e}`); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const config = loadConfig();

  await check('config thresholds sane', () => {
    const s = config.screening;
    assert(s.review_threshold > 0 && s.review_threshold < s.block_threshold && s.block_threshold <= 1, 'need 0 < review < block <= 1');
    assert(s.weak_alias_cap >= s.review_threshold && s.weak_alias_cap < s.block_threshold, 'weak alias cap must route to review, never block/clear');
    assert(config.attorney_review.status && /^\d{4}-\d{2}-\d{2}$/.test(config.attorney_review.follow_up_due), 'attorney review follow-up date missing');
    return `review ${s.review_threshold}, block ${s.block_threshold}, attorney review ${config.attorney_review.status} due ${config.attorney_review.follow_up_due}`;
  });

  await check('committed signer registry (public key only)', () => {
    const signers = loadSigners({});
    const s = signers.get(SIGNER_LABEL);
    assert(s, `${SIGNER_LABEL} missing from keys/signers.json`);
    const raw = readFileSync(join(MODULE_ROOT, 'keys', 'signers.json'), 'utf8');
    assert(!/PRIVATE KEY/.test(raw), 'signers.json contains a private key');
    const repoPem = join(repoRoot, 'manifest-verifier', 'openssl_check', 'skott34-ed25519.pub.pem');
    if (existsSync(repoPem)) assert(spkiSha256(createPublicKey(readFileSync(repoPem))) === s.publicKeySha256, 'signers.json SKOTT34 key differs from manifest-verifier/openssl_check/skott34-ed25519.pub.pem');
    return `${SIGNER_LABEL} ${s.publicKeySha256.slice(0, 16)}…`;
  });

  await check('local-only isolation (no src/, scripts/ or Worker import of local/compliance)', () => {
    const offenders = [];
    for (const dir of ['src', 'scripts', 'public', 'api', 'numinalabs-web']) for (const f of walk(join(repoRoot, dir))) {
      if (!['.js', '.mjs', '.ts', '.cjs', '.html', '.json', '.jsonc'].includes(extname(f))) continue;
      if (/local\/compliance|compliance\/lib\//.test(readFileSync(f, 'utf8'))) offenders.push(relative(repoRoot, f));
    }
    for (const f of ['wrangler.jsonc', 'wrangler.toml']) { const p = join(repoRoot, f); if (existsSync(p) && /local\/compliance/.test(readFileSync(p, 'utf8'))) offenders.push(f); }
    assert(!offenders.length, `public code references the compliance module: ${offenders.join(', ')}`);
    return 'no references';
  });

  await check('gitignore and no secrets/PII in committed module files', () => {
    const gi = readFileSync(join(MODULE_ROOT, '.gitignore'), 'utf8');
    assert(/^data\/$/m.test(gi), 'local/compliance/.gitignore must ignore data/');
    const bad = [];
    for (const f of [...walk(MODULE_ROOT), ...walk(join(repoRoot, 'tests', 'compliance'))]) {
      const t = readFileSync(f, 'utf8');
      if (/-----BEGIN (ENCRYPTED )?PRIVATE KEY-----/.test(t)) bad.push(`${relative(repoRoot, f)}: private key`);
      if (/\b\d{3}-\d{2}-\d{4}\b/.test(t)) bad.push(`${relative(repoRoot, f)}: SSN-like number`);
    }
    assert(!bad.length, bad.join('; '));
    return 'clean';
  });

  await check('merchant rules (Stripe prohibited/restricted) source and Numina offering', () => {
    const age = sourceAgeDays();
    assert(age <= STRIPE_SOURCE.maxAgeDays, `Stripe list snapshot is ${age} days old; re-check ${STRIPE_SOURCE.url}`);
    const f = scanText(NUMINA_OFFERING);
    assert(!f.some((x) => x.level === 'P'), `offering matches prohibited categories: ${f.map((x) => x.category)}`);
    assert(scanText('We run an initial coin offering').some((x) => x.level === 'P'), 'scanner failed to flag a prohibited category');
    return `source last updated ${STRIPE_SOURCE.lastUpdated} (${age} days)`;
  });

  await check('KYC/AML checklist cites FFIEC / OFAC / Stripe sources with dates', () => {
    const cl = JSON.parse(readFileSync(join(MODULE_ROOT, 'checklist.json'), 'utf8'));
    const areas = new Set(cl.items.map((i) => i.area));
    for (const a of ['CIP', 'CDD', 'OFAC', 'SAR', 'Red flags', 'Merchant']) assert(areas.has(a), `checklist missing area ${a}`);
    for (const i of cl.items) {
      const src = cl.sources[i.source];
      assert(src && /^https:\/\/(bsaaml\.ffiec\.gov|ofac\.treasury\.gov|sanctionslistservice\.ofac\.treas\.gov|stripe\.com)\//.test(src.url), `${i.id}: missing/unknown source`);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(src.fetched), `${i.id}: source fetch date missing`);
      assert(['automated', 'manual'].includes(i.control) && i.check, `${i.id}: control/check missing`);
    }
    assert(cl.sources.stripe_restricted.sourceDate === STRIPE_SOURCE.lastUpdated, 'checklist Stripe date differs from merchant-rules');
    return `${cl.items.length} items (${cl.items.filter((i) => i.control === 'automated').length} automated, ${cl.items.filter((i) => i.control === 'manual').length} manual)`;
  });

  await check('local service configs (Watchman, Docassemble, Probo, Comp AI) bind 127.0.0.1 only [config-only, not run]', () => {
    const f = checkComposeFiles();
    assert(!f.length, f.map((x) => `${x.file}:${x.line ?? ''} ${x.issue}`).join('; '));
    return `${COMPOSE_FILES.length} compose files + watchman.yml checked`;
  });

  await check('checklist <-> GRC risk/control/evidence mapping consistent; CHECKLIST.md in sync', () => {
    const r = checkChecklistAndMapping({repoRoot});
    assert(!r.issues.length, r.issues.join('; '));
    return `${r.items} checklist items, ${r.risks} risks, ${r.controls} controls`;
  });

  await check('AES-256-GCM round-trip and tamper detection', () => {
    const key = randomBytes(32);
    const env = encryptJson({probe: 'synthetic'}, key, 'cp_selfcheck');
    assert(decryptJson(env, key).probe === 'synthetic', 'round-trip failed');
    let threw = false; try { decryptJson({...env, ct: Buffer.from('x' + env.ct).toString('base64')}, key); } catch { threw = true; }
    assert(threw, 'tampered ciphertext decrypted');
    threw = false; try { decryptJson(env, randomBytes(32)); } catch { threw = true; }
    assert(threw, 'wrong key decrypted');
  });

  await check('AML rules all fire on synthetic payments', () => {
    const r = monitor(fakePayments(), {kycByCounterparty: fakeKycMap(), config: config.aml});
    const fired = new Set(r.alerts.map((a) => a.rule));
    const missing = EXPECTED_RULES.filter((x) => !fired.has(x));
    assert(!missing.length, `rules did not fire: ${missing.join(', ')}`);
    return `${r.alerts.length} alerts over ${fired.size} rules`;
  });

  let engineReport = {used: ['builtin'], watchman: {status: 'not probed'}};
  await check('end-to-end KYC -> screening -> sign-off (synthetic, throwaway key)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'numina-compliance-selfcheck-'));
    try {
      const {privateKey, publicKey} = generateKeyPairSync('ed25519');
      const signersFile = join(dir, 'signers.json');
      writeFileSync(signersFile, JSON.stringify({signers: [{label: SIGNER_LABEL, publicKeyPem: publicKey.export({type: 'spki', format: 'pem'})}]}));
      const env = {NUMINA_COMPLIANCE_DATA_DIR: join(dir, 'data'), NUMINA_COMPLIANCE_KEY: randomBytes(32).toString('base64'), NUMINA_COMPLIANCE_SIGNERS: signersFile};
      const store = new CaseStore({env, signers: loadSigners(env)});
      const index = buildIndex(FAKE_LISTS, FAKE_MANIFEST);
      const engines = {index, report: {used: ['builtin'], requested: 'builtin'}};
      const c = createCounterpartyCase(store, fakeBusiness({beneficialOwners: [{legalName: 'Jane Q Example', dob: '1980-02-02', country: 'US', ownershipPct: 60}, {legalName: 'Ivan Testovich Fakeman', dob: '1984-05-05', country: 'US', ownershipPct: 30}]}));
      assert(c.validation.ok, `fixture invalid: ${JSON.stringify(c.validation.errors)}`);
      submit(store, c);
      await runScreening(store, c, {engines, config});
      assert(c.status === 'needs_review', `expected needs_review, got ${c.status}`);
      const hit = c.screening.parties.bo1.hits[0];
      assert(hit && hit.uid === 'SDN:9000001', 'beneficial owner should hit the synthetic SDN entry');
      let threw = false; try { store.transition(c, 'approved', {}); } catch { threw = true; }
      assert(threw, 'approval without sign-off was allowed');
      threw = false; try { await performSignoff({store, caseId: c.id, privateKey, confirm: () => true, config}); } catch { threw = true; }
      assert(threw, 'sign-off allowed while blockers were open');
      disposition(store, c, {party: 'bo1', hitUid: hit.uid, as: 'false_positive', reason: 'Synthetic: DOB 1984 and US nationality differ from listed 1970 / Russia.', config});
      for (const p of ['entity', 'dba', 'control', 'bo0', 'bo1']) manualCheck(store, c, {party: p, result: 'no_match', note: 'synthetic self-check'});
      const blockers = approvalBlockers(c, {config, store});
      assert(!blockers.length, `unexpected blockers: ${blockers.join('; ')}`);
      const wrong = generateKeyPairSync('ed25519').privateKey;
      threw = false; try { await performSignoff({store, caseId: c.id, privateKey: wrong, confirm: () => true, config}); } catch { threw = true; }
      assert(threw, 'a key not in the registry was accepted');
      const r = await performSignoff({store, caseId: c.id, privateKey, confirm: () => true, config});
      const saved = store.get(c.id);
      assert(saved.status === 'approved' && store.isEffectivelyApproved(saved), 'case not approved after valid sign-off');
      assert(verifySignoff(r.record, {signers: store.signers, caseRecord: saved}).valid, 'sign-off did not verify');
      saved.counterparty.legalName = 'Tampered Name LLC';
      assert(!verifySignoff(saved.signoff, {signers: store.signers, caseRecord: saved}).valid, 'tampered case still verified');
      const a = verifyAudit(env);
      assert(a.valid && a.count >= 8, `audit chain invalid: ${a.problems.join('; ')}`);
      const md = buildPacket(store.get(c.id), {config, signers: store.signers, store}).markdown;
      assert(md.includes('Attorney review: **PENDING**') && md.includes('Sam Kott') && md.includes('VALID'), 'packet missing signature block / attorney line');
      return `case ${c.id} approved via throwaway-key sign-off; audit ${a.count} entries`;
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });

  await check('screening engine probe', async () => {
    if (!probeWatchman) return 'skipped';
    const e = await resolveEngines({engine: 'auto', index: buildIndex(FAKE_LISTS, FAKE_MANIFEST)});
    engineReport = e.report;
    if (e.watchman) {
      const r = await screenWithWatchman(e.watchman, 'Zzqx Fakeperson Placeholderovich', {type: 'individual'}, {config: config.screening, info: e.watchmanInfo});
      assert(r.decision === 'clear', `synthetic name should be clear on Watchman, got ${r.decision}`);
      return `watchman running at ${e.watchman.base} (${Object.entries(e.watchmanInfo.lists).map(([k, v]) => `${k}:${v}`).join(', ')}) + builtin`;
    }
    return `builtin fuzzy matcher (fallback: Watchman ${e.report.watchman?.status}: ${e.report.watchman?.error ?? ''})`;
  });

  return {ok: checks.every((c) => c.ok), checks, engineReport};
}
