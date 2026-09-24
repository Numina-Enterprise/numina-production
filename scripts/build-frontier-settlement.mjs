import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {resetBuildOutput} from './build-output.mjs';
import {NUMINA_CANONICAL_TREASURY_VALUES as values,NUMINA_SINGULAR_SETTLEMENT_RECEIPT as receipt,NUMINA_TREASURY_CONNECTION as connection} from '../public/treasury-connection-model.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {NUSD_CONTRACT_RECORD} from '../public/nusd-contract-record.js';
import {treasuryClientVerificationManifest} from '../public/treasury-proof.js';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=f=>JSON.parse(readFileSync(f,'utf8'));
const baseline=json('reference/frontier-baseline-release.json');
assert.equal(baseline.workerSha256,'3cd09e0db9b25ae1fd291103039d9af2c58ff5db7dc832e287be0f2f9951e6bc');
execFileSync(process.execPath,['scripts/apply-numina-manifest-metadata.mjs','--check'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/check-final-build.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['integrations/numina/scripts/package-distribution.js'],{stdio:'inherit'});
assert.deepEqual(readFileSync('public/treasury-proof.js'),readFileSync('integrations/numina/src/treasury-proof.js'));
resetBuildOutput(root);
const snapshot=json('reference/frontier-baseline-client.json');
const archive=Buffer.concat(snapshot.parts.map(part=>{assert.match(part.path,/^reference\/frontier-baseline-client\.part[0-9]{2}$/);const bytes=readFileSync(part.path);assert.equal(bytes.length,part.bytes);assert.equal(hash(bytes),part.sha256);return bytes;}));
assert.equal(archive.length,snapshot.bytes);assert.equal(hash(archive),snapshot.sha256);
execFileSync('tar',['-xzf','-','-C','dist'],{input:archive});
// Every retained published client asset is restored byte-for-byte from the
// release inventory. This build has no network reads or provider writes.
const baselineClient=baseline.artifacts.filter(x=>x.path.startsWith('client/')&&!['client/_headers','client/_redirects'].includes(x.path));
for(const x of baselineClient)assert.equal(hash(readFileSync('dist/'+x.path)),x.sha256,'Baseline asset: '+x.path);
const overlays=[
 ['public/treasury-connection-model.js','client/treasury-connection-model.js'],
 ['public/architecture-layers.js','client/architecture-layers.js'],
 ['public/nusd-contract-record.js','client/nusd-contract-record.js'],
 ['public/treasury-proof.js','client/treasury-proof.js'],
 ['public/treasury-connection.js','client/treasury-connection.js'],
 ['public/treasury-balances.js','client/treasury-balances.js'],
 ['public/native-treasury.js','client/native-treasury.js'],
 ['public/treasury.html','client/treasury.html'],
 ['public/final-build.json','client/final-build.json'],
 ['public/business-core.json','client/business-core.json'],
 ['docs/NUMINA-FINAL-BUILD.json','client/downloads/NUMINA-FINAL-BUILD.json'],
 ['docs/Treasury-Evidence-v3.md','client/downloads/Treasury-Evidence-v3.md'],
 ['docs/treasury-client-alignment.md','client/downloads/treasury-client-alignment.md'],
 ['integrations/numina/file-manifest.json','client/downloads/integration-manifest.json'],
];
for(const [source,target]of overlays)copyFileSync(source,'dist/'+target);
const modules=['public/treasury-connection-model.js','public/nusd-contract-record.js','public/architecture-layers.js','src/treasury-alignment.js'];
const original=Buffer.from(readFileSync('reference/live-server-index.js.b64','utf8').trim(),'base64').toString();
assert.equal(hash(original),baseline.workerSha256);
let worker=original;const substitutions=[];
const compile=s=>s.replace(/\r\n/g,'\n').replace(/^import .*;\n/gm,'').replace(/^export \{.*\};\n/gm,'').replace(/export (?!default)/g,'').trimStart().trimEnd()+'\n';
for(const source of modules){const before=readFileSync('reference/settlement-metadata-bases/'+path.basename(source)+'.txt','utf8'),after=compile(readFileSync(source,'utf8'));assert.equal(worker.split(before).length,2,'Unique runtime module: '+source);worker=worker.replace(before,after);substitutions.push({source,before,after});}
// Correct two retained address literals outside the four metadata modules.
// Their exact offsets are recorded so preservation can still be proved.
const stripeUsdcAddress=connection.nativeLocationBindings.stripeUsdc.usdcAddress;
assert.equal(stripeUsdcAddress,json('runtime/nusd/treasury-settlement-receipt.json').components.find(item=>item.settledUnit==='USDC').usdcAddress);
const priorStripeUsdcAddress='0x735bd8f274dce00a8bb374edd85df0d2e631018e';
const addressCorrections=[];
for(let offset=worker.indexOf(priorStripeUsdcAddress);offset!==-1;offset=worker.indexOf(priorStripeUsdcAddress,offset+stripeUsdcAddress.length)){
  addressCorrections.push(offset);worker=worker.slice(0,offset)+stripeUsdcAddress+worker.slice(offset+priorStripeUsdcAddress.length);
}
assert.equal(addressCorrections.length,2,'Retained Stripe policy/provider address bindings');
// Reverse the approved substitutions to prove the rest of the live runtime
// (routing, authentication, provider adapters and journal reducer) is unchanged.
let restored=worker;for(const offset of addressCorrections.slice().reverse()){assert.equal(restored.slice(offset,offset+stripeUsdcAddress.length),stripeUsdcAddress);restored=restored.slice(0,offset)+priorStripeUsdcAddress+restored.slice(offset+stripeUsdcAddress.length);}for(const {before,after}of substitutions.slice().reverse()){assert.equal(restored.split(after).length,2);restored=restored.replace(after,before);}assert.equal(restored,original);
mkdirSync('dist/server',{recursive:true});writeFileSync('dist/server/index.js',worker);
execFileSync(process.execPath,['--check','dist/server/index.js'],{stdio:'inherit'});
mkdirSync('dist/.openai',{recursive:true});writeFileSync('dist/.openai/hosting.json',JSON.stringify(json('.openai/hosting.json'),null,2)+'\n');
function copyTree(from,to){mkdirSync(to,{recursive:true});for(const n of readdirSync(from)){const a=path.join(from,n),b=path.join(to,n);statSync(a).isDirectory()?copyTree(a,b):copyFileSync(a,b);}}
copyTree('drizzle','dist/.openai/drizzle');
for(const a of baseline.artifacts.filter(x=>x.path.startsWith('.openai/drizzle/')))assert.equal(hash(readFileSync('dist/'+a.path)),a.sha256,'Published migration bytes: '+a.path);
let headers=readFileSync('public/_headers','utf8'),redirects=readFileSync('public/_redirects','utf8').trimEnd();
const presentation=['index','government','financial-institutions','partners','developers','trust','uk-eu','mena','apac','contact'];
const hashes=new Set();for(const name of presentation){const html=readFileSync('dist/client/'+name+'.html','utf8');for(const m of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g))hashes.add("'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'");if(name!=='index'){const rule='/'+name+'.html /'+name+' 301';if(!redirects.split(/\r?\n/).includes(rule))redirects+='\n'+rule;}}
headers=headers.replace(/script-src ([^;]+)/,(_,tokens)=>'script-src '+[...new Set([...tokens.trim().split(/\s+/),...hashes])].join(' '));writeFileSync('dist/client/_headers',headers);writeFileSync('dist/client/_redirects',redirects+'\n');
const sourceAlignment=json('dist/client/source-alignment.json');
const currentInputs=new Set([...overlays.map(x=>x[0]),...modules,'package.json','config/numina-architecture.json','config/numina-manifest.v2.json','config/treasury-aggregate-settlement-1500t.v1.json','integrations/numina/package.json','integrations/numina/distribution.json','integrations/numina/verification.json','integrations/numina/src/treasury-proof.js','scripts/nusd-contract-record.mjs','scripts/build-frontier-settlement.mjs']);
const captured=new Map(sourceAlignment.sourceInputs.map(x=>[x.path,x]));
for(const file of currentInputs){const bytes=readFileSync(file);captured.set(file,{path:file,bytes:bytes.length,sha256:hash(bytes)});}
sourceAlignment.sourceInputs=[...captured.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
sourceAlignment.sourceInputCount=sourceAlignment.sourceInputs.length;
sourceAlignment.sourceInputCaptureScope='Current metadata overlay inputs; other entries retained from the preserved published source inventory';
sourceAlignment.sourceInputProvenance={baselineBuildId:baseline.build_id,currentMetadataInputs:[...currentInputs].sort(),otherInputs:'retained_published_inventory'};
sourceAlignment.provider_routing.nativeModel.usdcAddress=stripeUsdcAddress;
sourceAlignment.canonicalTreasuryValues=values;sourceAlignment.singularSettlementReceipt=receipt;
sourceAlignment.treasury=NUMINA_LAYERS.treasury;sourceAlignment.contract_record=NUSD_CONTRACT_RECORD;
sourceAlignment.treasury_client_verification=treasuryClientVerificationManifest(hash(readFileSync('public/treasury-proof.js')));
sourceAlignment.requiredArchitecture.canonicalTreasuryValues=values;
writeFileSync('dist/client/source-alignment.json',JSON.stringify(sourceAlignment,null,2)+'\n');
const allowed=new Set([...overlays.map(x=>x[1]),'client/source-alignment.json']);let retained=0;for(const x of baselineClient)if(!allowed.has(x.path)){assert.equal(hash(readFileSync('dist/'+x.path)),x.sha256,'Unrelated published asset changed: '+x.path);retained++;}
assert.equal(json('dist/client/downloads/nusd/treasury-settlement-receipt.json').id,receipt.id);
assert.equal(json('dist/client/final-build.json').canonicalTreasuryValues.aggregate.current,values.aggregate.current);
const aliases=['release.json','application-release-v2.json','application-release-v3.json','application-release-v4.json'].map(n=>'client/downloads/'+n),excluded=new Set(aliases);
const collect=(dir='dist',relative='')=>readdirSync(dir).flatMap(n=>{const p=relative?relative+'/'+n:n,a=path.join(dir,n);return statSync(a).isDirectory()?collect(a,p):excluded.has(p)?[]:[{path:p,sha256:hash(readFileSync(a))}];});
const artifacts=collect().sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),buildId=hash(artifacts.map(x=>x.sha256+'  '+x.path+'\n').join(''));
const release=structuredClone(baseline);
function align(o){if(!o||typeof o!=='object')return;for(const k of Object.keys(o))if(k==='canonicalTreasuryValues')o[k]=structuredClone(values);else align(o[k]);}align(release);
release.provider_routing.nativeModel.usdcAddress=stripeUsdcAddress;
release.canonicalTreasuryValues=values;release.contract_record=NUSD_CONTRACT_RECORD;
release.native_treasury_alignment={...release.native_treasury_alignment,singularSettlementReceipt:receipt,settlementStatus:receipt.status,settlementScope:receipt.sourceOfRecord,mintStatus:values.mintStatus,mintedNusd:values.mintedNusd,burnedNusd:values.burnedNusd};
release.treasury_client_verification=treasuryClientVerificationManifest(hash(readFileSync('public/treasury-proof.js')));
release.distribution.integration_kit.manifest_sha256=hash(readFileSync('dist/client/downloads/integration-manifest.json'));
release.build_id=buildId;release.workerSha256=hash(worker);release.artifacts=artifacts;
for(const f of aliases)writeFileSync('dist/'+f,JSON.stringify(release,null,2)+'\n');
execFileSync(process.execPath,['scripts/sync-application-release-pin.mjs','--write'],{stdio:'inherit'});
for(const target of ['dist/server/index.js',...artifacts.filter(x=>/\.(?:js|json|html|md)$/.test(x.path)).map(x=>'dist/'+x.path),...aliases.map(x=>'dist/'+x)])assert.ok(!readFileSync(target,'utf8').includes('0x735bd8'),'Stale Stripe address in '+target);
const report={stripeUsdcDepositAddress:stripeUsdcAddress,retainedRuntimeAddressCorrections:addressCorrections.length,identity:'NUMINA',receiptId:receipt.id,aggregateNusd:values.aggregate.current,mintedNusd:values.mintedNusd,burnedNusd:values.burnedNusd,componentCount:3,buildId,workerSha256:hash(worker),baselineBuildId:baseline.build_id,retainedClientAssets:retained,overlaidClientAssets:allowed.size,runtimeModules:modules,unrelatedRuntimeBytesPreserved:true,homepageUnchanged:true,externalProviderMutations:false};
mkdirSync('work',{recursive:true});writeFileSync('work/frontier-build-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
