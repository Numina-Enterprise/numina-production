// Renders checklist.json (FFIEC BSA/AML + OFAC + Stripe merchant rules) to Markdown.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_ROOT } from './util.mjs';

export function loadChecklist(path = join(MODULE_ROOT, 'checklist.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function renderChecklist(cl = loadChecklist()) {
  const out = [];
  out.push(`# ${cl.title}`, '', '<!-- Generated from checklist.json by `npm run compliance -- checklist --out local/compliance/CHECKLIST.md`. Do not edit by hand. -->', '');
  out.push(`> ${cl.note}`, '');
  out.push('Status key: **automated** = enforced or computed by this module and exercised by `npm run compliance:gate`; **manual** = a human (Sam Kott) must do and record it.', '');
  const areas = [...new Set(cl.items.map((i) => i.area))];
  for (const area of areas) {
    out.push(`## ${area}`, '');
    for (const i of cl.items.filter((x) => x.area === area)) {
      const s = cl.sources[i.source];
      out.push(`- [ ] **${i.id}** (${i.control}) ${i.text}`);
      out.push(`  - Source: ${s.section ? `${s.section}, ` : ''}${s.url}${s.sourceDate ? ` (source last updated ${s.sourceDate})` : ''}; fetched ${s.fetched}`);
      out.push(`  - Implemented by: \`${i.check}\``);
    }
    out.push('');
  }
  out.push('## Sources', '');
  for (const [k, s] of Object.entries(cl.sources)) out.push(`- \`${k}\`: ${s.section ? `${s.section} — ` : ''}${s.url}${s.sourceDate ? ` (last updated ${s.sourceDate})` : ''}, fetched ${s.fetched}`);
  out.push('');
  return out.join('\n');
}
