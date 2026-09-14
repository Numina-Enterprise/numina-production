import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);process.chdir(fileURLToPath(root));
if(readFileSync('public/runtime-contract.js','utf8')!==readFileSync('integrations/numina/src/runtime-contract.js','utf8'))throw Error('Integration runtime contract is stale; sync and repackage the integration kit before building');
for(const p of ['dist/client','dist/server','dist/.openai','dist/client/downloads'])mkdirSync(p,{recursive:true});
// Remove obsolete files from the former static-root build; assets have one source, dist/client.
for(const name of readdirSync('dist'))if(statSync('dist/'+name).isFile())unlinkSync('dist/'+name);
function copy(from,to){mkdirSync(to,{recursive:true});for(const n of readdirSync(from)){const a=from+'/'+n,b=to+'/'+n;statSync(a).isDirectory()?copy(a,b):copyFileSync(a,b);}}
copy('public','dist/client');copy('docs','dist/client/downloads');
// Sites serves matching static files before Worker routes. Let the Worker own
// the old pricing address so its redirect retains query parameters.
unlinkSync('dist/client/pricing.html');
// The homepage and frontier share the same canonical control-room document.
copyFileSync('public/frontier.html','dist/client/index.html');
copyFileSync('mobile/signing/release-identities.json','dist/client/identity.json');
copyFileSync('mobile/signing/distribution-policy.json','dist/client/downloads/distribution-policy.json');
for(const name of ['release-identities.json','numina-android-release.pem','numina-android-upload.pem','numina-ios-distribution.csr'])copyFileSync('mobile/signing/'+name,'dist/client/downloads/'+name);
for(const name of ['site.js','release-ui.js','release-model.js','downloads/RC26-ALIGNMENT.md']){try{unlinkSync('dist/client/'+name);}catch(error){if(error.code!=='ENOENT')throw error;}}
// Remove only explicitly retired generated assets; preserve release and customer artifacts.
for(const name of ['authority.js','core-ui.js','authority-core.js','economy-ui.js','economy-model.js','terminal.js','operations.js','operations-model.js','downloads/demo-test-key.json','downloads/conformance-vectors.json','downloads/conformance.mjs','downloads/core-v1.8-eac.json','downloads/Conformance-v0.1.md','downloads/EAC-v0.1.md','downloads/Recognition-Profile-v0.1.md','downloads/Operations-v0.1.md','downloads/Clearing-Stability-v1.8.md']){try{unlinkSync('dist/client/'+name);}catch(error){if(error.code!=='ENOENT')throw error;}}
const report=JSON.parse(readFileSync('fixtures/conformance-report.json'));
const key=JSON.parse(readFileSync('fixtures/demo-test-key.json'));delete key.privateJwk;
writeFileSync('src/generated.js','export const DEMO_KEY='+JSON.stringify(key)+';\nexport const CONFORMANCE='+JSON.stringify(report)+';\n');
for(const n of ['core-v1.8-manifest.json','core-v1.8-context.json'])copyFileSync('fixtures/'+n,'dist/client/downloads/'+n);
let source=readFileSync('public/architecture-layers.js','utf8').replace(/export /g,'')+'\n'+readFileSync('public/runtime-contract.js','utf8').replace(/export /g,'')+'\n'+['core','store','generated','core-generated','core-v18','native-treasury-model','treasury-policy','treasury-alignment','frontier','control','control-store','native-treasury','treasury-documents','stripe-treasury','control-http','rc20','runtime-revocation','runtime-http','app-core','app-http','nusd-http','treasury-evidence','frontier-http','worker'].map(n=>readFileSync('src/'+n+'.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*\};\r?\n/gm,'').replace(/export (?!default)/g,'')).join('\n');
writeFileSync('dist/server/index.js',source);
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
if(readdirSync('.').includes('drizzle'))copy('drizzle','dist/.openai/drizzle');
execFileSync(process.execPath,['--check','dist/server/index.js'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/source-alignment.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/release-manifest.mjs'],{stdio:'inherit'});
console.log('Built static site and Worker; no third-party runtime dependencies.');
