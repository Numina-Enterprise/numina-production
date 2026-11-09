#!/usr/bin/env node
// Local-only compliance CLI for SK Consulting LLC dba Numina Labs. Never imported by src/ or the Worker.
import {readFileSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import {join, resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {updateLists} from '../lib/lists.mjs';
import {resolveEngines, screenParty, createCounterpartyCase, updateCounterparty, submit, runScreening, disposition, manualCheck, runAml, alertNote, approvalBlockers} from '../lib/workflow.mjs';
import {CaseStore} from '../lib/store.mjs';
import {loadSigners, verifySignoff} from '../lib/signoff-core.mjs';
import {performSignoff} from '../lib/signoff.mjs';
import {buildPacket, markdownToHtml} from '../lib/packet.mjs';
import {verifyAudit} from '../lib/audit.mjs';
import {generateKey} from '../lib/crypto-store.mjs';
import {paymentsFromCsv} from '../lib/aml.mjs';
import {scanText, STRIPE_SOURCE} from '../lib/merchant-rules.mjs';
import {loadConfig, dataDir, ensureDir} from '../lib/util.mjs';
import {renderChecklist} from '../lib/checklist.mjs';

export function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return {pos, flags};
}

const need = (flags, k) => { if (flags[k] === undefined || flags[k] === true) throw new Error(`--${k} is required`); return flags[k]; };
const print = (x) => process.stdout.write((typeof x === 'string' ? x : JSON.stringify(x, null, 2)) + '\n');
const store = () => new CaseStore({signers: loadSigners()});

const HELP = `Numina Labs local compliance (screening aid, not legal advice)
  update-sdn                               download OFAC SDN + consolidated lists into the gitignored data dir
  engines                                  report which screening engines are available (Watchman / built-in)
  screen --name N [--type individual|business] [--country CC] [--dob YYYY-MM-DD] [--engine auto|watchman|builtin|both]
  keygen-data-key                          print a new AES-256 key for NUMINA_COMPLIANCE_KEY
  kyc new --file intake.json | edit --case ID --file f | submit --case ID | screen --case ID
  kyc disposition --case ID --party P --hit UID --as false_positive|true_match --reason TEXT
  kyc manual-check --case ID --party P --result no_match|possible_match [--note TEXT]
  kyc reject --case ID --reason TEXT | show --case ID | list | blockers --case ID
  aml --input payments.csv [--open-cases] [--fx EUR=1.08,GBP=1.27]
  alert-note --case ID --alert AID --note TEXT
  signoff --case ID --key ed25519.pem [--decision approve|reject|clear] [--confirm ID] [--passphrase-env VAR]
  packet --case ID [--html] [--out FILE] [--redact]
  verify [--case ID]                       verify the audit chain and sign-offs
  merchant-scan --path FILE_OR_DIR         scan offering text for Stripe prohibited/restricted categories
  checklist [--out FILE]                   render checklist.json (FFIEC / OFAC / Stripe citations) as Markdown`;

export async function main(argv = process.argv.slice(2)) {
  const {pos, flags} = parseArgs(argv);
  const [cmd, sub] = pos;
  const config = loadConfig();
  switch (cmd) {
    case undefined: case 'help': print(HELP); return 0;
    case 'update-sdn': {
      const m = await updateLists({log: (s) => process.stderr.write(`${s}\n`)});
      print({version: m.version, fetchedAt: m.fetchedAt, publicationDate: m.publicationDate, files: m.files.map((f) => ({file: f.file, rows: f.rows, bytes: f.bytes, sha256: f.sha256}))});
      return 0;
    }
    case 'engines': { const e = await resolveEngines({engine: flags.engine ?? config.screening.engine}).catch((err) => ({report: {error: err.message}})); print(e.report); return e.report.error ? 1 : 0; }
    case 'screen': {
      const engines = await resolveEngines({engine: flags.engine ?? config.screening.engine});
      const r = await screenParty({name: need(flags, 'name'), type: flags.type, country: flags.country, dob: flags.dob, role: 'adhoc'}, engines, {config: config.screening});
      print({engineReport: engines.report, ...r, engines: undefined});
      return r.decision === 'clear' ? 0 : 3;
    }
    case 'keygen-data-key': print(generateKey()); process.stderr.write('Store this in your password manager and set NUMINA_COMPLIANCE_KEY. Never commit it.\n'); return 0;
    case 'kyc': {
      const s = store();
      if (sub === 'new') { const c = createCounterpartyCase(s, JSON.parse(readFileSync(need(flags, 'file'), 'utf8'))); print({id: c.id, status: c.status, validation: c.validation}); return c.validation.ok ? 0 : 2; }
      if (sub === 'list') { print(s.list().map((c) => ({id: c.id, type: c.caseType, status: c.status, risk: c.risk?.score ?? null, approved: s.isEffectivelyApproved(c)}))); return 0; }
      const c = s.get(need(flags, 'case'));
      if (sub === 'edit') { updateCounterparty(s, c, JSON.parse(readFileSync(need(flags, 'file'), 'utf8'))); print({id: c.id, validation: c.validation}); return 0; }
      if (sub === 'submit') { submit(s, c); print({id: c.id, status: c.status}); return 0; }
      if (sub === 'screen') {
        const engines = await resolveEngines({engine: flags.engine ?? config.screening.engine});
        await runScreening(s, c, {engines, config});
        print({id: c.id, status: c.status, engines: engines.report, decisions: Object.fromEntries(Object.entries(c.screening.parties).map(([k, v]) => [k, {decision: v.decision, hits: v.hits.map((h) => ({uid: h.uid, score: h.score, engine: h.engine}))}])), blockers: approvalBlockers(c, {config, store: s})});
        return 0;
      }
      if (sub === 'disposition') { disposition(s, c, {party: need(flags, 'party'), hitUid: need(flags, 'hit'), as: need(flags, 'as'), reason: need(flags, 'reason'), config}); print({ok: true}); return 0; }
      if (sub === 'manual-check') { manualCheck(s, c, {party: need(flags, 'party'), result: need(flags, 'result'), note: flags.note || ''}); print({ok: true}); return 0; }
      if (sub === 'reject') { s.transition(c, 'rejected', {reason: need(flags, 'reason')}); print({id: c.id, status: c.status}); return 0; }
      if (sub === 'blockers') { print(approvalBlockers(c, {config, store: s})); return 0; }
      if (sub === 'show') { print({...c, effectivelyApproved: s.isEffectivelyApproved(c)}); return 0; }
      throw new Error(`unknown kyc subcommand ${sub}`);
    }
    case 'aml': {
      const records = paymentsFromCsv(readFileSync(need(flags, 'input'), 'utf8'));
      const fxRates = Object.fromEntries(String(flags.fx || '').split(',').filter(Boolean).map((x) => { const [k, v] = x.split('='); return [k.toUpperCase(), Number(v)]; }));
      const r = runAml(store(), records, {openCases: Boolean(flags['open-cases']), config, fxRates});
      print({payments: r.paymentCount, alerts: r.alerts.length, bySeverity: r.alerts.reduce((m, a) => ({...m, [a.severity]: (m[a.severity] || 0) + 1}), {}), openedCases: r.openedCases, alertsDetail: r.alerts});
      return r.alerts.some((a) => a.severity === 'critical' || a.severity === 'high') ? 3 : 0;
    }
    case 'alert-note': { const s = store(); alertNote(s, s.get(need(flags, 'case')), {alertId: need(flags, 'alert'), note: need(flags, 'note')}); print({ok: true}); return 0; }
    case 'signoff': {
      const s = store();
      const caseId = need(flags, 'case');
      const passphrase = flags['passphrase-env'] ? process.env[flags['passphrase-env']] : undefined;
      const confirm = async (_md, id) => {
        if (flags.confirm !== undefined) return flags.confirm === id;
        if (!process.stdin.isTTY) throw new Error('interactive confirmation needs a terminal (or pass --confirm <case id>)');
        const rl = createInterface({input: process.stdin, output: process.stderr});
        const answer = await rl.question(`\nReviewed the full output above? Type the case id (${id}) to sign as SKOTT34-Ed25519, anything else to abort: `);
        rl.close();
        return answer.trim() === id;
      };
      const r = await performSignoff({store: s, caseId, keyPath: need(flags, 'key'), decision: flags.decision, passphrase, confirm, config, out: (md) => process.stderr.write(md)});
      const {markdown} = buildPacket(r.caseRecord, {config, signers: s.signers, store: s});
      const dir = ensureDir(join(dataDir(), 'packets'));
      writeFileSync(join(dir, `${caseId}.md`), markdown, {mode: 0o600});
      print({caseId, status: r.caseRecord.status, signoff: r.record, verification: r.verification.valid ? 'VALID' : r.verification.problems});
      return 0;
    }
    case 'packet': {
      const s = store();
      const c = s.get(need(flags, 'case'));
      const {markdown} = buildPacket(c, {config, signers: s.signers, store: s, includePii: !flags.redact});
      const body = flags.html ? markdownToHtml(markdown, `Compliance packet ${c.id}`) : markdown;
      const outPath = flags.out && flags.out !== true ? resolve(flags.out) : join(ensureDir(join(dataDir(), 'packets')), `${c.id}.${flags.html ? 'html' : 'md'}`);
      writeFileSync(outPath, body, {mode: 0o600});
      print({written: outPath, note: 'Packet contains PII unless --redact. Keep it in the gitignored data dir.'});
      return 0;
    }
    case 'verify': {
      const a = verifyAudit();
      const s = store();
      const cases = flags.case ? [s.get(flags.case)] : s.list();
      const sig = cases.filter((c) => c.signoff).map((c) => ({id: c.id, status: c.status, ...verifySignoff(c.signoff, {signers: s.signers, caseRecord: c})}));
      print({audit: a, signoffs: sig.map(({payload, ...x}) => x)});
      return a.valid && sig.every((x) => x.valid) ? 0 : 1;
    }
    case 'merchant-scan': {
      const p = resolve(need(flags, 'path'));
      const files = statSync(p).isDirectory() ? readdirSync(p, {recursive: true}).map((f) => join(p, String(f))).filter((f) => ['.html', '.md', '.txt', '.json'].includes(extname(f)) && statSync(f).isFile()) : [p];
      const findings = files.flatMap((f) => scanText(readFileSync(f, 'utf8').replace(/<[^>]+>/g, ' '), {source: f}));
      print({source: STRIPE_SOURCE, files: files.length, findings});
      return findings.some((f) => f.level === 'P') ? 3 : 0;
    }
    case 'checklist': {
      const md = renderChecklist();
      if (flags.out) { writeFileSync(resolve(flags.out), md); print({written: resolve(flags.out)}); } else print(md);
      return 0;
    }
    default: throw new Error(`unknown command ${cmd}\n${HELP}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`error: ${e.message}\n`); process.exitCode = 1; });
