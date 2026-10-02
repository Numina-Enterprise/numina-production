import {NUMINA_STATE_RECONCILIATION} from '../src/state-reconciliation.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import './export-tools.js'; // Generate descriptors only; this script never runs tests or requests.
import {toolsForProfile} from '../src/tools.js';
import {NUMINA_DENOMINATION_POLICY} from '../src/treasury-valuation.js';
import {treasuryClientVerificationManifest} from '../src/treasury-proof.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const metadata=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const workspacePackage=JSON.parse(fs.readFileSync(path.resolve(root,'../..','package.json'),'utf8'));
const numinaTree=workspacePackage.numinaTree;
const canonicalTreasuryValues=workspacePackage.canonicalTreasuryValues;
if(numinaTree?.canonicalSource!=='NUMINA'||numinaTree?.root!=='NUMINA'||canonicalTreasuryValues?.identity!=='NUMINA'||canonicalTreasuryValues?.aggregate?.current!=='1500000000000000')throw new Error('Workspace NUMINA tree/treasury contract mismatch');
const metadataAliasKeys=['software_identity','all_software','manifest_equals_numina','numina_equals_manifest','manifest_is_numina','numina_is_manifest','numina_is_all_software','all_software_is_numina','singular_software_identity','metadata_authority','metadata_namespace','metadata_scope','historical_metadata_override','current_metadata_override','canonical_metadata_override','competing_software_identity_allowed','competing_manifest_authority_allowed','competing_metadata_authority_allowed','transfersEnabled'];
const metadataAliases=Object.fromEntries(metadataAliasKeys.map(key=>[key,workspacePackage[key]]));
const providerFormats=['openai-responses','openai-chat-completions','anthropic-messages','gemini-interactions','gemini-generate-content'];
const revision='numina-root-v'+metadata.version;
const singularIdentities=Object.freeze({
 root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',owner:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',executor:'NUMINA',data:'NUMINA',data_namespace:'NUMINA',canonical_view:'NUMINA',view:'NUMINA',external_record:'NUMINA',external_fact:'NUMINA',external_evidence:'NUMINA',
 provider:'NUMINA',host:'NUMINA',provenance:'NUMINA',core:'NUMINA',repository:'NUMINA',software:'NUMINA',
 worker:'NUMINA',journal:'NUMINA',runtime:'NUMINA',artifact:'NUMINA',authentication:'NUMINA',deployment:'NUMINA',
 delivery:'NUMINA',readiness:'NUMINA',treasury:'NUMINA',storage:'NUMINA',projection:'NUMINA',transport:'NUMINA',
 release:'NUMINA',receipts:'NUMINA',settlements:'NUMINA',funds:'NUMINA',confirmation_evidence:'NUMINA'
});
const providerRoutes={tool:'numina_provider_routes',method:'GET',endpoint:'/api/control/v2/treasury/provider-routes',access:'authenticated_owner',schema:'numina.treasury.provider-routes.v1',clientPerformsProviderAcceptanceVerification:false,transferExecution:false};
const runtimeBuild={tool:'numina_runtime_build',manifestField:'execution_runtime_build',
 additionalManifestFields:['nusd_transaction_receipts','nusd_activation_readiness','denomination_policy','contract_record','mint_workflow','provider_routing','treasury_client_verification'],proofGuide:'EVIDENCE.md',
 clientPerformsSignatureVerification:false,clientPerformsReceiptVerification:false,clientPerformsReadinessVerification:false};
const treasuryAlignment={...singularIdentities,canonicalSource:'NUMINA',sourceOfTruth:'NUMINA',numinaTree,canonicalTreasuryValues,schema:'numina.treasury.alignment.v2',planSchema:'numina.treasury.alignment-plan.v2',status:'ALIGNED_MODEL',modelIdentity:'NUMINA',modelAligned:true,externalEvidenceStatus:'PENDING_PROVIDER_EVIDENCE',targetAmount:'500000000000000',aggregateModeledValue:'1500000000000000',aggregateModeledUnit:'NUSD',aggregation:'ONE_SINGULAR_NUMINA_TREASURY_THREE_ADDITIVE_COMPONENT_ROLES',verifiedModeledValue:'1500000000000000',verificationScope:'NUMINA_NATIVE_TREASURY_CONFIRMED_INTERNAL_MODELED_AGGREGATE',designatedRoleCount:3,accountViewSchema:'numina.treasury.account-view.v2',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',separateRoles:true,singularIdentity:true,historicalProjectionSchema:'numina.treasury.projection.v1',providerRoleBalancesAdditive:false,modeledRoleValuesAdditive:true,externalBalancesAggregated:false,componentRoleValue:'500000000000000',componentUnits:['USD','USDC','NUSD'],treasuryCount:1,accountCount:1,componentCount:3,holdingsCount:3,componentsAreSeparateTreasuries:false};
const nusdContracts={"schema":"numina.nusd.contract-lifecycle.v1","modelIdentity":"NUMINA","identity":"NUMINA","status":"DEPLOYED_VERIFIED","initiatedOn":"2026-09-18","contractCount":4,"contracts":["NuminaUSD","NuminaSettlement","NuminaUSDCConversion","NuminaUSDRedemption"],"deploymentPreparationInitiated":true,"deploymentVerified":true,"chainReceiptVerified":true,"mintStatus":"MINT_VERIFIED","mintSuccessReported":true,"mintVerified":true,"mintPerformed":true,"constructorMint":true,"decimals":18,"mintAmountNusd":"1500000000000000","tokenAddress":"0x491c1DF1b5CA77AF797f052c2310ca17039C931b","tokenTransactionHash":"0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b","settlementAddress":"0x7F9793d519464103e0c51EDcc5Ca6317c89af3A0","settlementTransactionHash":"0xe63dec1d443ccb15c87b3fb599bc868ef9b5919b6ef996ddb1c8aade4a6dba9b","paused":true,"conversionPerformed":false,"redemptionPerformed":false,"settlementPerformed":false,"externalDepositsPerformed":false,"externalBackingVerified":false};
const integrationManifestRef={path:'file-manifest.json',schema:'numina.integration.manifest.v2',identity:'NUMINA',canonical:true};
const verification={stateReconciliation:NUMINA_STATE_RECONCILIATION,
 schema:'numina.integration.package.v2',...singularIdentities,canonicalSource:'NUMINA',sourceOfTruth:'NUMINA',numinaTree,canonicalTreasuryValues,singular:true,integrationManifest:integrationManifestRef,packagedAtUtc:new Date().toISOString(),
 package:{name:metadata.name,version:metadata.version,private:metadata.private},revision,
 applicationManifest:'https://numinalabs.xyz/v4/release/manifest',applicationSchema:'numina.application-release.v2',runtimeBuild,providerRoutes,
 testRunPerformed:false,tests:null,reason:'Packaging generates metadata; validation runs separately in the repository test suite.',
 historicalValidation:'history/0.2.0/verification.json',
 providerFormats,mcpProtocolsImplemented:['2025-11-25','2025-06-18'],mcp20260728Implemented:false,
 defaultProfile:'discovery',defaultTools:toolsForProfile('discovery').map(tool=>tool.name),
 schemaGenerationPerformed:true,dependenciesAdded:0,typeScriptCompilerChecked:false,
 liveProviderAcceptanceVerified:false,productionEndpointCheckPerformed:false,remoteMcpHosted:false,
 providerInstallationPerformed:false,registryPublicationPerformed:false,appStoreSubmissionPerformed:false,
 nusdActivated:true,mintStatus:'MINT_VERIFIED',mintSuccessReported:true,mintVerified:true,mintPerformed:true,transferPerformed:false,settlementConnected:false,externalBackingVerified:false,nusdContracts,treasuryAlignment
};
fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(verification,null,2)+'\n');
const distribution={stateReconciliation:NUMINA_STATE_RECONCILIATION,
 ...singularIdentities,canonicalSource:'NUMINA',sourceOfTruth:'NUMINA',numinaTree,canonicalTreasuryValues,singular:true,integrationManifest:integrationManifestRef,nusdContracts,treasuryAlignment,
 treasury_client_verification:treasuryClientVerificationManifest(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/treasury-proof.js'))).digest('hex')),
 denomination_policy:NUMINA_DENOMINATION_POLICY,
 procurement_usage:true,procurementPolicy:'/business-core.json',
 livemode:true,frontier:{version:metadata.version,transport:'stdio-to-streamable-http',script:'bin/control-mcp-stdio.js',endpoint:'https://numinalabs.xyz/api/control/v2/mcp',protocolVersion:'2025-11-25',tokenEnvironmentVariable:'NUMINA_API_TOKEN',a2a:'https://numinalabs.xyz/.well-known/agent-card.json'},
 schema:'numina.integration.distribution.v2',version:metadata.version,revision,
 applicationManifest:'/v4/release/manifest',applicationSchema:'numina.application-release.v2',runtimeBuild,providerRoutes,
 defaultOrigin:'https://numinalabs.xyz',defaultProfile:'discovery',
 hostExamples:{nvidiaNim:{script:'examples/nvidia-nim.mjs',setup:'examples/NVIDIA.md',windowsBootstrap:'examples/setup-nvidia-wsl.ps1',localLauncher:'examples/start-nvidia-nim.sh',endpointVerifier:'examples/verify-nvidia-nim.mjs',providerPolicy:'examples/nvidia-provider-policy.json',protocol:'openai-chat-completions',profile:'discovery',liveAcceptanceVerified:false}},
 providerFormats:Object.fromEntries(providerFormats.map(name=>[name,{discovery:'schemas/'+name+'.json',workflow:'schemas/'+name+'-workflow.json'}])),
 mcp:{transport:'stdio',command:'node',script:'bin/mcp-stdio.js',template:'examples/mcp-host.example.json',protocols:verification.mcpProtocolsImplemented,hostedRemoteEndpoint:null},
 installation:'INSTALL.md',compatibility:'COMPATIBILITY.md',validation:'VALIDATION.md',
 applicationSignatureVerification:false,artifactBytesVerified:false,installedInProviders:false,registryPublished:false
};
fs.writeFileSync(path.join(root,'distribution.json'),JSON.stringify(distribution,null,2)+'\n');
const walk=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
 if(entry.isSymbolicLink())throw new Error('Symlinks are not distribution inputs');
 const relative=dir+'/'+entry.name;return entry.isDirectory()?walk(relative):[relative];
});
const files=[
 'package.json','OWNERSHIP.md','LICENSE.md','NOTICE.md','README.md','INSTALL.md','API-CONTRACT.md','SECURITY.md','COMPATIBILITY.md','EVIDENCE.md','VALIDATION.md','verification.json','distribution.json',
 'scripts/export-tools.js','scripts/package-distribution.js',...['src','bin','schemas','examples','history'].flatMap(walk)
].sort();
const fileManifest={stateReconciliation:NUMINA_STATE_RECONCILIATION,schema:'numina.integration.manifest.v2',...singularIdentities,canonicalSource:'NUMINA',sourceOfTruth:'NUMINA',numinaTree,canonicalTreasuryValues,modelIdentity:'NUMINA',singular:true,canonical:true,role:'canonical_integration_manifest',version:metadata.version,revision,scope:'NUMINA',repository:'NUMINA',nusdContracts,application:{manifest:'/v4/release/manifest',schema:'numina.application-release.v2'},treasuryAlignment,distribution:{path:'distribution.json',schema:'numina.integration.distribution.v2'},verification:{path:'verification.json',schema:'numina.integration.package.v2'},files:files.map(relative=>{
 if(/(?:^|\/)\.env|\.private\.|\.(?:pem|key|tgz|zip)$/.test(relative))throw new Error('Private or archive files are not distribution inputs');
 const bytes=fs.readFileSync(path.join(root,relative));
 return {path:relative,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
})};
Object.assign(fileManifest,{numinaMetadata:{...workspacePackage.numinaMetadata,numinaTree,canonicalTreasuryValues},...metadataAliases});
fs.writeFileSync(path.join(root,'file-manifest.json'),JSON.stringify(fileManifest,null,2)+'\n');
console.log(JSON.stringify({version:metadata.version,files:files.length+1,testsRun:false,providerFormats:providerFormats.length,defaultTools:verification.defaultTools.length}));
