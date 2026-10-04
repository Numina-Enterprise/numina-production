import {readFileSync,writeFileSync,unlinkSync,readdirSync,statSync} from 'node:fs';
import {publicMetadata} from '../src/public-privacy.js';
import {createHash} from 'node:crypto';
import * as treasury from '../public/treasury-connection-model.js';
import * as architecture from '../public/architecture-layers.js';
import * as contracts from '../public/nusd-contract-record.js';

// These exact originals are served only by the owner guard, never by ASSETS.
export const privateArtifactPaths=[
 'final-build.json','final-manifest.json','downloads/NUMINA-FINAL-BUILD.json',
 'downloads/NUMINA-FINAL-MANIFEST.json','downloads/nusd/treasury-settlement-receipt.json',
 'downloads/numina-integration-kit-v4.0.0.zip','downloads/integration-manifest.json',
 'downloads/integration-kit-v4.0.0-record.json',
 'downloads/Stripe-Deposit-Workflow.md','downloads/Numina-Metadata-Alignment-v4.md'
];
export function privateArtifactRecords(){
 const records=Object.fromEntries(privateArtifactPaths.map(file=>['/'+file,{body:readFileSync('dist/client/'+file).toString('base64'),type:file.endsWith('.zip')?'application/zip':file.endsWith('.json')?'application/json':'text/markdown; charset=utf-8'}]));
 records['/api/control/v1/private-assets/treasury-proof.js']={body:readFileSync('public/treasury-proof.js').toString('base64'),type:'text/javascript; charset=utf-8'};
 const preparation=readFileSync('public/treasury-preparation.js','utf8').replace("'./http-client.js'","'/http-client.js'").replace("'./treasury-adjustment.js'","'/treasury-adjustment.js'").replace("'./treasury-proof.js'","'/api/control/v1/private-assets/treasury-proof.js'");
 records['/api/control/v1/private-assets/treasury-preparation.js']={body:Buffer.from(preparation).toString('base64'),type:'text/javascript; charset=utf-8'};
 return records;
}
export function projectPublicAssets(){
 for(const file of privateArtifactPaths)unlinkSync('dist/client/'+file);
 const walk=dir=>readdirSync(dir).flatMap(name=>statSync(dir+'/'+name).isDirectory()?walk(dir+'/'+name):[dir+'/'+name]);
 for(const file of walk('dist/client')){
  if(file.endsWith('.json')){const original=JSON.parse(readFileSync(file,'utf8')),projection=publicMetadata(original);if(JSON.stringify(original)!==JSON.stringify(projection))writeFileSync(file,JSON.stringify(projection,null,2)+'\n');}
 }
 for(const [file,module]of [['treasury-connection-model.js',treasury],['architecture-layers.js',architecture],['nusd-contract-record.js',contracts]]){
  const text=Object.entries(module).map(([name,value])=>typeof value==='function'?'export '+value.toString():`export const ${name}=Object.freeze(${JSON.stringify(name==='NUMINA_OWNER_PROVIDED_BANK_DEPOSIT_ALIGNMENT'?{private:true,access:'authenticated_owner'}:publicMetadata(value))});`).join('\n');
  writeFileSync('dist/client/'+file,'// Generated public projection; private originals remain in canonical source.\n'+text+'\n');
 }
 // Generic journal/write verification remains public. Exact private account
 // expectations load only through the authenticated owner module.
 let proof=readFileSync('public/treasury-proof.js','utf8');
 proof=proof.slice(0,proof.indexOf('// Account rows are a read-only grouping'))+
  `export async function verifyTreasuryAccountView(view){try{const gate=await fetch('/api/control/v1/private-assets/treasury-proof.js',{method:'HEAD',credentials:'same-origin',cache:'no-store',redirect:'error'});if(!gate.ok)return false;const verifier=await import('/api/control/v1/private-assets/treasury-proof.js');return await verifier.verifyTreasuryAccountView(view);}catch{return false;}}\n`;
 writeFileSync('dist/client/treasury-proof.js',proof);
 writeFileSync('dist/client/treasury-preparation.js',`// Owner-only configuration loads after a fresh authenticated gate.\nexport function createTreasuryPreparation(options={}){const capturedOptions={...options};let instance;async function load(){const gate=await fetch('/api/control/v1/private-assets/treasury-preparation.js',{method:'HEAD',credentials:'same-origin',cache:'no-store',redirect:'error'});if(!gate.ok)throw Object.assign(Error('Owner authentication required'),{status:gate.status,code:'OWNER_VIEW_REQUIRED'});return instance??=(await import('/api/control/v1/private-assets/treasury-preparation.js')).createTreasuryPreparation(capturedOptions);}return Object.freeze({async prepare(input){const captured=structuredClone(input);return(await load()).prepare(captured);},async submit(draft){return(await load()).submit(draft);}});}\n`);
 const source=JSON.parse(readFileSync('dist/client/source-alignment.json','utf8'));
 source.publicJournalSummary='/journal-summary.json';
 source.treasury_client_verification.verifier.sha256=createHash('sha256').update(proof).digest('hex');
 source.treasury_client_verification.privateAccountVerifier={path:'/api/control/v1/private-assets/treasury-proof.js',sha256:createHash('sha256').update(readFileSync('public/treasury-proof.js')).digest('hex'),access:'authenticated_owner'};
 writeFileSync('dist/client/source-alignment.json',JSON.stringify(source,null,2)+'\n');
}
