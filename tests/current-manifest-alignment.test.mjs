import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalManifest,alignedApplication} from '../public/manifest-surface.js';
import built from '../dist/server/index.js';
import {database} from '../scripts/sqlite.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const json=path=>JSON.parse(read(path));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('current release descriptors identify exact shipped bytes and all aliases agree',()=>{
 const bytes=read('dist/client/downloads/application-release-v4.json'),release=JSON.parse(bytes);
 for(const name of ['release.json','application-release-v2.json','application-release-v3.json'])assert.deepEqual(read('dist/client/downloads/'+name),bytes);
 const hashes=new Map(release.artifacts.map(item=>[item.path,item.sha256]));
 for(const item of release.artifacts)assert.equal(digest(read('dist/'+item.path)),item.sha256,item.path);
 assert.equal(release.build_id,digest(release.artifacts.map(item=>item.sha256+'  '+item.path+'\n').join('')));
 for(const binding of [release.security,...Object.values(release.owner_wallet_execution.modules),...Object.values(release.receipt_observation_intake.modules),...Object.values(release.evidence_handoff.modules)])assert.equal(binding.sha256,hashes.get('client'+(binding.path??binding.url??binding.controlModel)));
 assert.equal(release.canonicalTreasuryValues.components.NUSD.current,null);
 assert.equal(release.canonicalTreasuryValues.observation.asOfDate,'2026-09-25');
 assert.equal(release.runtime_dependency.version,'1.9.0-rc26');
});

test('built public manifest and application projection bind the actual inventory',async t=>{
 const db=database();t.after(()=>db.close());
 const env={DB:db,NUMINA_TELEMETRY_LOGS:'false',ASSETS:{fetch(req){const pathname=new URL(req.url).pathname;const file=new URL('../dist/client'+pathname,import.meta.url);return existsSync(file)?new Response(readFileSync(file),{headers:{'Content-Type':'application/json'}}):new Response('',{status:404});}}};
 const load=async path=>{const result=await built.fetch(new Request('https://numina.test'+path),env);assert.equal(result.status,200,path);return result.json();};
 const manifest=canonicalManifest(await load('/api/control/v1/manifest'));
 const release=alignedApplication(manifest,await load('/v4/release/manifest'));
 assert.equal(release.build_id,json('dist/client/downloads/application-release-v4.json').build_id);
 assert.equal(manifest.version,'1.0.0');assert.equal(manifest.applicationVersion,'4.0.0');
});

test('all 42 maintained pages ship the shared shell and accessible main destination',()=>{
 const root=new URL('../public/',import.meta.url),pages=readdirSync(root).filter(name=>name.endsWith('.html')&&name!=='pricing.html');assert.equal(pages.length,42);
 const footer=read('public/services.html').toString().match(/<footer\b[\s\S]*?<\/footer>/)[0];
 for(const name of pages){const source=read('public/'+name).toString(),html=read('dist/client/'+name).toString();assert.deepEqual(html,source,name+' source overlay');assert.equal((html.match(/<h1\b/g)||[]).length,1,name+' heading');assert.match(html,/<main\b[^>]*id="main"/,name+' main');assert.match(html,/class="skip" href="#main"/,name+' skip');assert.equal(html.match(/<footer\b[\s\S]*?<\/footer>/)[0],footer,name+' footer');
  if(!['index.html','frontier.html'].includes(name)){const styles=[...html.split('</head>')[0].matchAll(/<link\b[^>]*href="([^\"]+\.css[^\"]*)"[^>]*>/g)].map(m=>m[1]);assert.match(styles.at(-1),/^\/numina4-pages\.css/,name+' theme precedence');}
  for(const canonical of html.matchAll(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/g))assert.equal(new URL(canonical[1]).origin,'https://numinalabs.xyz',name+' active canonical origin');
 }
});
