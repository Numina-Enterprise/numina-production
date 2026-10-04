import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NUMINA_LEGAL_DISCOVERY} from '../src/legal-discovery.js';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const snapshots=['legal-policy.json','compliance-coverage.json','country-readiness.json','iowa-entity-registry.json','software-licenses.json','THIRD-PARTY-NOTICES.txt','terms.html','privacy.html','software-licenses.html','LICENSE.md','NOTICE.md'];

export function writeLegalCompanion(destination,publicRoot){
 fs.mkdirSync(destination,{recursive:true});
 if(publicRoot){
  for(const [file,schema]of [['compliance-coverage.json','numina.compliance-coverage.v1'],['country-readiness.json','numina.country-readiness.v1']]){
   const record=JSON.parse(fs.readFileSync(path.join(publicRoot,file),'utf8'));
   if(record.schema!==schema||record.identity!==NUMINA_LEGAL_DISCOVERY.identity||record.application_version!==NUMINA_LEGAL_DISCOVERY.applicationVersion||record.record_revision!==NUMINA_LEGAL_DISCOVERY.recordRevision)throw Error('Legal snapshot identity mismatch: '+file);
  }
  // These are current companion records, separate from historical signed artifacts.
  for(const file of snapshots)fs.copyFileSync(path.join(publicRoot,file),path.join(destination,file));
  const manifest={schema:'numina.legal-companion.v1',...NUMINA_LEGAL_DISCOVERY,distributionScope:'maintained_source_companion_not_installed_binary',legalApproval:false,installedBinaryCoverageVerified:false,snapshots:snapshots.map(file=>{const bytes=fs.readFileSync(path.join(destination,file));return {path:file,bytes:bytes.length,sha256:hash(bytes)};})};
  fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 }
 const manifest=JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'),'utf8'));
 if(manifest.schema!=='numina.legal-companion.v1'||manifest.recordRevision!==NUMINA_LEGAL_DISCOVERY.recordRevision||manifest.legalApproval!==false||manifest.financialActivation!==false||!Array.isArray(manifest.snapshots)||manifest.snapshots.length!==snapshots.length)throw Error('Invalid legal companion');
 for(const file of snapshots){
  const item=manifest.snapshots.find(row=>row.path===file),bytes=fs.readFileSync(path.join(destination,file));
  if(!item||item.sha256!==hash(bytes)||item.bytes!==bytes.length)throw Error('Legal companion byte mismatch: '+file);
 }
 return {manifest:'legal/manifest.json',schema:manifest.schema,identity:manifest.identity,recordRevision:manifest.recordRevision,coverage:manifest.coverage,coverageManifest:manifest.coverageManifest,countryReadiness:manifest.countryReadiness,financialActivation:false,legalApproval:false,sourceCompanion:true,installedBinaryCoverageVerified:false};
}
