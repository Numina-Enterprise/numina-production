import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);process.chdir(fileURLToPath(root));
for(const p of ['dist/client','dist/server','dist/.openai','dist/client/downloads'])mkdirSync(p,{recursive:true});
function copy(from,to){mkdirSync(to,{recursive:true});for(const n of readdirSync(from)){const a=from+'/'+n,b=to+'/'+n;statSync(a).isDirectory()?copy(a,b):copyFileSync(a,b);}}
copy('public','dist/client');copy('docs','dist/client/downloads');
copyFileSync('src/core.js','dist/client/authority-core.js');copyFileSync('fixtures/demo-test-key.json','dist/client/downloads/demo-test-key.json');copyFileSync('fixtures/conformance-vectors.json','dist/client/downloads/conformance-vectors.json');copyFileSync('scripts/conformance.mjs','dist/client/downloads/conformance.mjs');
const report=JSON.parse(readFileSync('fixtures/conformance-report.json'));
const key=JSON.parse(readFileSync('fixtures/demo-test-key.json'));delete key.privateJwk;
writeFileSync('src/generated.js','export const DEMO_KEY='+JSON.stringify(key)+';\nexport const CONFORMANCE='+JSON.stringify(report)+';\n');
for(const n of ['core-v1.8-manifest.json','core-v1.8-eac.json','core-v1.8-context.json'])copyFileSync('fixtures/'+n,'dist/client/downloads/'+n);
let source=['core','store','generated','core-generated','core-v18','control','control-store','control-http','worker'].map(n=>readFileSync('src/'+n+'.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*\};\r?\n/gm,'').replace(/export (?!default)/g,'')).join('\n');
writeFileSync('dist/server/index.js',source);
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
if(readdirSync('.').includes('drizzle'))copy('drizzle','dist/.openai/drizzle');
execFileSync(process.execPath,['--check','dist/server/index.js'],{stdio:'inherit'});
writeFileSync('dist/client/downloads/release.json',JSON.stringify({version:'1.0.0',workerSha256:createHash('sha256').update(source).digest('hex'),testReport:report,coreManifest:'/downloads/core-v1.8-manifest.json'},null,2));
console.log('Built static site and Worker; no third-party runtime dependencies.');

