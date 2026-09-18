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
const providerFormats=['openai-responses','openai-chat-completions','anthropic-messages','gemini-interactions','gemini-generate-content'];
const revision='numina-root-v'+metadata.version;
const singularIdentities=Object.freeze({
 root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',
 provider:'NUMINA',host:'NUMINA',provenance:'NUMINA',core:'NUMINA',repository:'NUMINA',software:'NUMINA',
 worker:'NUMINA',journal:'NUMINA',runtime:'NUMINA',artifact:'NUMINA',authentication:'NUMINA',deployment:'NUMINA',
 delivery:'NUMINA',readiness:'NUMINA',treasury:'NUMINA',storage:'NUMINA',projection:'NUMINA',transport:'NUMINA',
 release:'NUMINA',receipts:'NUMINA',settlements:'NUMINA',funds:'NUMINA',confirmation_evidence:'NUMINA'
});
const providerRoutes={tool:'numina_provider_routes',method:'GET',endpoint:'/api/control/v2/treasury/provider-routes',access:'authenticated_owner',schema:'numina.treasury.provider-routes.v1',clientPerformsProviderAcceptanceVerification:false,transferExecution:false};
const runtimeBuild={tool:'numina_runtime_build',manifestField:'execution_runtime_build',
 additionalManifestFields:['nusd_transaction_receipts','nusd_activation_readiness','denomination_policy','contract_record','mint_workflow','provider_routing','treasury_client_verification'],proofGuide:'EVIDENCE.md',
 clientPerformsSignatureVerification:false,clientPerformsReceiptVerification:false,clientPerformsReadinessVerification:false};
const treasuryAlignment={...singularIdentities,schema:'numina.treasury.alignment.v2',planSchema:'numina.treasury.alignment-plan.v2',status:'INITIATED',targetAmount:'500000000000000',designatedRoleCount:3,accountViewSchema:'numina.treasury.account-view.v2',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',separateRoles:true,singularIdentity:true,historicalProjectionSchema:'numina.treasury.projection.v1',providerRoleBalancesAdditive:false};
const repositoryObservation=Object.freeze({identity:'NUMINA',service:'GitHub',fullName:'skott34-dot/numina-production',repositoryId:1367647143,branch:'main',observedRole:'repository_service',authoritativeIdentity:false});
const integrationManifestRef={path:'file-manifest.json',schema:'numina.integration.manifest.v2',identity:'NUMINA',canonical:true};
const verification={
 schema:'numina.integration.package.v2',...singularIdentities,singular:true,integrationManifest:integrationManifestRef,packagedAtUtc:new Date().toISOString(),
 package:{name:metadata.name,version:metadata.version,private:metadata.private},revision,
 applicationManifest:'https://numinalabs.xyz/v4/release/manifest',applicationSchema:'numina.application-release.v2',runtimeBuild,providerRoutes,
 testRunPerformed:false,tests:null,reason:'Packaging generates metadata; validation runs separately in the repository test suite.',
 historicalValidation:'history/0.2.0/verification.json',
 providerFormats,mcpProtocolsImplemented:['2025-11-25','2025-06-18'],mcp20260728Implemented:false,
 defaultProfile:'discovery',defaultTools:toolsForProfile('discovery').map(tool=>tool.name),
 schemaGenerationPerformed:true,dependenciesAdded:0,typeScriptCompilerChecked:false,
 liveProviderAcceptanceVerified:false,productionEndpointCheckPerformed:false,remoteMcpHosted:false,
 providerInstallationPerformed:false,registryPublicationPerformed:false,appStoreSubmissionPerformed:false,
 nusdActivated:false,mintPerformed:false,transferPerformed:false,settlementConnected:false,treasuryAlignment
};
fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(verification,null,2)+'\n');
const distribution={
 ...singularIdentities,singular:true,integrationManifest:integrationManifestRef,treasuryAlignment,
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
 'package.json','.gitignore','OWNERSHIP.md','LICENSE.md','NOTICE.md','README.md','INSTALL.md','API-CONTRACT.md','SECURITY.md','COMPATIBILITY.md','EVIDENCE.md','VALIDATION.md','verification.json','distribution.json',
 'scripts/export-tools.js','scripts/package-distribution.js',...['src','bin','schemas','examples','history'].flatMap(walk)
].sort();
const fileManifest={schema:'numina.integration.manifest.v2',...singularIdentities,modelIdentity:'NUMINA',singular:true,canonical:true,role:'canonical_integration_manifest',version:metadata.version,revision,scope:'NUMINA',repository:'NUMINA',repositoryObservation,application:{manifest:'/v4/release/manifest',schema:'numina.application-release.v2'},treasuryAlignment,distribution:{path:'distribution.json',schema:'numina.integration.distribution.v2'},verification:{path:'verification.json',schema:'numina.integration.package.v2'},files:files.map(relative=>{
 if(/(?:^|\/)\.env|\.private\.|\.(?:pem|key|tgz|zip)$/.test(relative))throw new Error('Private or archive files are not distribution inputs');
 const bytes=fs.readFileSync(path.join(root,relative));
 return {path:relative,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
})};
fs.writeFileSync(path.join(root,'file-manifest.json'),JSON.stringify(fileManifest,null,2)+'\n');
console.log(JSON.stringify({version:metadata.version,files:files.length+1,testsRun:false,providerFormats:providerFormats.length,defaultTools:verification.defaultTools.length}));
