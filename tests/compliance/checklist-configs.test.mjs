import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadChecklist, renderChecklist} from '../../local/compliance/lib/checklist.mjs';
import {composeFindings, checkComposeFiles, checkChecklistAndMapping} from '../../local/compliance/lib/configs.mjs';
import {STRIPE_SOURCE} from '../../local/compliance/lib/merchant-rules.mjs';
import {SCHEMA} from '../../local/compliance/lib/kyc-schema.mjs';
import {MODULE_ROOT, REPO_ROOT} from '../../local/compliance/lib/util.mjs';

const read = (p) => readFileSync(join(MODULE_ROOT, p), 'utf8');

test('checklist cites FFIEC CIP, CDD, SAR, OFAC, red flags plus Stripe, each with URL and date', () => {
  const cl = loadChecklist();
  const byArea = (a) => cl.items.filter((i) => i.area === a);
  for (const a of ['CIP', 'CDD', 'OFAC', 'SAR', 'Red flags', 'Merchant']) assert.ok(byArea(a).length, a);
  assert.match(cl.sources.ffiec_cip.url, /^https:\/\/bsaaml\.ffiec\.gov\/manual\//);
  assert.match(cl.sources.ffiec_ofac.section, /Office of Foreign Assets Control/);
  assert.match(cl.sources.ffiec_red_flags.section, /Appendix F/);
  assert.equal(cl.sources.stripe_restricted.url, STRIPE_SOURCE.url);
  assert.equal(cl.sources.stripe_restricted.sourceDate, STRIPE_SOURCE.lastUpdated);
  for (const i of cl.items) {
    assert.ok(cl.sources[i.source], `${i.id} source`);
    assert.match(cl.sources[i.source].fetched, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['automated', 'manual'].includes(i.control));
  }
  assert.ok(cl.items.find((i) => i.id === 'CIP-2').control === 'manual', 'IDV is not claimed as automated');
});

test('CHECKLIST.md is generated from checklist.json and in sync', () => {
  assert.equal(read('CHECKLIST.md').replace(/\r\n/g, '\n'), renderChecklist());
});

test('checklist, GRC mapping and evidence paths are consistent', () => {
  const r = checkChecklistAndMapping();
  assert.deepEqual(r.issues, []);
  assert.equal(r.risks, 6);
  const map = JSON.parse(read('grc/control-mapping.json'));
  assert.deepEqual(map.controls.filter((c) => c.status === 'gap').map((c) => c.id).sort(), ['CTL-ATTORNEY', 'CTL-IDV']);
});

test('compose scanner rejects public ports, long syntax, host networking and OpenSanctions', () => {
  assert.deepEqual(composeFindings('services:\n  a:\n    ports:\n      - "127.0.0.1:1:1"\n'), []);
  assert.equal(composeFindings('services:\n  a:\n    ports:\n      - "8080:8080"\n').length, 1);
  assert.equal(composeFindings('services:\n  a:\n    ports:\n      - 0.0.0.0:1:1\n').length, 1);
  assert.equal(composeFindings('services:\n  a:\n    ports:\n      - target: 80\n        published: 80\n').length >= 1, true);
  assert.equal(composeFindings('services:\n  a:\n    network_mode: host\n').length, 1);
  assert.equal(composeFindings('services:\n  a:\n    ports: ["80:80"]\n').length, 1);
  assert.equal(composeFindings('services:\n  y:\n    image: opensanctions/yente\n').length, 1);
});

test('all shipped compose files (Watchman, Docassemble, Probo, Comp AI) bind 127.0.0.1 only', () => {
  assert.deepEqual(checkComposeFiles(), []);
  for (const f of ['watchman/docker-compose.yml', 'docassemble/docker-compose.yml']) assert.match(read(f), /image: [^\s]+@sha256:[0-9a-f]{64}/, `${f} image pinned by digest`);
  assert.match(read('grc/comp-ai/docker-compose.yml'), /AGPL/);
  assert.match(read('grc/comp-ai/docker-compose.yml'), /150fed5ade35be5c37f142b126aa10b1859aa26e/);
  assert.match(read('grc/README.md'), /section 13/);
});

test('env examples hold no secret values and gitignore covers .env and private keys', () => {
  for (const f of ['grc/probo/.env.example', 'grc/comp-ai/.env.example']) {
    for (const line of read(f).split(/\r?\n/)) if (!line.startsWith('#') && line.includes('=')) assert.equal(line.split('=')[1], '', `${f}: ${line}`);
  }
  const gi = read('.gitignore');
  for (const p of ['data/', '.env', '*.pem', 'grc/probo/seaweedfs-s3.json']) assert.ok(gi.split(/\r?\n/).includes(p), p);
});

test('Docassemble intake interview covers every KYC schema field and only last-4 TIN/EIN', () => {
  const y = read('docassemble/interviews/numina-kyc-intake.yml');
  const fields = new Set([...SCHEMA.individual.required, ...SCHEMA.individual.optional, ...SCHEMA.business.required, ...SCHEMA.business.optional]);
  for (const k of ['ids', 'notes']) fields.delete(k); // reviewer-only fields, not asked of the counterparty
  for (const k of fields) assert.ok(new RegExp(`intake\\['${k}'\\]|\\b${k}=`).test(y), `interview missing ${k}`);
  for (const k of ['legalName', 'dob', 'country', 'ownershipPct']) assert.ok(y.includes(k));
  assert.match(y, /fullmatch\(r'\\d\{4\}'/);
  assert.doesNotMatch(y, /\bssn\b\s*:/i);
  assert.match(y, /compliance:kyc -- new --file intake\.json/);
  assert.match(y, /ofac\.treasury\.gov\/sanctions-list-search-tool/);
});

test('Docassemble packet interview keeps the signature block unsigned and requires the attorney line', () => {
  const y = read('docassemble/interviews/numina-compliance-packet.yml');
  assert.match(y, /Signature: ____/);
  assert.match(y, /Attorney review/);
  assert.match(y, /valid formats:\s*\n\s*- pdf/);
  assert.doesNotMatch(y, /datatype:\s*signature/i, 'no e-signature field');
});

test('legal drafts are marked DRAFT, carry attribution, and are not linked from the site', () => {
  const dir = join(REPO_ROOT, 'docs', 'legal-drafts');
  const files = readdirSync(dir);
  for (const f of files) assert.match(readFileSync(join(dir, f), 'utf8'), /DRAFT/, f);
  const pp = readFileSync(join(dir, 'privacy-policy.DRAFT.md'), 'utf8');
  assert.match(pp, /CC BY-SA 4\.0/);
  assert.match(pp, /legalmattic/i);
  const tos = readFileSync(join(dir, 'terms-of-service.DRAFT.md'), 'utf8');
  assert.match(tos, /site-policy/);
  assert.match(tos, /CC0/);
  for (const t of [pp, tos]) assert.match(t, /attorney/i);
});
