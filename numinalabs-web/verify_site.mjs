import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = ['index.html', 'style.css', '_headers'];
for (const file of files) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) {
    console.error(`FAIL: Missing ${file}`);
    process.exit(1);
  }
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const requiredStrings = [
  '726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd',
  'UNPAUSED_AND_ACTIVE',
  'skott34-ed25519',
  'https://www.numinalabs.xyz',
  '1.5 Quadrillion',
  'com.numinalabs.treasury'
];

for (const s of requiredStrings) {
  if (!html.includes(s)) {
    console.error(`FAIL: Missing required invariant string in index.html: ${s}`);
    process.exit(1);
  }
}

console.log("PASS: numinalabs.xyz web site bundle verified cleanly.");
console.log(`Verified files: ${files.join(', ')}`);
console.log(`Cluster state root and all 6 core invariant anchors present.`);
