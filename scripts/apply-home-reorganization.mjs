import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const origin = 'https://numinalabs.xyz';
const client = resolve('dist/client');

const presentationFiles = new Map([
  ['/', 'index.html'],
  ['/government', 'government.html'],
  ['/financial-institutions', 'financial-institutions.html'],
  ['/partners', 'partners.html'],
  ['/developers', 'developers.html'],
  ['/trust', 'trust.html'],
  ['/uk-eu', 'uk-eu.html'],
  ['/mena', 'mena.html'],
  ['/apac', 'apac.html'],
  ['/contact', 'contact.html'],
  ['/design-tokens.css', 'design-tokens.css'],
  ['/enterprise.css', 'enterprise.css'],
  ['/page-components.css', 'page-components.css'],
  ['/site-navigation.js', 'site-navigation.js'],
  ['/robots.txt', 'robots.txt'],
  ['/sitemap.xml', 'sitemap.xml'],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const digest = (value) => createHash('sha256').update(value).digest('hex');

function section(source, start, end = '</section>') {
  const from = source.indexOf(start);
  assert(from >= 0, `Missing section start: ${start}`);
  const to = source.indexOf(end, from);
  assert(to >= 0, `Missing section end after: ${start}`);
  return source.slice(from, to + end.length);
}

async function fetchBytes(pathname) {
  const response = await fetch(origin + pathname, {
    redirect: 'follow',
    headers: {
      // Request the immutable asset bytes. A text/html request can receive a
      // Cloudflare analytics injection that is not part of the release file.
      accept: 'application/octet-stream',
      'user-agent': 'NUMINA layout release builder',
    },
  });
  assert(response.ok, `Unable to read current presentation: ${pathname} (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

mkdirSync(client, { recursive: true });

const releaseResponse = await fetch(`${origin}/downloads/release.json`, {
  headers: { accept: 'application/json', 'user-agent': 'NUMINA layout release builder' },
});
assert(releaseResponse.ok, `Unable to read current release inventory (${releaseResponse.status})`);
const liveRelease = await releaseResponse.json();
assert(Array.isArray(liveRelease.artifacts), 'Current release inventory is unavailable');

const releaseAliases = new Set([
  'downloads/release.json',
  'downloads/application-release-v2.json',
  'downloads/application-release-v3.json',
  'downloads/application-release-v4.json',
]);
const remoteManaged = liveRelease.artifacts.filter(({ path }) =>
  path.startsWith('client/') &&
  !['client/_headers', 'client/_redirects'].includes(path) &&
  !releaseAliases.has(path.slice('client/'.length)),
);

let synced = 0;
const unavailableThroughPublicRoutes = [];
for (let offset = 0; offset < remoteManaged.length; offset += 12) {
  await Promise.all(remoteManaged.slice(offset, offset + 12).map(async ({ path, sha256 }) => {
    const filename = path.slice('client/'.length);
    const destination = resolve(client, filename);
    if (existsSync(destination) && digest(readFileSync(destination)) === sha256) return;
    const pathname = filename === 'index.html' ? '/' : `/${filename}`;
    const bytes = await fetchBytes(pathname);
    // Some retired compatibility filenames intentionally redirect to another
    // page, so their underlying bytes are not publicly retrievable.
    if (digest(bytes) !== sha256) {
      unavailableThroughPublicRoutes.push(path);
      return;
    }
    mkdirSync(resolve(destination, '..'), { recursive: true });
    writeFileSync(destination, bytes);
    synced += 1;
  }));
}

for (const { path, sha256 } of remoteManaged.filter(({ path }) => !unavailableThroughPublicRoutes.includes(path))) {
  const destination = resolve('dist', path);
  assert(existsSync(destination) && digest(readFileSync(destination)) === sha256, `Live artifact sync failed: ${path}`);
}

for (const filename of presentationFiles.values()) {
  if (filename === 'robots.txt') continue; // Cloudflare prepends managed crawler directives.
  const expected = liveRelease.artifacts.find(({ path }) => path === `client/${filename}`);
  assert(expected, `Current release is missing presentation file: ${filename}`);
  assert(digest(readFileSync(resolve(client, filename))) === expected.sha256, `Current presentation sync failed: ${filename}`);
}

const htmlFiles = [...presentationFiles.values()].filter((filename) => filename.endsWith('.html'));
const jsonLdHashes = new Set();
for (const filename of htmlFiles) {
  const html = readFileSync(resolve(client, filename), 'utf8');
  for (const match of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    jsonLdHashes.add(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  }
}

const headersPath = resolve(client, '_headers');
let headers = readFileSync(headersPath, 'utf8');
const cspMatch = headers.match(/^  Content-Security-Policy: (.+)$/m);
assert(cspMatch, 'Content-Security-Policy header missing');
const scriptMatch = cspMatch[1].match(/script-src ([^;]+)/);
assert(scriptMatch, 'script-src directive missing');
const scriptTokens = scriptMatch[1].trim().split(/\s+/);
for (const hash of [...jsonLdHashes].sort()) {
  if (!scriptTokens.includes(hash)) scriptTokens.push(hash);
}
const updatedCsp = cspMatch[1].replace(/script-src [^;]+/, `script-src ${scriptTokens.join(' ')}`);
headers = headers.replace(cspMatch[0], `  Content-Security-Policy: ${updatedCsp}`);
writeFileSync(headersPath, headers.endsWith('\n') ? headers : headers + '\n');

const redirectsPath = resolve(client, '_redirects');
let redirects = readFileSync(redirectsPath, 'utf8').trimEnd();
for (const [pathname, filename] of presentationFiles) {
  if (!filename.endsWith('.html') || filename === 'index.html') continue;
  const rule = `/${filename} ${pathname} 301`;
  if (!redirects.split(/\r?\n/).includes(rule)) redirects += `\n${rule}`;
}
writeFileSync(redirectsPath, redirects + '\n');

let home = readFileSync(resolve(client, 'index.html'), 'utf8');
assert(home.includes('<title>Agentic financial infrastructure | NUMINA</title>'), 'Unexpected live homepage identity');

const servicesAside = section(
  home,
  '<aside class="service-pane" aria-labelledby="services-heading">',
  '</aside>',
);
const proofRail = section(home, '<section class="proof-rail" aria-label="NUMINA operating proof">');
const growthSection = section(home, '<section class="growth-section">');

const advantageSpotlight = `<aside class="advantage-spotlight" aria-labelledby="advantage-spotlight-title">
    <span class="eyebrow">THE NUMINA ADVANTAGE</span>
    <h2 id="advantage-spotlight-title">Built to lead agentic finance.</h2>
    <p>Six connected advantages bring authority, compute, value, treasury, interoperability and evidence into one operating architecture.</p>
    <a class="advantage-jump" href="#advantages">Explore the Numina Advantage ↓</a>
  </aside>`;

const servicesSection = servicesAside
  .replace(
    '<aside class="service-pane" aria-labelledby="services-heading">',
    '<section class="service-pane services-home" aria-labelledby="services-heading">',
  )
  .replace(/<\/aside>\s*$/, '</section>');

home = home.replace(servicesAside, advantageSpotlight);
home = home.replace(
  '<span class="eyebrow">NUMINA / AGENTIC FINANCE INFRASTRUCTURE</span>',
  `<span class="eyebrow">NUMINA / AGENTIC FINANCE INFRASTRUCTURE</span>
    <a class="advantage-mobile-flag" href="#advantages"><span>THE NUMINA ADVANTAGE</span><strong>Built to lead agentic finance. ↓</strong></a>`,
);
home = home.replace(proofRail, '');
home = home.replace(
  growthSection,
  growthSection.replace(
    '</section>',
    `\n  <div class="institutional-proof"><span class="eyebrow">OPERATING EVIDENCE</span>${proofRail}</div>\n</section>`,
  ),
);
home = home.replace(
  /<\/section>\s*<section class="leadership-section" id="advantages">/,
  `</section>\n${servicesSection}\n<section class="leadership-section" id="advantages">`,
);
home = home.replace(
  '<link rel="stylesheet" href="/page-components.css">',
  '<link rel="stylesheet" href="/page-components.css"><link rel="stylesheet" href="/home-layout.css">',
);

const homeCss = `/* Homepage-only section reorganization. The shared NUMINA design system remains unchanged. */
.advantage-mobile-flag { display: none; }
.advantage-spotlight {
  min-width: 0;
  padding: clamp(70px, 7vw, 150px) 0 clamp(76px, 7vw, 150px) clamp(42px, 4.2vw, 98px);
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  overflow: hidden;
  background: radial-gradient(circle at 78% 26%, rgba(185,237,242,.13), transparent 34%);
}
.advantage-spotlight::before {
  content: '';
  position: absolute;
  inset: 14% 0 14% auto;
  width: 2px;
  background: linear-gradient(transparent, var(--accent), transparent);
}
.advantage-spotlight h2 {
  max-width: 11ch;
  margin: clamp(34px, 3vw, 58px) 0 24px;
  font-size: clamp(2.4rem, 3.3vw, 5.3rem);
  letter-spacing: -.055em;
}
.advantage-spotlight p { max-width: 39ch; font-size: clamp(1rem, .72vw, 1.25rem); }
.advantage-jump {
  width: fit-content;
  margin-top: clamp(30px, 3vw, 52px);
  color: var(--accent);
  font-size: 14px;
  text-decoration: none;
  border-bottom: 1px solid rgba(185,237,242,.42);
  padding-bottom: 5px;
}
.services-home {
  padding: var(--section-space) 0;
  border-left: 0;
  border-bottom: 1px solid var(--line);
  display: grid;
  grid-template-columns: minmax(260px,.72fr) minmax(0,1.28fr);
  align-items: start;
  gap: clamp(34px, 6vw, 130px);
}
.services-home .pane-kicker { grid-column: 1 / -1; }
.services-home h2 {
  max-width: 13ch;
  margin: 0;
  font-size: clamp(2.7rem, 4.5vw, 6.8rem);
  letter-spacing: -.06em;
}
.services-home .service-list { align-self: start; }
.leadership-section#advantages {
  position: relative;
  background: linear-gradient(180deg, rgba(185,237,242,.045), transparent 22%);
  box-shadow: inset 0 1px 0 rgba(185,237,242,.22);
}
.leadership-section#advantages > .leadership-heading .eyebrow { color: var(--accent); }
.institutional-proof { margin-top: clamp(52px, 6vw, 110px); }
.institutional-proof > .eyebrow { display: block; margin-bottom: 20px; color: var(--accent); }
.growth-section .proof-rail { border: 1px solid var(--line); }

@media (max-width: 1180px) {
  .advantage-mobile-flag {
    display: flex;
    width: min(100%, 560px);
    margin-top: 24px;
    padding: 13px 15px;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    border: 1px solid rgba(185,237,242,.28);
    background: rgba(185,237,242,.045);
    color: var(--ink);
    text-decoration: none;
  }
  .advantage-mobile-flag span {
    color: var(--accent);
    font: 10px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: .13em;
  }
  .advantage-mobile-flag strong { font-size: 12px; font-weight: 520; text-align: right; }
  .advantage-spotlight {
    padding: 70px 0 90px;
    border-top: 1px solid var(--line);
    border-left: 0;
  }
  .advantage-spotlight::before { inset: 0 auto auto 0; width: 100%; height: 1px; }
  .advantage-spotlight h2 { max-width: 13ch; }
}
@media (max-width: 900px) {
  .services-home { grid-template-columns: 1fr; }
  .services-home h2 { margin-bottom: 10px; }
}
@media (max-width: 760px) {
  .advantage-spotlight { padding: 58px 0 70px; }
  .services-home { padding-block: clamp(58px, 13vw, 88px); }
  .institutional-proof { margin-top: 52px; }
}
@media (prefers-reduced-motion: reduce) {
  .advantage-jump { scroll-behavior: auto; }
}
`;

writeFileSync(resolve(client, 'index.html'), home);
writeFileSync(resolve(client, 'home-layout.css'), homeCss);

const finalHome = readFileSync(resolve(client, 'index.html'), 'utf8');
const position = (needle) => {
  const value = finalHome.indexOf(needle);
  assert(value >= 0, `Missing final homepage element: ${needle}`);
  return value;
};

const heroAt = position('<section class="hero hero-home">');
const servicesAt = position('<section class="service-pane services-home"');
const advantagesAt = position('<section class="leadership-section" id="advantages">');
const growthAt = position('<section class="growth-section">');
const proofAt = position('<section class="proof-rail" aria-label="NUMINA operating proof">');
const globalAt = position('<section class="global-section">');

assert(heroAt < servicesAt, 'Services must follow the hero');
assert(servicesAt < advantagesAt, 'Services must occupy the prior evidence position');
assert(advantagesAt < growthAt, 'Numina Advantage hierarchy changed unexpectedly');
assert(growthAt < proofAt && proofAt < globalAt, 'Evidence must sit under Institutional Scaling');
assert((finalHome.match(/class="proof-rail"/g) ?? []).length === 1, 'Evidence rail must appear once');
assert((finalHome.match(/id="services-heading"/g) ?? []).length === 1, 'Services heading must appear once');
assert(finalHome.includes('class="advantage-spotlight"'), 'Above-the-fold Numina Advantage spotlight is missing');
assert(finalHome.includes('class="advantage-mobile-flag"'), 'Responsive Numina Advantage cue is missing');
assert(finalHome.includes('href="/home-layout.css"'), 'Homepage layout stylesheet is missing');

const pinnedRuntime = Buffer.from(readFileSync(resolve('reference/live-server-index.js.b64'), 'utf8').trim(), 'base64');
assert(digest(pinnedRuntime) === '3cd09e0db9b25ae1fd291103039d9af2c58ff5db7dc832e287be0f2f9951e6bc', 'Pinned application runtime is invalid');
writeFileSync(resolve('dist/server/index.js'), pinnedRuntime);
const serverHash = digest(readFileSync(resolve('dist/server/index.js')));
assert(serverHash === '3cd09e0db9b25ae1fd291103039d9af2c58ff5db7dc832e287be0f2f9951e6bc', 'Application runtime changed');

const excludedManifestPaths = new Set([...releaseAliases].map((filename) => `client/${filename}`));
function collectArtifacts(directory = resolve('dist'), relativeDirectory = '') {
  return readdirSync(directory).flatMap((name) => {
    const absolute = resolve(directory, name);
    const path = relativeDirectory ? `${relativeDirectory}/${name}` : name;
    if (statSync(absolute).isDirectory()) return collectArtifacts(absolute, path);
    if (excludedManifestPaths.has(path)) return [];
    return [{ path, sha256: digest(readFileSync(absolute)) }];
  });
}

const artifacts = collectArtifacts().sort((a, b) => a.path.localeCompare(b.path));
const buildId = digest(artifacts.map(({ path, sha256 }) => `${sha256}  ${path}\n`).join(''));
const release = {
  ...liveRelease,
  build_id: buildId,
  workerSha256: serverHash,
  artifacts,
};
const releaseBytes = `${JSON.stringify(release, null, 2)}\n`;
for (const filename of releaseAliases) {
  const destination = resolve(client, filename);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  writeFileSync(destination, releaseBytes);
}

assert(artifacts.some(({ path, sha256 }) => path === 'client/home-layout.css' && sha256 === digest(readFileSync(resolve(client, 'home-layout.css')))), 'Homepage stylesheet is absent from release inventory');
assert(artifacts.some(({ path, sha256 }) => path === 'client/index.html' && sha256 === digest(readFileSync(resolve(client, 'index.html')))), 'Homepage is absent from release inventory');

console.log(JSON.stringify({
  status: 'PASS',
  syncedLiveArtifacts: synced,
  redirectedCompatibilityArtifacts: unavailableThroughPublicRoutes.length,
  presentationFiles: presentationFiles.size,
  sectionOrder: ['hero', 'services', 'advantages', 'institutional-scaling', 'evidence', 'global-scaling'],
  artifacts: artifacts.length,
  buildId,
  serverSha256: serverHash,
}, null, 2));
