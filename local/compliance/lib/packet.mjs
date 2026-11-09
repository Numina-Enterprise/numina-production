// Review packet (Markdown + print-ready HTML) with Sam Kott's signature block and the attorney-review line.
import {outputSha256, SIGNER_LABEL, verifySignoff} from './signoff-core.mjs';
import {approvalBlockers, OFAC_SLS_URL} from './workflow.mjs';
import {partiesOf} from './kyc-schema.mjs';
import {STRIPE_SOURCE} from './merchant-rules.mjs';
import {loadConfig} from './util.mjs';

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const mask = (s) => (s ? `${String(s).slice(0, 2)}***@${String(s).split('@')[1] ?? ''}` : '');

export function buildPacket(c, {config = loadConfig(), now = new Date(), signers, store, includePii = true} = {}) {
  const org = config.organization;
  const blockers = c.signoff ? (c.blockers || []) : approvalBlockers(c, {config, now, store});
  const L = [];
  L.push(`# Compliance review packet: ${c.id}`, '');
  L.push(`**${org.legal_name} dba ${org.dba}** · local-only record · generated ${now.toISOString()}`, '');
  L.push('> Screening and monitoring aid only. Not legal advice. Does not create an attorney-client relationship and does not replace a licensed identity-verification (IDV) provider or an attorney.', '');
  L.push('## Case', '', '| Field | Value |', '| --- | --- |');
  L.push(`| Case type | ${c.caseType} |`, `| Status | ${c.status} |`, `| Created | ${c.createdAt} |`, `| Output sha256 | \`${outputSha256(c)}\` |`);
  if (c.risk) L.push(`| Risk score | ${c.risk.score} / 100 (${c.risk.band}) |`);
  L.push('');
  if (c.caseType === 'counterparty') {
    const cp = c.counterparty;
    L.push('## KYC intake', '', '| Field | Value |', '| --- | --- |');
    L.push(`| Type | ${esc(cp.type)} |`, `| Legal name | ${esc(includePii ? cp.legalName : '[redacted]')} |`);
    if (cp.dba) L.push(`| DBA | ${esc(cp.dba)} |`);
    L.push(`| Country | ${esc(cp.country)} |`);
    if (includePii) L.push(`| Address | ${esc([cp.address?.line1, cp.address?.line2, cp.address?.city, cp.address?.region, cp.address?.postalCode, cp.address?.country].filter(Boolean).join(', '))} |`);
    if (cp.type === 'individual') L.push(`| DOB | ${includePii ? esc(cp.dob) : '[redacted]'} |`, `| TIN last 4 | ${cp.tinLast4 ? '••••' + esc(cp.tinLast4) : '—'} |`);
    else L.push(`| Incorporated | ${esc(cp.incorporationDate)} ${esc(cp.incorporationCountry || '')} |`, `| EIN last 4 | ••••${esc(cp.einLast4)} |`, `| Control person | ${esc(includePii ? cp.controlPerson?.legalName : '[redacted]')} |`);
    L.push(`| Email | ${esc(includePii ? cp.email : mask(cp.email))} |`, `| Website | ${esc(cp.website || '—')} |`, '');
    if (cp.type === 'business') {
      L.push('### Beneficial owners (25%+)', '');
      if (!cp.beneficialOwners?.length) L.push(cp.noBeneficialOwnersAttestation ? '_Attested: no individual owns 25% or more._' : '_None listed._');
      else { L.push('| # | Name | Country | Ownership |', '| --- | --- | --- | --- |'); cp.beneficialOwners.forEach((o, i) => L.push(`| bo${i} | ${esc(includePii ? o.legalName : '[redacted]')} | ${esc(o.country)} | ${esc(o.ownershipPct)}% |`)); }
      L.push('');
    }
    L.push('### Validation', '', c.validation?.ok ? 'All required fields valid.' : `**${c.validation?.errors.length} error(s):**`);
    for (const e of c.validation?.errors || []) L.push(`- \`${e.path}\` ${e.message}`);
    for (const w of c.validation?.warnings || []) L.push(`- warning \`${w.path}\` ${w.message}`);
    L.push('', '### Identity verification', '', `${c.idv?.status ?? 'not_performed'}: ${c.idv?.note ?? ''}`, '');
    L.push('## Sanctions screening', '');
    if (!c.screening) L.push('_Not screened._', '');
    else {
      const e = c.screening.engines;
      L.push(`Screened ${c.screening.screenedAt}. Engines used: **${e.used.join(' + ')}**${e.fallback ? ` (${e.fallback})` : ''}.`, '');
      for (const p of partiesOf(cp)) {
        const r = c.screening.parties[p.key];
        if (!r) { L.push(`- **${p.key}** (${p.role}): not screened`); continue; }
        L.push(`### ${p.key} · ${p.role} · decision: ${r.decision}`, '', `List version: \`${esc(r.listVersion)}\``, '');
        if (r.hits.length) {
          L.push('| Engine | List uid | Listed name | Score | Programs | Disposition |', '| --- | --- | --- | --- | --- | --- |');
          for (const h of r.hits) {
            const d = (c.dispositions || []).find((x) => x.party === p.key && x.hitUid === h.uid);
            L.push(`| ${h.engine} | ${esc(h.uid)} | ${esc(h.listName)} | ${h.score} | ${esc((h.programs || []).join(', '))} | ${d ? `${d.disposition}: ${esc(d.reason)}` : '**open**'} |`);
          }
        } else L.push('No hits at or above the review threshold.');
        if (r.discounted?.length) L.push('', `Discounted by DOB/country/type corroboration: ${r.discounted.map((h) => `${h.uid} (${h.score})`).join(', ')}`);
        const m = (c.manualChecks || []).find((x) => x.party === p.key);
        L.push('', `Manual cross-check (human, not automated) in [OFAC Sanctions List Search](${OFAC_SLS_URL}): ${m ? `**${m.result}** by ${esc(m.by)} at ${m.at}${m.note ? ` — ${esc(m.note)}` : ''}` : '☐ not yet recorded'}`, '');
      }
    }
    if (c.merchantRules?.length) { L.push('## Merchant rules (Stripe prohibited/restricted)', '', `Source: ${STRIPE_SOURCE.url} (last updated ${STRIPE_SOURCE.lastUpdated})`, ''); for (const f of c.merchantRules) L.push(`- **${f.level}** ${f.rule}: ${f.detail}`); L.push(''); }
  } else {
    L.push('## Payments under review', '', `Counterparty: \`${esc(c.counterpartyId)}\` · KYC case: \`${esc(c.kycCaseId ?? 'none')}\``, '');
    L.push('| Id | Amount | Currency | When | Type | Country |', '| --- | --- | --- | --- | --- | --- |');
    for (const p of c.payments || []) L.push(`| ${esc(p.id)} | ${p.amount} | ${esc(p.currency)} | ${new Date(typeof p.timestamp === 'number' ? p.timestamp : Date.parse(p.timestamp)).toISOString()} | ${esc(p.type || 'payment')} | ${esc(p.country || '')} |`);
    L.push('');
  }
  L.push('## AML monitoring', '');
  const alerts = c.aml?.alerts || [];
  if (!alerts.length) L.push(c.aml ? 'No alerts.' : '_No transaction monitoring run on record._');
  else { L.push('| Severity | Rule | Summary | Payments | Review |', '| --- | --- | --- | --- | --- |'); for (const a of alerts) { const d = (c.dispositions || []).find((x) => x.alertId === a.id); L.push(`| ${a.severity} | ${a.rule} | ${esc(a.summary)} | ${esc(a.paymentIds.join(', '))} | ${d ? esc(d.reason) : '—'} |`); } }
  L.push('');
  if (c.risk) { L.push('## Risk score', '', `**${c.risk.score} / 100 (${c.risk.band})**`, ''); for (const x of c.risk.components) L.push(`- ${x.factor}: +${x.points}${x.detail ? ` (${esc(x.detail)})` : ''}`); L.push(''); }
  L.push('## Approval blockers', '');
  if (c.signoff) L.push(blockers.length ? `At sign-off (${c.signoff.payload.decision}): ${blockers.length} blocker(s):` : `None at sign-off (${c.signoff.payload.signedAt}).`);
  if (blockers.length) for (const x of blockers) L.push(`- ☐ ${esc(x)}`); else if (!c.signoff) L.push('None. Eligible for human sign-off.');
  L.push('', '## Sign-off', '');
  L.push(`Signer: **${org.owner}**, ${org.owner_title}, ${org.legal_name} dba ${org.dba}`, '');
  if (c.signoff) {
    const v = signers ? verifySignoff(c.signoff, {signers, caseRecord: c}) : {valid: null, problems: ['no signer registry loaded']};
    L.push(`Decision: **${c.signoff.payload.decision}** · signed ${c.signoff.payload.signedAt} · key ${c.signoff.payload.signer} (\`${c.signoff.payload.publicKeySha256.slice(0, 16)}…\`)`, '');
    L.push(`Ed25519 signature: \`${c.signoff.signature}\``, '', `Verification against committed public key: **${v.valid ? 'VALID' : v.valid === false ? `INVALID (${v.problems.join('; ')})` : 'not checked'}**`, '');
  } else {
    L.push('Signature: ________________________________   Date: ______________', '');
    L.push(`Ed25519 (${SIGNER_LABEL}) signature: _unsigned_. Finalize only with: \`npm run compliance:signoff -- --case ${c.id} --key <path-to-ed25519.pem>\``, '');
  }
  const ar = config.attorney_review;
  L.push('## Attorney review', '', `Attorney review: **${ar.status}** — dated follow-up due **${ar.follow_up_due}**. ${ar.scope}`, '');
  return {markdown: L.join('\n') + '\n', blockers};
}

/** Small Markdown -> HTML renderer for the packet subset (headings, tables, lists, quotes, code, bold, links). */
export function markdownToHtml(md, title = 'Compliance review packet') {
  const inline = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  const out = []; const lines = md.split('\n'); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^#{1,6} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`); i++; continue; }
    if (l.startsWith('|')) {
      const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.slice(1, -1).split(/(?<!\\)\|/).map((x) => inline(x.trim().replace(/\\\|/g, '|')));
      out.push('<table><thead><tr>' + cells(rows[0]).map((x) => `<th>${x}</th>`).join('') + '</tr></thead><tbody>' + rows.slice(2).map((r) => '<tr>' + cells(r).map((x) => `<td>${x}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (l.startsWith('- ')) { const items = []; while (i < lines.length && lines[i].startsWith('- ')) items.push(`<li>${inline(lines[i++].slice(2))}</li>`); out.push(`<ul>${items.join('')}</ul>`); continue; }
    if (l.startsWith('> ')) { out.push(`<blockquote>${inline(l.slice(2))}</blockquote>`); i++; continue; }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    i++;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title><style>
body{font:11pt/1.45 Georgia,serif;max-width:52rem;margin:2rem auto;color:#111}h1{font-size:18pt}h2{font-size:13pt;border-bottom:1px solid #999;margin-top:1.6em}
table{border-collapse:collapse;width:100%;margin:.5em 0}th,td{border:1px solid #bbb;padding:.25em .4em;text-align:left;vertical-align:top;font-size:9.5pt}
code{font-size:8.5pt;word-break:break-all}blockquote{border-left:3px solid #888;margin:0;padding:.3em .8em;color:#333}
@media print{body{margin:0}a{color:inherit}h2{page-break-after:avoid}table{page-break-inside:avoid}}
</style></head><body>${out.join('\n')}</body></html>\n`;
}
