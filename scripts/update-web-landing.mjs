import fs from 'node:fs';

const path = 'public/index.html';
let html = fs.readFileSync(path, 'utf8');

// Replace mojibake sequences with clean semantic typography
html = html.replace(/NUMINA \? Intelligence in Motion/g, 'NUMINA — Intelligence in Motion');
html = html.replace(/01\?\"06/g, '01—06');
html = html.replace(/View all services \+-/g, 'View all services &rarr;');
html = html.replace(/\+-<\/span>/g, '&rarr;</span>');
html = html.replace(/NUMINA A numinalabs.xyz/g, 'NUMINA &bull; numinalabs.xyz');

// Inject live institutional status banner into hero section
const banner = '<div class="status-indicator-badge" style="display:inline-flex;align-items:center;gap:8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);color:#10b981;padding:6px 14px;border-radius:9999px;font-size:0.82rem;font-weight:600;margin-bottom:1.5rem;"><span style="width:8px;height:8px;background:#10b981;border-radius:50%;box-shadow:0 0 10px #10b981;"></span> Sovereign Core: Google Cloud Platform (us-central1) | IBM Qiskit Runtime &amp; Gemini 3.8 Live Integrated</div>';

if (!html.includes('status-indicator-badge')) {
  html = html.replace('<div class="hero-copy">', '<div class="hero-copy">' + banner);
}

fs.writeFileSync(path, html, 'utf8');
console.log('Updated public/index.html successfully');
