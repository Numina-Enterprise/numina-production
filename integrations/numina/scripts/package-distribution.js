import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import './export-tools.js'; // Generate descriptors only; this script never runs tests or requests.
import {toolsForProfile} from '../src/tools.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const metadata=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const providerFormats=['openai-responses','openai-chat-completions','anthropic-messages','gemini-interactions','gemini-generate-content'];
const revision='numina-root-v'+metadata.version;
const runtimeBuild={tool:'numina_runtime_build',manifestField:'execution_runtime_build',
 additionalManifestFields:['nusd_transaction_receipts','nusd_activation_readiness'],proofGuide:'EVIDENCE.md',
 clientPerformsSignatureVerification:false,clientPerformsReceiptVerification:false,clientPerformsReadinessVerification:false};
const verification={
 schema:'numina.integration.package.v2',packagedAtUtc:new Date().toISOString(),
 package:{name:metadata.name,version:metadata.version,private:metadata.private},revision,
 applicationManifest:'https://numinalabs.xyz/v3/release/manifest',applicationSchema:'numina.application-release.v2',runtimeBuild,
 testRunPerformed:false,tests:null,reason:'Packaging generates metadata; validation runs separately in the repository test suite.',
 historicalValidation:'history/0.2.0/verification.json',
 providerFormats,mcpProtocolsImplemented:['2025-11-25','2025-06-18'],mcp20260728Implemented:false,
 defaultProfile:'discovery',defaultTools:toolsForProfile('discovery').map(tool=>tool.name),
 schemaGenerationPerformed:true,dependenciesAdded:0,typeScriptCompilerChecked:false,
 liveProviderAcceptanceVerified:false,productionEndpointCheckPerformed:false,remoteMcpHosted:false,
 providerInstallationPerformed:false,registryPublicationPerformed:false,appStoreSubmissionPerformed:false,
 nusdActivated:false,mintPerformed:false,transferPerformed:false,settlementConnected:false
};
fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(verification,null,2)+'\n');
const distribution={
 livemode:true,frontier:{version:metadata.version,transport:'stdio-to-streamable-http',script:'bin/control-mcp-stdio.js',endpoint:'https://numinalabs.xyz/api/control/v2/mcp',protocolVersion:'2025-11-25',tokenEnvironmentVariable:'NUMINA_API_TOKEN',a2a:'https://numinalabs.xyz/.well-known/agent-card.json'},
 schema:'numina.integration.distribution.v2',version:metadata.version,revision,
 applicationManifest:'/v3/release/manifest',applicationSchema:'numina.application-release.v2',runtimeBuild,
 defaultOrigin:'https://numinalabs.xyz',defaultProfile:'discovery',
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
 'package.json','.gitignore','README.md','INSTALL.md','API-CONTRACT.md','SECURITY.md','COMPATIBILITY.md','EVIDENCE.md','VALIDATION.md','verification.json','distribution.json',
 'scripts/export-tools.js','scripts/package-distribution.js',...['src','bin','schemas','examples','history'].flatMap(walk)
].sort();
const fileManifest={schema:'numina.integration.files.v2',version:metadata.version,scope:'Integration source archive; separate from the Numina application artifact identity',files:files.map(relative=>{
 if(/(?:^|\/)\.env|\.private\.|\.(?:pem|key|tgz|zip)$/.test(relative))throw new Error('Private or archive files are not distribution inputs');
 const bytes=fs.readFileSync(path.join(root,relative));
 return {path:relative,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
})};
fs.writeFileSync(path.join(root,'file-manifest.json'),JSON.stringify(fileManifest,null,2)+'\n');
console.log(JSON.stringify({version:metadata.version,files:files.length+1,testsRun:false,providerFormats:providerFormats.length,defaultTools:verification.defaultTools.length}));
