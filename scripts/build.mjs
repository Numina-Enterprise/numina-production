// Delivery-trigger marker: canonical release evidence refreshed 2026-09-19T13:50Z.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resetBuildOutput} from './build-output.mjs';
const root=new URL('../',import.meta.url);process.chdir(fileURLToPath(root));
execFileSync(process.execPath,['scripts/apply-numina-manifest-metadata.mjs','--check'],{stdio:'inherit'});
const FINAL_BUILD_MANIFEST_PATH='public/final-build.json';
const FINAL_BUILD_MANIFEST_BLOB='c470e24f11a5223058e6309c8008c1c90990bf21';
const finalBuildBytes=readFileSync(FINAL_BUILD_MANIFEST_PATH);
const finalBuildBlob=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+finalBuildBytes.length+'\0'),finalBuildBytes])).digest('hex');
if(finalBuildBlob!==FINAL_BUILD_MANIFEST_BLOB)throw Error('FINAL build manifest blob mismatch');
execFileSync(process.execPath,['scripts/check-final-build.mjs'],{stdio:'inherit'});
const finalBuild=JSON.parse(finalBuildBytes);
if(finalBuild.identity!=='NUMINA'||finalBuild.status!=='FINAL'||finalBuild.manifestContract?.schema!=='numina.final-build.contract.v2'||finalBuild.manifestContract?.finalAll!=='NUMINA'||finalBuild.manifestContract?.role!=='synchronized_projection'||finalBuild.manifestContract?.synchronization!=='ACROSS_ALL')throw Error('FINAL build manifest contract mismatch');
execFileSync(process.execPath,['scripts/nusd-contract-record.mjs'],{stdio:'inherit'});
// Fail before producing web artifacts if the iOS/runtime release binding has drifted.
execFileSync(process.execPath,['scripts/ios-release.mjs','check'],{stdio:'inherit'});
// Source safeguards can pass while Play upload, declarations and device checks remain blocked.
execFileSync(process.execPath,['scripts/check-play-readiness.mjs','--source-only'],{stdio:'inherit'});
// Regenerate the canonical integration manifest and its dependent metadata from current same-repo source before validating or copying it.
execFileSync(process.execPath,['integrations/numina/scripts/package-distribution.js'],{stdio:'inherit'});
if(readFileSync('public/runtime-contract.js','utf8')!==readFileSync('integrations/numina/src/runtime-contract.js','utf8'))throw Error('Integration runtime contract is stale; sync and repackage the integration kit before building');
// Rebuild from current source so retired assets and migrations cannot survive an overlay.
resetBuildOutput(fileURLToPath(root));
for(const p of ['dist/client','dist/server','dist/.openai','dist/client/downloads'])mkdirSync(p,{recursive:true});
function copy(from,to){mkdirSync(to,{recursive:true});for(const n of readdirSync(from)){const a=from+'/'+n,b=to+'/'+n;statSync(a).isDirectory()?copy(a,b):copyFileSync(a,b);}}
copy('public','dist/client');copy('docs','dist/client/downloads');
// Sites serves matching static files before Worker routes. Let the Worker own
// the old pricing address so its redirect retains query parameters.
unlinkSync('dist/client/pricing.html');
// The homepage and frontier share the same canonical control-room document.
copyFileSync('public/frontier.html','dist/client/index.html');
copyFileSync('mobile/signing/release-identities.json','dist/client/identity.json');
copyFileSync('mobile/signing/distribution-policy.json','dist/client/downloads/distribution-policy.json');
copyFileSync('integrations/numina/file-manifest.json','dist/client/downloads/integration-manifest.json');
for(const name of ['release-identities.json','numina-android-release.pem','numina-android-upload.pem','numina-ios-distribution.csr'])copyFileSync('mobile/signing/'+name,'dist/client/downloads/'+name);
for(const name of ['site.js','release-ui.js','release-model.js','downloads/RC26-ALIGNMENT.md']){try{unlinkSync('dist/client/'+name);}catch(error){if(error.code!=='ENOENT')throw error;}}
// Remove only explicitly retired generated assets; preserve release and customer artifacts.
for(const name of ['authority.js','core-ui.js','authority-core.js','economy-ui.js','economy-model.js','terminal.js','operations.js','operations-model.js','downloads/demo-test-key.json','downloads/conformance-vectors.json','downloads/conformance.mjs','downloads/core-v1.8-eac.json','downloads/Conformance-v0.1.md','downloads/EAC-v0.1.md','downloads/Recognition-Profile-v0.1.md','downloads/Operations-v0.1.md','downloads/Clearing-Stability-v1.8.md']){try{unlinkSync('dist/client/'+name);}catch(error){if(error.code!=='ENOENT')throw error;}}
const report=JSON.parse(readFileSync('fixtures/conformance-report.json'));
const key=JSON.parse(readFileSync('fixtures/demo-test-key.json'));delete key.privateJwk;
writeFileSync('src/generated.js','export const DEMO_KEY='+JSON.stringify(key)+';\nexport const CONFORMANCE='+JSON.stringify(report)+';\n');
for(const n of ['core-v1.8-manifest.json','core-v1.8-context.json'])copyFileSync('fixtures/'+n,'dist/client/downloads/'+n);
let source='const TREASURY_SUBMISSION_REQUESTS='+readFileSync('release-evidence/treasury-submission-requests-2026-09-18.json','utf8')+';\n'+readFileSync('public/treasury-connection-model.js','utf8').replace(/export /g,'')+'\n'+readFileSync('public/owner-approval.js','utf8').replace(/export /g,'')+'\n'+readFileSync('public/wallet-execution-policy.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+'\n'+readFileSync('public/financial-model.js','utf8').replace(/export /g,'')+'\n'+readFileSync('public/nusd-contract-record.js','utf8').replace(/export /g,'')+'\n'+readFileSync('public/treasury-valuation.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+'\n'+readFileSync('public/architecture-layers.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+'\n'+readFileSync('public/runtime-contract.js','utf8').replace(/export /g,'')+'\n'+readFileSync('integrations/numina/src/quantum.js','utf8').replace(/export /g,'')+'\n'+['telemetry','quantum-backend','quantum-telemetry','ibm-quantum','core','store','generated','core-generated','core-v18','numina-root','native-treasury-model','treasury-policy','treasury-alignment','frontier','control','control-store','native-treasury','treasury-documents','stripe-treasury','ach-receipt-verifier','usdc-receipt-verifier','wallet-execution-store','control-http','telemetry-http','quantum-http','rc20','runtime-revocation','runtime-http','app-core','app-http','nusd-existing-token-evidence','nusd-http','treasury-evidence','bank-route-model','treasury-connection-http','connections-http','frontier-http','reviewer','financial-evidence','transfer-receipts','worker'].map(n=>readFileSync('src/'+n+'.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*\};\r?\n/gm,'').replace(/export (?!default)/g,'')).join('\n');
writeFileSync('dist/server/index.js',readFileSync('public/connection-model.js','utf8').replace(/export /g,'')+'\n'+readFileSync('public/treasury-amount.js','utf8').replace(/export /g,'')+'\n'+source);
// Match the Sites packager's canonical formatting before inventory hashing.
writeFileSync('dist/.openai/hosting.json',JSON.stringify(JSON.parse(readFileSync('.openai/hosting.json','utf8')),null,2)+'\n');
if(readdirSync('.').includes('drizzle'))copy('drizzle','dist/.openai/drizzle');
execFileSync(process.execPath,['--check','dist/server/index.js'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/source-alignment.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/release-manifest.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/sync-application-release-pin.mjs','--write'],{stdio:'inherit'});
console.log('Built static site and Worker; no third-party runtime dependencies.');
