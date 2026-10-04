import {NUMINA_STATE_RECONCILIATION} from '../public/state-reconciliation.js';
import {publicMetadata} from '../src/public-privacy.js';
import {privateArtifactRecords,projectPublicAssets} from './public-asset-privacy.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {resetBuildOutput} from './build-output.mjs';
import {NUMINA_CANONICAL_TREASURY_VALUES as values,NUMINA_SINGULAR_SETTLEMENT_RECEIPT as receipt,NUMINA_TREASURY_CONNECTION as connection} from '../public/treasury-connection-model.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {NUSD_CONTRACT_RECORD} from '../public/nusd-contract-record.js';
import {NUSD_PROVIDER_ROUTING} from '../src/stripe-treasury.js';
import {STRIPE_DEPOSIT_CAPABILITY} from '../src/stripe-deposit-provider.js';
import {NUSD_MINT_WORKFLOW,NUSD_CONVERSION_WORKFLOW} from '../src/nusd-http.js';
import {NUMINA_OWNER_APPROVAL} from '../public/owner-approval.js';
import {checkIOSRelease,iosInputSnapshot} from './ios-release.mjs';
import {treasuryClientVerificationManifest} from '../public/treasury-proof.js';
import {alignNusdReleaseMetadata} from './align-nusd-release-metadata.mjs';
import {checkSoftwareRelease,softwareReleaseInputs} from './check-software-release.mjs';
import {checkActiveProvenance} from './check-active-provenance.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
assert.deepEqual(checkActiveProvenance({rootDir:root}).errors,[],'Active provenance source gate');
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=f=>JSON.parse(readFileSync(f,'utf8'));
const baseline=json('reference/frontier-baseline-release.json');
const activeProvenancePolicy=json('config/active-provenance-policy.v1.json');
for(const file of ['config/numina-state-reconciliation.v1.json','public/state-reconciliation.json','runtime/vercel-production/state-reconciliation.json'])assert.deepEqual(json(file),NUMINA_STATE_RECONCILIATION,'State reconciliation mirror: '+file);
assert.deepEqual(readFileSync('public/state-reconciliation.js'),readFileSync('integrations/numina/src/state-reconciliation.js'));
// Ship current legal companions and matching integration/plugin/mobile source archives.
execFileSync(process.env.NUMINA_PYTHON||(process.platform==='win32'?'python':'python3'),['scripts/package-distributions.py'],{stdio:'inherit'});
const softwareReleaseAlignment=checkSoftwareRelease(root);
assert.equal(baseline.workerSha256,'3cd09e0db9b25ae1fd291103039d9af2c58ff5db7dc832e287be0f2f9951e6bc');
execFileSync(process.execPath,['scripts/apply-numina-manifest-metadata.mjs','--check'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/generate-metadata-alignment.mjs','--check'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/check-final-build.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/production-pair.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['integrations/numina/scripts/package-distribution.js'],{stdio:'inherit'});
execFileSync(process.env.NUMINA_PYTHON||(process.platform==='win32'?'python':'python3'),['scripts/package-current-integration.py'],{stdio:'inherit'});
assert.deepEqual(readFileSync('public/treasury-proof.js'),readFileSync('integrations/numina/src/treasury-proof.js'));
resetBuildOutput(root);
const snapshot=json('reference/frontier-baseline-client.json');
const archive=Buffer.concat(snapshot.parts.map(part=>{assert.match(part.path,/^reference\/frontier-baseline-client\.part[0-9]{2}$/);const bytes=readFileSync(part.path);assert.equal(bytes.length,part.bytes);assert.equal(hash(bytes),part.sha256);return bytes;}));
assert.equal(archive.length,snapshot.bytes);assert.equal(hash(archive),snapshot.sha256);
// Use a verified file input so tar/gzip cannot stall on a synchronous stdin pipe.
const baselineArchivePath='dist/.numina-baseline.tar.gz';
writeFileSync(baselineArchivePath,archive);
try{execFileSync('tar',['-xzf',baselineArchivePath,'-C','dist'],{stdio:'inherit'});}
finally{unlinkSync(baselineArchivePath);}
// Every retained published client asset is restored byte-for-byte from the
// release inventory. This build has no network reads or provider writes.
const baselineClient=baseline.artifacts.filter(x=>x.path.startsWith('client/')&&!['client/_headers','client/_redirects'].includes(x.path));
for(const x of baselineClient)assert.equal(hash(readFileSync('dist/'+x.path)),x.sha256,'Baseline asset: '+x.path);
const overlays=[
 ['public/workspace-session.js','client/workspace-session.js'],
 ['public/control-receipts.js','client/control-receipts.js'],
 // Current licensing accompanies preserved runtime and contract artifact bytes.
 ['public/LICENSE.md','client/LICENSE.md'],
 ['public/NOTICE.md','client/NOTICE.md'],
 ['public/OWNERSHIP.md','client/OWNERSHIP.md'],
 ['public/ownership.json','client/ownership.json'],
 ['docs/LICENSE.md','client/downloads/LICENSE.md'],
 ['docs/NOTICE.md','client/downloads/NOTICE.md'],
 ['docs/OWNERSHIP.md','client/downloads/OWNERSHIP.md'],
 ['docs/contracts/LICENSE.md','client/downloads/contracts/LICENSE.md'],
 ['docs/contracts/NOTICE.md','client/downloads/contracts/NOTICE.md'],
 ['docs/contracts/OWNERSHIP.md','client/downloads/contracts/OWNERSHIP.md'],
 ['runtime/nusd/LICENSE.md','client/downloads/nusd/LICENSE.md'],
 ['runtime/nusd/NOTICE.md','client/downloads/nusd/NOTICE.md'],
 ['runtime/nusd/OWNERSHIP.md','client/downloads/nusd/OWNERSHIP.md'],
 ['public/state-reconciliation.js','client/state-reconciliation.js'],
 ['public/state-reconciliation.json','client/state-reconciliation.json'],
 ['docs/numina-codex-plugin-4.0.0.zip','client/downloads/numina-codex-plugin-4.0.0.zip'],
 ['docs/codex-plugin-v4-record.json','client/downloads/codex-plugin-v4-record.json'],
 // Release status must ship the reviewed UI and its matching verification model.
 ['public/application-release-ui.js','client/application-release-ui.js'],
 ['public/runtime-release-ui.js','client/runtime-release-ui.js'],
 ['public/manifest-surface.js','client/manifest-surface.js'],
 ['public/control-room.js','client/control-room.js'],
 ['public/connection-model.js','client/connection-model.js'],
 ['public/runtime-release-model.js','client/runtime-release-model.js'],
 ['public/runtime-contract.js','client/runtime-contract.js'],
 // Provider observations must ship the reviewed display, including its strict amount helper.
 ['public/stripe-treasury.js','client/stripe-treasury.js'],
 ['public/treasury-amount.js','client/treasury-amount.js'],
 ['public/apac.html','client/apac.html'],
 ['public/about.html','client/about.html'],
 ['public/integrations.html','client/integrations.html'],
 ['public/ownership.html','client/ownership.html'],
 ['public/redemption.html','client/redemption.html'],
 ['public/404.html','client/404.html'],
 ['public/services.html','client/services.html'],
 ['public/developers.html','client/developers.html'],
 ['public/partners.html','client/partners.html'],
 ['public/wallet-signing.html','client/wallet-signing.html'],
 ['public/wallet-execution-ui.js','client/wallet-execution-ui.js'],
 ['public/receipt-intake-ui.js','client/receipt-intake-ui.js'],
 ['public/connections.html','client/connections.html'],
 ['public/mena.html','client/mena.html'],
 ['public/500.html','client/500.html'],
 ['public/security.html','client/security.html'],
 ['public/government.html','client/government.html'],
 ['public/provenance.html','client/provenance.html'],
 ['public/deployment-readiness.html','client/deployment-readiness.html'],
 ['public/treasury-simulation.html','client/treasury-simulation.html'],
 ['public/trust.html','client/trust.html'],
 ['public/reviewer.html','client/reviewer.html'],
 ['public/contact.html','client/contact.html'],
 ['public/contact-support.css','client/contact-support.css'],
 ['public/support-chat.css','client/support-chat.css'],
 ['public/support-chat.js','client/support-chat.js'],
 ['public/support-faq-engine.js','client/support-faq-engine.js'],
 ['public/support-faq.json','client/support-faq.json'],
 ['public/status.html','client/status.html'],
 ['public/uk-eu.html','client/uk-eu.html'],
 ['public/build.html','client/build.html'],
 ['public/platform.html','client/platform.html'],
 ['public/privacy.html','client/privacy.html'],
 ['public/terms.html','client/terms.html'],
 ['public/software-licenses.html','client/software-licenses.html'],
 ['public/software-licenses.json','client/software-licenses.json'],
 ['public/THIRD-PARTY-NOTICES.txt','client/THIRD-PARTY-NOTICES.txt'],
 ['public/legal-policy.json','client/legal-policy.json'],
 ['public/iowa-entity-registry.json','client/iowa-entity-registry.json'],
 ['public/charitable-relationship.json','client/charitable-relationship.json'],
 ['public/legal-discovery.js','client/legal-discovery.js'],
 ['public/sitemap.xml','client/sitemap.xml'],
 ['public/robots.txt','client/robots.txt'],
 ['public/app-sw.js','client/app-sw.js'],
 ['public/app-install.js','client/app-install.js'],
 ['docs/Numina-Security.md','client/downloads/Numina-Security.md'],
 ['docs/history/Numina-Security-2026-09-15.md','client/downloads/history/Numina-Security-2026-09-15.md'],
 ['public/country-codes.js','client/country-codes.js'],
 ['public/compliance.html','client/compliance.html'],
 ['public/compliance-coverage.json','client/compliance-coverage.json'],
 ['public/country-readiness.json','client/country-readiness.json'],
 ['public/compliance-ui.js','client/compliance-ui.js'],
 ['public/compliance-model.js','client/compliance-model.js'],
 ['public/compliance.css','client/compliance.css'],
 ['public/authority.html','client/authority.html'],
 ['public/financial-institutions.html','client/financial-institutions.html'],
 ['public/core.html','client/core.html'],
 ['public/numina4-pages.css','client/numina4-pages.css'],
 ['public/app.html','client/app.html'],
 ['public/app-entry.js','client/app-entry.js'],
 ['public/app-ui.js','client/app-ui.js'],
 ['public/motion.css','client/motion.css'],
 ['public/numina4-ui.js','client/numina4-ui.js'],
 ['public/numina4-core.webp','client/numina4-core.webp'],
 ['public/numina-tree.css','client/numina-tree.css'],
 ['public/numina-tree-ui.js','client/numina-tree-ui.js'],
 ['public/procurement-policy.js','client/procurement-policy.js'],
 ['public/procurement-projection.js','client/procurement-projection.js'],
 ['public/schemas/procurement-evidence-v1.schema.json','client/schemas/procurement-evidence-v1.schema.json'],
 ['public/schemas/application-release-v2.schema.json','client/schemas/application-release-v2.schema.json'],
 ['public/owner-approval.js','client/owner-approval.js'],
 ['public/final-manifest.json','client/final-manifest.json'],
 ['docs/NUMINA-FINAL-MANIFEST.json','client/downloads/NUMINA-FINAL-MANIFEST.json'],
 ['public/current-environments.json','client/current-environments.json'],
 ['public/control.html','client/control.html'],
 ['public/control.js','client/control.js'],
 ['public/index.html','client/index.html'],
 ['public/economy.html','client/economy.html'],
 ['public/blockchain.html','client/blockchain.html'],
 ['public/frontier.html','client/frontier.html'],
 ['public/financial-services.html','client/financial-services.html'],
 ['public/transfer-receipts.html','client/transfer-receipts.html'],
 ['public/labs.html','client/labs.html'],
 ['public/funding-plan.js','client/funding-plan.js'],
 ['public/runtime-build-ui.js','client/runtime-build-ui.js'],
 ['public/frontier-ui.js','client/frontier-ui.js'],
 ['public/network-status.js','client/network-status.js'],
 ['docs/numina-integration-kit-v4.0.0.zip','client/downloads/numina-integration-kit-v4.0.0.zip'],
 ['docs/integration-kit-v4.0.0-record.json','client/downloads/integration-kit-v4.0.0-record.json'],
 ['public/treasury-connection-model.js','client/treasury-connection-model.js'],
 ['public/architecture-layers.js','client/architecture-layers.js'],
 ['public/architecture-labels.js','client/architecture-labels.js'],
 ['public/nusd-contract-record.js','client/nusd-contract-record.js'],
 ['public/treasury-proof.js','client/treasury-proof.js'],
 ['public/treasury-connection.js','client/treasury-connection.js'],
 ['public/treasury-balances.js','client/treasury-balances.js'],
 ['public/treasury-adjustment.js','client/treasury-adjustment.js'],
 ['public/treasury-preparation.js','client/treasury-preparation.js'],
 ['public/native-treasury.js','client/native-treasury.js'],
 ['public/treasury.html','client/treasury.html'],
 ['public/final-build.json','client/final-build.json'],
 ['public/business-core.json','client/business-core.json'],
 ['docs/NUMINA-FINAL-BUILD.json','client/downloads/NUMINA-FINAL-BUILD.json'],
 ['docs/Treasury-Evidence-v3.md','client/downloads/Treasury-Evidence-v3.md'],
 ['docs/Stripe-Deposit-Workflow.md','client/downloads/Stripe-Deposit-Workflow.md'],
 ['docs/NUSD-Minting-v4.md','client/downloads/NUSD-Minting-v4.md'],
 ['docs/NUSD-Contracts-v4.md','client/downloads/NUSD-Contracts-v4.md'],
 ['docs/NUSD-Conversion-Contracts.md','client/downloads/NUSD-Conversion-Contracts.md'],
 ['docs/Numina-Wallet-Signing-Controls.md','client/downloads/Numina-Wallet-Signing-Controls.md'],
 ['docs/Numina-500T-Deployment-Sequence.md','client/downloads/Numina-500T-Deployment-Sequence.md'],
 ['docs/Numina-Browser-Deployment-Preparation.md','client/downloads/Numina-Browser-Deployment-Preparation.md'],
 ['docs/Numina-500T-Simulation.md','client/downloads/Numina-500T-Simulation.md'],
 ['runtime/nusd/README.md','client/downloads/nusd/README.md'],
 ['runtime/nusd/settlement-receipt.json','client/downloads/nusd/settlement-receipt.json'],
 ['runtime/nusd/treasury-settlement-receipt-validation.json','client/downloads/nusd/treasury-settlement-receipt-validation.json'],
 ['public/metadata-alignment.json','client/metadata-alignment.json'],
 ['docs/Numina-Metadata-Alignment-v4.json','client/downloads/Numina-Metadata-Alignment-v4.json'],
 ['docs/Numina-DevDay-2026-Adoption.json','client/downloads/Numina-DevDay-2026-Adoption.json'],
 ['docs/Numina-Metadata-Alignment-v4.md','client/downloads/Numina-Metadata-Alignment-v4.md'],
 ['docs/treasury-client-alignment.md','client/downloads/treasury-client-alignment.md'],
 ['docs/native-package-record-v4.json','client/downloads/native-package-record-v4.json'],
 ['docs/Source-Alignment-v4.md','client/downloads/Source-Alignment-v4.md'],
 ['docs/numina-os-4.0.0-android-source.zip','client/downloads/numina-os-4.0.0-android-source.zip'],
 ['docs/numina-os-4.0.0-ios-source.zip','client/downloads/numina-os-4.0.0-ios-source.zip'],
 ['integrations/numina/file-manifest.json','client/downloads/integration-manifest.json'],
];
for(const [source,target]of overlays){mkdirSync(path.dirname('dist/'+target),{recursive:true});copyFileSync(source,'dist/'+target);}
const modules=['public/treasury-connection-model.js','public/nusd-contract-record.js','public/architecture-layers.js','public/owner-approval.js','src/treasury-alignment.js','src/native-treasury.js','src/bank-route-model.js','src/stripe-treasury.js','src/treasury-evidence.js'];
const original=Buffer.from(readFileSync('reference/live-server-index.js.b64','utf8').trim(),'base64').toString();
assert.equal(hash(original),baseline.workerSha256);
let worker=original;const substitutions=[];
const compile=s=>s.replace(/\r\n/g,'\n').replace(/^import .*;\n/gm,'').replace(/^export \{.*\};\n/gm,'').replace(/export (?!default)/g,'').trimStart().trimEnd()+'\n';
// Include the reviewed state descriptor before any architecture references.
const stateBefore=worker.slice(0,worker.indexOf('\n')+1);
const stateAfter=compile(readFileSync('public/state-reconciliation.js','utf8'))+stateBefore;
assert.equal(worker.split(stateBefore).length,2,'Unique worker state preamble');
worker=worker.replace(stateBefore,stateAfter);substitutions.push({source:'public/state-reconciliation.js',before:stateBefore,after:stateAfter});
// Preserve the retained runtime while annotating its existing public readbacks.
const frontierBefore="async function frontierHttp(req,env){\n  const path=new URL(req.url).pathname;";
const frontierAfter=frontierBefore+"\n  if(path==='/api/control/v2/state-reconciliation'&&req.method==='GET')return frontierResponse(NUMINA_STATE_RECONCILIATION);";
assert.equal(worker.split(frontierBefore).length,2,'Unique reconciliation route');
worker=worker.replace(frontierBefore,frontierAfter);substitutions.push({source:'src/frontier-http.js#state-reconciliation',before:frontierBefore,after:frontierAfter});
const releaseBefore=worker.split('\n').find(line=>line.includes('return {schema:value.schema,schema_version:value.schema_version'));
assert.ok(releaseBefore,'Public artifact declaration projection');
const releaseAfter=releaseBefore.replace('return {schema:value.schema,','return {stateReconciliation:NUMINA_STATE_RECONCILIATION,schema:value.schema,');
worker=worker.replace(releaseBefore,releaseAfter);substitutions.push({source:'src/worker.js#public-release-state',before:releaseBefore,after:releaseAfter});
const controlBefore="adapters:[CONTROL_ADAPTER],unsupportedAdapters:'ESCALATE',";
const controlAfter='stateReconciliation:NUMINA_STATE_RECONCILIATION,'+controlBefore;
assert.equal(worker.split(controlBefore).length,2,'Unique v1 control manifest');
worker=worker.replace(controlBefore,controlAfter);substitutions.push({source:'src/control-http.js#state-reconciliation',before:controlBefore,after:controlAfter});
// Correct only the current manifest reader and caller. Keep retained production
// authentication, signed RC26 handlers and all unrelated worker bytes intact.
const applicationReaderBefore=worker.slice(worker.indexOf('async function readApplicationRelease(req,env){'),worker.indexOf('async function controlNuminaManifest(req,env){'));
const controlSource=readFileSync('src/control-http.js','utf8').replace(/\r\n/g,'\n');
const applicationReaderAfter=controlSource.slice(controlSource.indexOf('async function readApplicationRelease(req,env){'),controlSource.indexOf('async function controlNuminaManifest(req,env){'));
assert.ok(applicationReaderBefore.length>100&&applicationReaderAfter.length>100,'Application inventory reader boundaries');
assert.equal(worker.split(applicationReaderBefore).length,2,'Unique application inventory reader');
worker=worker.replace(applicationReaderBefore,applicationReaderAfter);substitutions.push({source:'src/control-http.js#application-reader',before:applicationReaderBefore,after:applicationReaderAfter});
const identityAliasesBefore='    core:NUMINA,repository:NUMINA,software:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,\n    authentication:NUMINA,deployment:NUMINA,delivery:NUMINA,readiness:NUMINA,treasury:NUMINA,storage:NUMINA,projection:NUMINA,transport:NUMINA,\n';
const identityAliasesAfter='    applicationVersion:application?.version??null,\n    applicationRelease:application?.release??null,\n';
assert.equal(worker.split(identityAliasesBefore).length,2,'Unique canonical manifest mechanics aliases');
worker=worker.replace(identityAliasesBefore,identityAliasesAfter);substitutions.push({source:'src/control-http.js#manifest-mechanics',before:identityAliasesBefore,after:identityAliasesAfter});
const capabilityLines=worker.split('\n').filter(line=>line.includes('providers:FRONTIER_PROVIDERS,'));
assert.equal(capabilityLines.length,2,'Manifest and discovery capability readbacks');
for(const before of capabilityLines){const after=before.replace('providers:FRONTIER_PROVIDERS,','providers:FRONTIER_PROVIDERS,stateReconciliation:NUMINA_STATE_RECONCILIATION,legal:NUMINA_LEGAL_DISCOVERY,');assert.equal(worker.split(before).length,2);worker=worker.replace(before,after);substitutions.push({source:'src/frontier-http.js#capabilities',before,after});}
const headBefore=worker.split('\n').find(line=>line.includes("scope:'NUMINA finalized singular build projection'"));
assert.ok(headBefore,'Public projection scope');
const headAfter=headBefore.replace("scope:'NUMINA finalized singular build projection'","scope:'NUMINA finalized singular build projection',rootHashScope:'public_identity_projection_not_control_genesis',recordedControlGenesisRoot:NUMINA_STATE_RECONCILIATION.roots.recordedControlGenesisRoot,currentJournalRootVerified:false")
  .replace("readiness:'/v1/frontier/readiness'","readiness:'/api/control/v1/health'")
  .replace("blockchainConnection:'/v2/network/status'","blockchainConnection:null,blockchainConnectionStatus:'CURRENT_OBSERVATION_UNAVAILABLE',networkEvidence:'/api/nusd/v1/status'");
worker=worker.replace(headBefore,headAfter);substitutions.push({source:'src/frontier-http.js#projection-scope',before:headBefore,after:headAfter});
for(const source of modules){
  const before=readFileSync('reference/settlement-metadata-bases/'+path.basename(source)+'.txt','utf8');
  let after=compile(readFileSync(source,'utf8'));
  if(source==='public/architecture-layers.js')after=compile(readFileSync('public/procurement-policy.js','utf8'))+after;
  if(source==='src/stripe-treasury.js'){
    const start=after.indexOf('const NATIVE_USDC_MODEL='),end=after.indexOf('function stripeTreasuryError',start);
    assert.ok(start>=0&&end>start,'Stripe routing metadata boundaries');
    after=after.slice(start,end).trimEnd()+'\n';
  }
  if(source==='src/treasury-evidence.js'){
    // The retained provider adapter redacts its account ID. Preserve its exact
    // existing authentication check while the editable adapter still uses IDs.
    const editableCheck='record.account?.id===STRIPE_TREASURY_FINANCIAL_ACCOUNT';
    assert.equal(after.split(editableCheck).length,2);
    after=after.replace(editableCheck,'record.account?.reference_private===true');
  }
  assert.equal(worker.split(before).length,2,'Unique runtime module: '+source);
  worker=worker.replace(before,after);substitutions.push({source,before,after});
}
// Install the new GET-only provider reader and durable owner intent store in
// the normal production build, while retaining the surrounding live runtime.
const depositModules=['src/stripe-deposit-provider.js','src/treasury-deposit-store.js'];
const stripeSource=readFileSync('src/stripe-treasury.js','utf8');
const depositConstants=['STRIPE_TREASURY_ACCOUNT','STRIPE_TREASURY_FINANCIAL_ACCOUNT'].map(name=>{
  const declaration=stripeSource.match(new RegExp('^export const '+name+'=[^\\r\\n]+','m'))?.[0];
  assert.ok(declaration,'Pinned deposit destination declaration: '+name);
  assert.equal(worker.includes('const '+name+'='),false,'Deposit destination has no conflicting declaration');
  return compile(declaration);
}).join('');
const depositStart=worker.indexOf('async function treasuryConnectionHttp(');
const depositEnd=worker.indexOf('async function readConnectionManifest(',depositStart);
assert.ok(depositStart>=0&&depositEnd>depositStart,'Retained deposit route boundaries');
const depositBefore=worker.slice(depositStart,depositEnd);
const depositAfter=depositConstants+depositModules.map(source=>compile(readFileSync(source,'utf8'))).join('\n')+compile(readFileSync('src/treasury-connection-http.js','utf8'))+'\n\n';
assert.equal(worker.split(depositBefore).length,2,'Unique retained deposit route');
worker=worker.replace(depositBefore,()=>depositAfter);
substitutions.push({source:'treasury-deposit#runtime',before:depositBefore,after:depositAfter});
const depositHeaderBefore="if(path===TRANSFER_RECEIPTS_ROUTE||path.startsWith(TRANSFER_RECEIPTS_ROUTE+'/'))headers.set('X-Numina-Provider-Verification','scoped-observation-only');";
const depositHeaderAfter="if(path===TRANSFER_RECEIPTS_ROUTE||path.startsWith(TRANSFER_RECEIPTS_ROUTE+'/')||path==='/api/treasury/v1/submissions')headers.set('X-Numina-Provider-Verification','scoped-observation-only');";
assert.equal(worker.split(depositHeaderBefore).length,2,'Unique scoped provider header');
worker=worker.replace(depositHeaderBefore,depositHeaderAfter);
substitutions.push({source:'treasury-deposit#verification-header',before:depositHeaderBefore,after:depositHeaderAfter});
// Update the mutable NUSD status views without altering the adopted
// redemption policy or its digest in the retained runtime.
const nusdSource=compile(readFileSync('src/nusd-http.js','utf8'));
const nusdSections=[
 ['nusd-mint-workflow.js.txt','const constructorMintEvidence=','const NUSD_CONVERSION_WORKFLOW='],
 ['nusd-policy.js.txt','const NUSD_POLICY=','async function nusdHttp(']
];
for(const [name,startMarker,endMarker] of nusdSections){
  const before=readFileSync('reference/settlement-metadata-bases/'+name,'utf8');
  const start=nusdSource.indexOf(startMarker),end=nusdSource.indexOf(endMarker,start);
  assert.ok(start>=0&&end>start,'NUSD status source boundaries: '+name);
  let after=nusdSource.slice(start,end).trimEnd()+'\n';
  if(name==='nusd-policy.js.txt'){
    // The public worker deliberately redacts private RPC routing details.
    assert.equal((after.match(/rpc_url:'[^']+'/g)||[]).length,1);
    assert.equal((after.match(/environment_id:'[^']+'/g)||[]).length,1);
    after=after.replace(/rpc_url:'[^']+'/, 'rpc_url:null').replace(/environment_id:'[^']+'/, 'environment_id:null');
  }
  assert.equal(worker.split(before).length,2,'Unique runtime NUSD section: '+name);
  worker=worker.replace(before,after);
  substitutions.push({source:'src/nusd-http.js#'+name,before,after});
}
const policyRouteBefore=readFileSync('reference/settlement-metadata-bases/treasury-policy-route.js.txt','utf8');
const frontierSource=readFileSync('src/frontier-http.js','utf8').replace(/\r\n/g,'\n');
const policyRouteStart=frontierSource.indexOf("if(path==='/api/control/v2/treasury/policy'&&req.method==='GET'){");
const policyRouteEnd=frontierSource.indexOf("if(path==='/api/control/v2/discovery-mcp')",policyRouteStart);
assert.ok(policyRouteStart>=0&&policyRouteEnd>policyRouteStart,'Treasury policy route boundaries');
const policyRouteAfter=frontierSource.slice(policyRouteStart,policyRouteEnd).trimEnd()+'\n';
assert.equal(worker.split(policyRouteBefore).length,2,'Unique retained treasury policy route');
worker=worker.replace(policyRouteBefore,policyRouteAfter);
substitutions.push({source:'src/frontier-http.js#treasury-policy-route',before:policyRouteBefore,after:policyRouteAfter});
// Expose the current legal descriptor through the already installed discovery tools.
const connectionLegalBefore='return validateConnectionManifest(await response.json());';
const connectionLegalAfter='return {...validateConnectionManifest(await response.json()),legal:NUMINA_LEGAL_DISCOVERY};';
assert.equal(worker.split(connectionLegalBefore).length,2,'Unique connection manifest readback');
worker=worker.replace(connectionLegalBefore,connectionLegalAfter);substitutions.push({source:'src/connections-http.js#legal-discovery',before:connectionLegalBefore,after:connectionLegalAfter});
// Add the hosted MCP alias without replacing authorization or private routes.
const mcpSource=compile(readFileSync('src/sites-mcp.js','utf8'));
const mcpExportBefore='export default {';
const legalHttpSource=compile(readFileSync('src/legal-coverage.js','utf8'));
const mcpExportAfter=legalHttpSource+'\n'+mcpSource+'\n'+mcpExportBefore;
assert.equal(worker.split(mcpExportBefore).length,2,'Unique worker entrypoint');
worker=worker.replace(mcpExportBefore,mcpExportAfter);
substitutions.push({source:'src/sites-mcp.js',before:mcpExportBefore,after:mcpExportAfter});
const mcpRouteBefore="   if(path.startsWith('/api/reviewer/v1/'))return finish(await reviewerHttp(req,env));";
const mcpRouteAfter='   const legal=await legalCoverageHttp(req,env);if(legal)return finish(legal);\n   const mcp=await sitesMcpHttp(req,env,frontierHttp);if(mcp)return finish(mcp);\n'+mcpRouteBefore;
assert.equal(worker.split(mcpRouteBefore).length,2,'Unique hosted MCP route insertion');
worker=worker.replace(mcpRouteBefore,mcpRouteAfter);
substitutions.push({source:'src/sites-mcp.js#route',before:mcpRouteBefore,after:mcpRouteAfter});
// Add structured rooms and owner-only journaled assignments to the retained runtime.
const treeSource=compile(readFileSync('src/numina-tree.js','utf8'));
const treeEntrypoint='export default {';
const treeEntrypointAfter=treeSource+'\n'+treeEntrypoint;
assert.equal(worker.split(treeEntrypoint).length,2);
worker=worker.replace(treeEntrypoint,treeEntrypointAfter);
substitutions.push({source:'src/numina-tree.js',before:treeEntrypoint,after:treeEntrypointAfter});
const treeEdits=[
 ["const frontierRoutes={","const frontierRoutes={'tree/tasks':'room_task',"],
 ["    if(path==='/api/control/v2/architecture'","    if(path==='/api/control/v2/tree'&&req.method==='GET')return frontierResponse(numinaTree());\n    if(path==='/api/control/v2/architecture'"],
 ["    if(route==='state'&&req.method==='GET'){","    if(route==='tree/tasks'&&req.method==='GET'){frontierAssert(actor===row.manifest.root,'OWNER_REQUIRED',403);return frontierResponse({revision:row.revision,head:row.head_hash,...readRoomTasks(row.manifest)});}\n    if(route==='state'&&req.method==='GET'){"],
 ["f.accounts=[];delete f.treasuryPolicies;","f.accounts=[];delete f.roomTasks;delete f.treasuryPolicies;"]
];
const treeReducer=compile(readFileSync('src/frontier.js','utf8'));
const treeBranchStart=treeReducer.indexOf("  if(command.type==='frontier.room_task'){");
const treeBranchEnd=treeReducer.indexOf("  }else if(command.type==='frontier.principal'){",treeBranchStart);
assert.ok(treeBranchStart>=0&&treeBranchEnd>treeBranchStart,'Structured room reducer boundaries');
treeEdits.push(["  if(command.type==='frontier.principal'){",treeReducer.slice(treeBranchStart,treeBranchEnd)+"  }else if(command.type==='frontier.principal'){"]);
for(const [before,after] of treeEdits){assert.equal(worker.split(before).length,2,'Unique tree insertion: '+before);worker=worker.replace(before,after);substitutions.push({source:'numina-tree#runtime',before,after});}
// New workspace policy acceptance is request-bound. Cached privacy-only clients
// cannot be stamped as accepting newly introduced Terms; old rows remain intact.
const legalCore=compile(readFileSync('src/app-core.js','utf8'));
const legalDeclarations=['APP_CONSENT_VERSION','APP_LEGAL_POLICY'].map(name=>{
  const declaration=legalCore.match(new RegExp('^const '+name+'=[^\\r\\n]+','m'))?.[0];
  assert.ok(declaration,'Workspace policy declaration: '+name);return declaration;
}).join('\n')+'\n';
const appVersionBefore="const APP_VERSION='4.0.0';";
// The retained webhook is account-bound. Use the same prerequisite for health
// and checkout availability, preserving its stronger signature/account checks.
const paymentSource=readFileSync('src/app-http.js','utf8').replace(/\r\n/g,'\n');
const paymentHelper=compile(paymentSource.slice(paymentSource.indexOf('export function appPaymentConfirmationConfigured('),paymentSource.indexOf('function appResponse(')));
assert.ok(paymentHelper.startsWith('function appPaymentConfirmationConfigured('),'Payment configuration helper boundary');
const paymentAnchor='function appResponse(value,status=200,headers={})';
assert.equal(worker.split(paymentAnchor).length,2,'Unique payment configuration insertion');
worker=worker.replace(paymentAnchor,paymentHelper+paymentAnchor);substitutions.push({source:'src/app-http.js#payment-configuration',before:paymentAnchor,after:paymentHelper+paymentAnchor});
for(const [before,after]of [
 ["if(!secret||typeof expectedAccount!=='string'||!/^acct_[A-Za-z0-9]{8,100}$/.test(expectedAccount))appFail('PAYMENT_CONFIRMATION_UNAVAILABLE',503);","if(!appPaymentConfirmationConfigured(secret,expectedAccount))appFail('PAYMENT_CONFIRMATION_UNAVAILABLE',503);"],
 ["paymentConfirmation:env.NUMINA_STRIPE_WEBHOOK_SECRET?'configured':'not_configured'","paymentConfirmation:appPaymentConfirmationConfigured(env.NUMINA_STRIPE_WEBHOOK_SECRET,env.NUMINA_STRIPE_TREASURY_ACCOUNT)?'configured':'not_configured'"],
 ["if(!env.NUMINA_STRIPE_WEBHOOK_SECRET)appFail('PAYMENT_CONFIRMATION_UNAVAILABLE',503);","if(!appPaymentConfirmationConfigured(env.NUMINA_STRIPE_WEBHOOK_SECRET,env.NUMINA_STRIPE_TREASURY_ACCOUNT))appFail('PAYMENT_CONFIRMATION_UNAVAILABLE',503);"]
]){assert.equal(worker.split(before).length,2,'Unique hosted checkout configuration gate');worker=worker.replace(before,after);substitutions.push({source:'src/app-http.js#hosted-checkout-gate',before,after});}
const legalShared=compile(readFileSync('public/country-codes.js','utf8'))+compile(readFileSync('public/legal-discovery.js','utf8'));
const appVersionAfter=legalShared+legalDeclarations+appVersionBefore;
assert.equal(worker.split(appVersionBefore).length,2,'Unique application version declaration');
worker=worker.replace(appVersionBefore,appVersionAfter);substitutions.push({source:'workspace-policy#declarations',before:appVersionBefore,after:appVersionAfter});
const intakeStart=worker.indexOf('function appIntake(input){'),intakeEnd=worker.indexOf('function appPaymentSummary(',intakeStart);
const newIntakeStart=legalCore.indexOf('function appIntake(input){'),newIntakeEnd=legalCore.indexOf('function appPaymentSummary(',newIntakeStart);
assert.ok(intakeStart>=0&&intakeEnd>intakeStart&&newIntakeStart>=0&&newIntakeEnd>newIntakeStart,'Workspace intake policy boundaries');
const intakeBefore=worker.slice(intakeStart,intakeEnd),intakeAfter=legalCore.slice(newIntakeStart,newIntakeEnd);
assert.equal(worker.split(intakeBefore).length,2,'Unique workspace intake policy');
worker=worker.replace(intakeBefore,intakeAfter);substitutions.push({source:'workspace-policy#intake',before:intakeBefore,after:intakeAfter});
for(const [before,after]of [
 ["return appResponse({denomination_policy:NUMINA_LAYERS.denomination_policy","return appResponse({legalPolicy:APP_LEGAL_POLICY,denomination_policy:NUMINA_LAYERS.denomination_policy"],
 ["payloadHash,APP_VERSION,actor.id)","payloadHash,body.consentVersion,actor.id)"],
 ["if(row.country!=='US'&&row.status!=='scoped')appFail('COUNTRY_REVIEW_REQUIRED',409);","if(row.country!=='US')appFail('COUNTRY_REVIEW_REQUIRED',409);"],
 ["internationalRequests:'review_before_checkout',","internationalRequests:'review_before_checkout',internationalCheckout:'unavailable_pending_country_activity_approval',countryApprovalEvidenceImplemented:false,"]
]){assert.equal(worker.split(before).length,2,'Unique workspace acceptance insertion');worker=worker.replace(before,after);substitutions.push({source:'workspace-policy#acceptance',before,after});}
const legalRouteBefore="if(['/frontier','/frontier/','/control-room','/control-room/'].includes(path))";
const legalRouteAfter="const legalPages={'/compliance':'/compliance.html','/compliance/':'/compliance.html','/terms':'/terms.html','/terms/':'/terms.html','/privacy':'/privacy.html','/privacy/':'/privacy.html','/software-licenses':'/software-licenses.html','/software-licenses/':'/software-licenses.html'};\n   if(legalPages[path])return finish(await env.ASSETS.fetch(new Request(new URL(legalPages[path],req.url),req)));\n   "+legalRouteBefore;
assert.equal(worker.split(legalRouteBefore).length,2,'Unique maintained legal-page routing boundary');
worker=worker.replace(legalRouteBefore,legalRouteAfter);substitutions.push({source:'workspace-policy#legal-routes',before:legalRouteBefore,after:legalRouteAfter});
// All interactive Numina pages share the verified browser-session origin.
const sessionDeclarations=compile(readFileSync('public/workspace-session.js','utf8'));
const sessionPreambleBefore=worker.slice(0,worker.indexOf('\n')+1),sessionPreambleAfter=sessionDeclarations+sessionPreambleBefore;
assert.equal(worker.split(sessionPreambleBefore).length,2,'Unique Numina session preamble');
worker=worker.replace(sessionPreambleBefore,sessionPreambleAfter);substitutions.push({source:'public/workspace-session.js',before:sessionPreambleBefore,after:sessionPreambleAfter});
const sessionRouteBefore=legalRouteAfter;
const sessionRouteSource=readFileSync('src/worker.js','utf8').match(/   const workspaceTarget=workspaceSessionTarget\(req.url,req.method\);\n   if\(workspaceTarget\)[^\n]+/)[0];
const sessionRouteAfter=sessionRouteSource+'\n   '+sessionRouteBefore;
assert.equal(worker.split(sessionRouteBefore).length,2,'Unique Numina session route');
worker=worker.replace(sessionRouteBefore,sessionRouteAfter);substitutions.push({source:'src/worker.js#workspace-session',before:sessionRouteBefore,after:sessionRouteAfter});
// Correct the retained policy address literal outside the metadata modules.
// Raw evidence is kept in the authenticated worker, outside the static bundle.
const privateRecords=privateArtifactRecords();
const privacyPreambleBefore=worker.slice(0,worker.indexOf('\n')+1);
const privacyPreambleAfter=compile(readFileSync('src/public-privacy.js','utf8'))+compile(readFileSync('src/publication-http.js','utf8'))+'const NUMINA_PRIVATE_ARTIFACTS='+JSON.stringify(privateRecords)+';\n'+privacyPreambleBefore;
worker=worker.replace(privacyPreambleBefore,privacyPreambleAfter);substitutions.push({source:'src/publication-http.js#private-artifacts',before:privacyPreambleBefore,after:privacyPreambleAfter});
const privacyRouteBefore='   const legal=await legalCoverageHttp(req,env);if(legal)return finish(legal);';
const privacyRouteAfter='   const publication=await publicationHttp(req,env,NUMINA_PRIVATE_ARTIFACTS);if(publication)return finish(publication);\n'+privacyRouteBefore;
assert.equal(worker.split(privacyRouteBefore).length,2);worker=worker.replace(privacyRouteBefore,privacyRouteAfter);substitutions.push({source:'src/publication-http.js#routing',before:privacyRouteBefore,after:privacyRouteAfter});
for(const [before,after]of [['canonicalTreasuryValues:NUMINA_CANONICAL_TREASURY_VALUES,canonicalTreasuryRoute:', 'canonicalTreasuryValues:publicMetadata(NUMINA_CANONICAL_TREASURY_VALUES),canonicalTreasuryRoute:'],['providerRouting:NUSD_PROVIDER_ROUTING,mcp:', 'providerRouting:publicMetadata(NUSD_PROVIDER_ROUTING),mcp:']]){
 assert.equal(worker.split(before).length,2);worker=worker.replace(before,after);substitutions.push({source:'src/public-privacy.js#public-api',before,after});
}
// Their exact offsets are recorded so preservation can still be proved.
const stripeUsdcAddress=connection.nativeLocationBindings.stripeUsdc.usdcAddress;
assert.equal(stripeUsdcAddress,json('runtime/nusd/treasury-settlement-receipt.json').components.find(item=>item.settledUnit==='USDC').usdcAddress);
const priorStripeUsdcAddress='0x735bd8f274dce00a8bb374edd85df0d2e631018e';
const addressCorrections=[];
for(let offset=worker.indexOf(priorStripeUsdcAddress);offset!==-1;offset=worker.indexOf(priorStripeUsdcAddress,offset+stripeUsdcAddress.length)){
  addressCorrections.push(offset);worker=worker.slice(0,offset)+stripeUsdcAddress+worker.slice(offset+priorStripeUsdcAddress.length);
}
assert.equal(addressCorrections.length,1,'Retained Stripe policy address binding');
// Reverse the approved substitutions to prove the rest of the live runtime
// (routing, authentication, provider adapters and journal reducer) is unchanged.
let restored=worker;for(const offset of addressCorrections.slice().reverse()){assert.equal(restored.slice(offset,offset+stripeUsdcAddress.length),stripeUsdcAddress);restored=restored.slice(0,offset)+priorStripeUsdcAddress+restored.slice(offset+stripeUsdcAddress.length);}for(const {before,after}of substitutions.slice().reverse()){assert.equal(restored.split(after).length,2);restored=restored.replace(after,before);}assert.equal(restored,original);
mkdirSync('dist/server',{recursive:true});writeFileSync('dist/server/index.js',worker);
execFileSync(process.execPath,['--check','dist/server/index.js'],{stdio:'inherit'});
mkdirSync('dist/.openai',{recursive:true});writeFileSync('dist/.openai/hosting.json',JSON.stringify(json('.openai/hosting.json'),null,2)+'\n');
function copyTree(from,to){mkdirSync(to,{recursive:true});for(const n of readdirSync(from)){const a=path.join(from,n),b=path.join(to,n);statSync(a).isDirectory()?copyTree(a,b):copyFileSync(a,b);}}
const migrationJournalBase='reference/settlement-metadata-bases/deposit-migration-journal.json.txt';
assert.equal(hash(readFileSync(migrationJournalBase)),baseline.artifacts.find(a=>a.path==='.openai/drizzle/meta/_journal.json').sha256,'Retained migration journal bytes');
const retainedMigrationJournal=json(migrationJournalBase);
copyTree('drizzle','dist/.openai/drizzle');
const currentMigrationJournal=json('dist/.openai/drizzle/meta/_journal.json');
assert.deepEqual(currentMigrationJournal.entries.slice(0,retainedMigrationJournal.entries.length),retainedMigrationJournal.entries,'Retained migration history');
assert.deepEqual(currentMigrationJournal.entries.slice(retainedMigrationJournal.entries.length).map(entry=>entry.tag),['0006_treasury_deposit_instructions'],'Only the additive deposit migration');
for(const a of baseline.artifacts.filter(x=>x.path.startsWith('.openai/drizzle/')&&x.path!=='.openai/drizzle/meta/_journal.json'))assert.equal(hash(readFileSync('dist/'+a.path)),a.sha256,'Published migration bytes: '+a.path);
let headers=readFileSync('public/_headers','utf8'),redirects=readFileSync('public/_redirects','utf8').trimEnd();
const presentation=['index','government','financial-institutions','partners','developers','trust','uk-eu','mena','apac','contact'];
const hashes=new Set();for(const name of presentation){const html=readFileSync('dist/client/'+name+'.html','utf8');for(const m of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g))hashes.add("'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'");if(name!=='index'){const rule='/'+name+'.html /'+name+' 301';if(!redirects.split(/\r?\n/).includes(rule))redirects+='\n'+rule;}}
headers=headers.replace(/script-src ([^;]+)/,(_,tokens)=>'script-src '+[...new Set([...tokens.trim().split(/\s+/),...hashes])].join(' '));writeFileSync('dist/client/_headers',headers);writeFileSync('dist/client/_redirects',redirects+'\n');
const sourceAlignment=json('dist/client/source-alignment.json');
sourceAlignment.stateReconciliation=NUMINA_STATE_RECONCILIATION;
sourceAlignment.procurement_usage=false;sourceAlignment.procurement=NUMINA_LAYERS.procurement;
sourceAlignment.requiredArchitecture.procurement_usage=false;
const currentInputs=new Set(['config/numina-state-reconciliation.v1.json','public/state-reconciliation.js','runtime/vercel-production/state-reconciliation.json',...overlays.map(x=>x[0]),...modules,'src/nusd-http.js','reference/settlement-metadata-bases/nusd-mint-workflow.js.txt','reference/settlement-metadata-bases/nusd-policy.js.txt','package.json','config/numina-architecture.json','config/numina-manifest.v2.json','config/treasury-aggregate-settlement-1500t.v1.json','integrations/numina/package.json','integrations/numina/distribution.json','integrations/numina/verification.json','integrations/numina/src/treasury-proof.js','scripts/nusd-contract-record.mjs','scripts/build-frontier-settlement.mjs','scripts/apply-numina-manifest-metadata.mjs','scripts/write-settlement-validation.mjs','scripts/align-nusd-release-metadata.mjs','scripts/generate-metadata-alignment.mjs','scripts/release-manifest.mjs','runtime/vercel-production/lib/numina-manifest.js','runtime/vercel-production/lib/deployment-estimate.mjs','scripts/package-current-integration.py','integrations/numina/scripts/package-distribution.js']);
for(const file of ['src/frontier-http.js','reference/settlement-metadata-bases/treasury-policy-route.js.txt'])currentInputs.add(file);
currentInputs.add('src/sites-mcp.js');
currentInputs.add('src/numina-tree.js');
currentInputs.add('src/frontier.js');
for(const file of [...depositModules,'src/stripe-treasury.js','src/treasury-connection-http.js','src/treasury-submission.js','src/worker.js','drizzle/0006_treasury_deposit_instructions.sql','drizzle/meta/0006_snapshot.json','db/schema.ts','docs/Stripe-Deposit-Workflow.md'])currentInputs.add(file);
currentInputs.add(migrationJournalBase);
currentInputs.add('src/control-http.js');
for(const file of ['src/public-privacy.js','src/publication-http.js','scripts/public-asset-privacy.mjs','public/journal-summary.json'])currentInputs.add(file);
for(const file of ['scripts/production-pair.mjs','reference/settlement-metadata-bases/sites-mcp.js.txt','src/connections-http.js','src/legal-coverage.js','public/legal-discovery.js','public/country-codes.js','scripts/package-distributions.py','scripts/package-legal-companions.mjs','integrations/numina/scripts/legal-distribution.js','integrations/numina/src/legal-discovery.js'])currentInputs.add(file);
currentInputs.add('src/app-core.js');
currentInputs.add('src/app-http.js');
currentInputs.add('runtime/nusd/development/local-chain.mjs');
currentInputs.add('runtime/nusd/development/README.md');
const captured=new Map(sourceAlignment.sourceInputs.map(x=>[x.path,x]));
const currentIosInputs=iosInputSnapshot(root);
for(const file of [...softwareReleaseInputs,'scripts/check-software-release.mjs',...currentIosInputs.inputs.map(x=>x.path)])currentInputs.add(file);
for(const file of currentInputs){const bytes=readFileSync(file);captured.set(file,{path:file,bytes:bytes.length,sha256:hash(bytes)});}
sourceAlignment.sourceInputs=[...captured.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
sourceAlignment.sourceInputCount=sourceAlignment.sourceInputs.length;
sourceAlignment.versions={...sourceAlignment.versions,...softwareReleaseAlignment.versions};
sourceAlignment.nativeBuildNumber=softwareReleaseAlignment.nativeSourceBuildNumbers.android;
sourceAlignment.nativeSourceBuildNumbers=softwareReleaseAlignment.nativeSourceBuildNumbers;
sourceAlignment.softwareReleaseAlignment=softwareReleaseAlignment;
sourceAlignment.iosSource={...checkIOSRelease(root),sourceInputs:currentIosInputs};
sourceAlignment.sourceInputCaptureScope='Current metadata overlay inputs; other entries retained from the preserved published source inventory';
sourceAlignment.sourceInputProvenance={baselineBuildId:baseline.build_id,currentMetadataInputs:[...currentInputs].sort(),otherInputs:'retained_published_inventory'};
sourceAlignment.provider_routing=NUSD_PROVIDER_ROUTING;
sourceAlignment.metadataAlignment=json('public/metadata-alignment.json');
sourceAlignment.activeProvenancePolicy=structuredClone(activeProvenancePolicy);
sourceAlignment.canonicalTreasuryValues=values;
delete sourceAlignment.singularSettlementReceipt;
sourceAlignment.settlementReceiptValidation=structuredClone(receipt);
sourceAlignment.historicalSettlementReceipt={id:receipt.validatedReceiptId,path:receipt.historicalReceiptPath,download:receipt.historicalReceiptDownload,status:'HISTORICAL_OWNER_ASSERTION',historicalRecord:true,currentJournalConfirmed:false};
sourceAlignment.treasury=NUMINA_LAYERS.treasury;sourceAlignment.contract_record=NUSD_CONTRACT_RECORD;
sourceAlignment.treasury_client_verification=treasuryClientVerificationManifest(hash(readFileSync('public/treasury-proof.js')));
sourceAlignment.requiredArchitecture.canonicalTreasuryValues=values;
const architecture=sourceAlignment.requiredArchitecture;
const historicalTransfer=architecture.treasury.software_transfer;
const historicalMintEvent=architecture.mint_event;
const historicalSoftwareAlignment=architecture.software_alignment;
const preparedMint=values.observation.requests.find(request=>request.kind==='mint_request');
assert.equal(preparedMint?.status,'PREPARED','Observed native mint request');
Object.assign(architecture.treasury,{
  verification:'CURRENT_STATE_UNAVAILABLE',
  verificationScope:'AUTHENTICATED_CURRENT_RECORD_REQUIRED',
  provider_verification:null,
  providerBalancesVerified:false,
  modeled_role_values_additive:false,
  aggregate_modeled_value:null,
  historical_aggregate_modeled_value:'1500000000000000',
  software_values:{USD:null,USDC:null,NUSD:values.components.NUSD.current,aggregateNUSD:values.aggregate.current},
  software_values_scope:'CURRENT_STATE_UNAVAILABLE',
  projection:null,currentState:values.currentState,historicalJournalObservation:values.observation,
  software_transfer:null,
  historical_software_transfer:historicalTransfer?{...historicalTransfer,historicalRecord:true,currentJournalConfirmed:false}:null,
  canonicalValues:values
});
architecture.mint_event=null;
architecture.mint_request=null;
architecture.historical_mint_request={...preparedMint,observedRevision:values.observation.observedRevision,snapshotIsLive:false};
architecture.mintStatus=values.mintStatus;
const confirmedConstructorMint=values.separateChainMintEvidence;
architecture.historical_mint_event={...historicalMintEvent,status:'HISTORICAL_CHAIN_RECEIPT',historicalRecord:true,currentChainStateVerified:false,observedAt:confirmedConstructorMint.observedAt,journalMintConfirmed:false,chain_id:confirmedConstructorMint.chainId,contract_address:confirmedConstructorMint.tokenAddress,transaction_hash:confirmedConstructorMint.transactionHash,block_number:confirmedConstructorMint.blockNumber,receipt_status:confirmedConstructorMint.receiptStatus,amount_nusd:confirmedConstructorMint.amountNusd,decimals:confirmedConstructorMint.decimals,base_units:confirmedConstructorMint.baseUnits,mint_receipt:confirmedConstructorMint.download,settlement_contract_deployment:confirmedConstructorMint.settlementContractDeployment};
architecture.numinaMetadata.canonicalTreasuryValues=values;
architecture.numinaMetadata.canonicalTreasuryValueStatus=values.status;
architecture.numinaMetadata.nativeEvidenceStatus='CURRENT_STATE_UNAVAILABLE';
architecture.numinaMetadata.manifestStatus='CURRENT_STATE_UNAVAILABLE';
architecture.numinaMetadata.provider_verification=null;
architecture.numinaMetadata.transfersEnabled=null;
architecture.provider_verification=null;
architecture.transfersEnabled=null;
architecture.software_alignment=null;
architecture.historical_software_alignment={...historicalSoftwareAlignment,historicalRecord:true,currentJournalConfirmed:false,treasuryModelScope:'HISTORICAL_SOURCE_ARTIFACT'};
writeFileSync('dist/client/source-alignment.json',JSON.stringify(sourceAlignment,null,2)+'\n');
const allowed=new Set([...overlays.map(x=>x[1]),'client/source-alignment.json']);let retained=0;for(const x of baselineClient)if(!allowed.has(x.path)){assert.equal(hash(readFileSync('dist/'+x.path)),x.sha256,'Unrelated published asset changed: '+x.path);retained++;}
assert.equal(json('dist/client/downloads/nusd/treasury-settlement-receipt.json').id,receipt.validatedReceiptId);
assert.equal(json('dist/client/downloads/nusd/treasury-settlement-receipt-validation.json').id,receipt.id);
// The byte-pinned FINAL artifact retains its dated projection; it is not current state.
assert.deepEqual(json('dist/client/final-build.json').canonicalTreasuryValues.observation,values.observation);
assert.equal(values.aggregate.current,null);
projectPublicAssets();
copyFileSync('public/journal-summary.json','dist/client/journal-summary.json');
const aliases=['release.json','application-release-v2.json','application-release-v3.json','application-release-v4.json'].map(n=>'client/downloads/'+n),excluded=new Set(aliases);
const collect=(dir='dist',relative='')=>readdirSync(dir).flatMap(n=>{const p=relative?relative+'/'+n:n,a=path.join(dir,n);return statSync(a).isDirectory()?collect(a,p):excluded.has(p)?[]:[{path:p,sha256:hash(readFileSync(a))}];});
const artifacts=collect().sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),buildId=hash(artifacts.map(x=>x.sha256+'  '+x.path+'\n').join(''));
const release=structuredClone(baseline);
// Current descriptor fingerprints must identify the shipped overlays. The
// baseline and signed historical records remain byte-for-byte preserved.
const artifactHashes=new Map(artifacts.map(item=>[item.path,item.sha256]));
const currentBindings=[release.security,...Object.values(release.owner_wallet_execution.modules),...Object.values(release.receipt_observation_intake.modules),...Object.values(release.evidence_handoff.modules)];
for(const binding of currentBindings){
 const pathname=binding.path??binding.url??binding.controlModel;
 const artifactPath='client'+pathname;
 assert.ok(artifactHashes.has(artifactPath),'Current release binding asset: '+pathname);
 binding.sha256=artifactHashes.get(artifactPath);
}
release.stateReconciliation=NUMINA_STATE_RECONCILIATION;
release.procurement_usage=false;release.procurement=NUMINA_LAYERS.procurement;
release.software_release_alignment=softwareReleaseAlignment;
function align(o){if(!o||typeof o!=='object')return;for(const k of Object.keys(o))if(k==='canonicalTreasuryValues')o[k]=structuredClone(values);else align(o[k]);}align(release);
release.provider_routing=NUSD_PROVIDER_ROUTING;
release.activeProvenancePolicy=structuredClone(activeProvenancePolicy);
release.mint_workflow=NUSD_MINT_WORKFLOW;
release.conversion_workflow=NUSD_CONVERSION_WORKFLOW;
release.stripe_deposit_workflow={
  ...STRIPE_DEPOSIT_CAPABILITY,endpoint:'/api/treasury/v1/submissions',
  authorization:'authenticated_owner_with_explicit_request_bound_confirmation',
  documentation:'/downloads/Stripe-Deposit-Workflow.md',migration:'0006_treasury_deposit_instructions',
  instructions_are_submission:false,nusd_mint_is_usd_backing_evidence:false,
  source_sha256:Object.fromEntries([...depositModules,'src/treasury-connection-http.js','src/treasury-submission.js'].map(file=>[file,hash(readFileSync(file))]))
};
release.compatibility.additive_migrations=[...new Set([...release.compatibility.additive_migrations,'0006_treasury_deposit_instructions'])];
release.owner_approval={...NUMINA_OWNER_APPROVAL,source:'/owner-approval.js',sha256:hash(readFileSync('public/owner-approval.js'))};
release.canonicalTreasuryValues=values;release.contract_record=NUSD_CONTRACT_RECORD;
release.softwareTreasury={identity:'NUMINA',singular:true,...structuredClone(connection.softwareBalanceModel)};
release.native_treasury_alignment={...release.native_treasury_alignment,status:'CURRENT_STATE_UNAVAILABLE',currentState:values.currentState,historicalJournalObservation:values.observation,settlementReceiptValidation:structuredClone(receipt),historicalSettlementReceipt:{id:receipt.validatedReceiptId,path:receipt.historicalReceiptPath,download:receipt.historicalReceiptDownload,status:'HISTORICAL_OWNER_ASSERTION',historicalRecord:true,currentJournalConfirmed:false},settlementStatus:values.settlementStatus??'UNVERIFIED',settlementScope:values.sourceOfRecord,mintStatus:values.mintStatus,mintedNusd:values.mintedNusd,burnedNusd:values.burnedNusd,aggregateModeledValue:null,historicalAggregateModeledValue:'1500000000000000',modeledAllocationsAdditive:false,verificationScope:'NUMINA_NATIVE_TREASURY_JOURNAL_SNAPSHOT'};
delete release.native_treasury_alignment.singularSettlementReceipt;
const nativeRecord=json('docs/native-package-record-v4.json'),iosInputs=iosInputSnapshot(root);
const iosSource=nativeRecord.sourceArchives.find(item=>item.platform==='ios');
assert.equal(iosSource?.sourceInputsSha256,iosInputs.sha256,'Current iOS source archive identity');
assert.equal(hash(readFileSync('docs/'+iosSource.file)),iosSource.sha256,'Current iOS source archive bytes');
release.distribution.native_candidates={...release.distribution.native_candidates,record:'/downloads/native-package-record-v4.json',previous_release:nativeRecord.previousRelease,application_version:nativeRecord.applicationVersion,hosted_workspace:nativeRecord.hostedWorkspace,android:nativeRecord.android,ios:{...nativeRecord.ios,current_source:{buildNumber:iosSource.sourceBuildNumber,sourceInputsSha256:iosInputs.sha256},source_archive_current:true},source_archives:nativeRecord.sourceArchives.map(item=>({...item,url:'/downloads/'+item.file,authoritative:false,currentSourceMatch:item.platform==='ios'?true:null})),source_authority:'checked-in mobile/ios source and ios-release identity',store_publication_verified:false};
release.treasury_client_verification=treasuryClientVerificationManifest(hash(readFileSync('public/treasury-proof.js')));
release.distribution.integration_kit.manifest_sha256=hash(Buffer.from(privateRecords['/downloads/integration-manifest.json'].body,'base64'));
const integrationArchive=json('docs/integration-kit-v4.0.0-record.json');
Object.assign(release.distribution.integration_kit,{archive_snapshot_sha256:integrationArchive.sha256,archive_snapshot_bytes:integrationArchive.bytes,archive_snapshot_authoritative:true,archive_manifest_matches_current:true,archive_record:'/downloads/integration-kit-v4.0.0-record.json'});
release.build_id=buildId;release.workerSha256=hash(worker);release.artifacts=artifacts;
alignNusdReleaseMetadata(release);
release.publicJournalSummary='/journal-summary.json';
release.distribution.integration_kit.access='authenticated_owner';
release.treasury_client_verification.verifier.sha256=hash(readFileSync('dist/client/treasury-proof.js'));
release.treasury_client_verification.privateAccountVerifier={path:'/api/control/v1/private-assets/treasury-proof.js',sha256:hash(readFileSync('public/treasury-proof.js')),access:'authenticated_owner'};
for(const f of aliases)writeFileSync('dist/'+f,JSON.stringify(publicMetadata(release),null,2)+'\n');
assert.deepEqual(checkActiveProvenance({rootDir:root}).errors,[],'Active provenance generated release gate');
execFileSync(process.execPath,['scripts/sync-application-release-pin.mjs','--write'],{stdio:'inherit'});
// A release cannot complete with divergent current manifests, asset hashes or
// a stale shared page shell. These checks use only this build and local fixtures.
execFileSync(process.execPath,['--test','tests/current-manifest-alignment.test.mjs','tests/publication-privacy.test.mjs'],{stdio:'inherit'});
for(const target of ['dist/server/index.js',...artifacts.filter(x=>/\.(?:js|json|html|md)$/.test(x.path)).map(x=>'dist/'+x.path),...aliases.map(x=>'dist/'+x)])assert.ok(!readFileSync(target,'utf8').includes('0x735bd8'),'Stale Stripe address in '+target);
const report={stripeUsdcDepositAddress:stripeUsdcAddress,retainedRuntimeAddressCorrections:addressCorrections.length,identity:'NUMINA',historicalReceiptId:receipt.id,aggregateNusd:values.aggregate.current,mintedNusd:values.mintedNusd,burnedNusd:values.burnedNusd,componentCount:3,buildId,workerSha256:hash(worker),baselineBuildId:baseline.build_id,retainedClientAssets:retained,overlaidClientAssets:allowed.size,runtimeModules:substitutions.map(item=>item.source),unrelatedRuntimeBytesPreserved:true,homepageUnchanged:false,externalProviderMutations:false};
mkdirSync('work',{recursive:true});writeFileSync('work/frontier-build-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
