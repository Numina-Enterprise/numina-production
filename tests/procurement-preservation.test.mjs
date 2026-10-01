import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base='f74582f1ebd8a0d5543093e640cb7198330c11ea';
const original=p=>execFileSync('git',['show',base+':'+p],{maxBuffer:16*1024*1024});
const current=p=>fs.readFileSync(new URL('../'+p,import.meta.url));
const json=b=>JSON.parse(b);
const activeProvenancePolicy=json(current('config/active-provenance-policy.v1.json'));
function removeForwardProvenanceFields(currentRecord,originalRecord){
 assert.deepEqual(currentRecord.activeProvenancePolicy,activeProvenancePolicy);
 delete currentRecord.activeProvenancePolicy;
 if(currentRecord.metadataAlignment)for(const key of Object.keys(activeProvenancePolicy)){
  if(!Object.hasOwn(originalRecord.metadataAlignment??{},key))delete currentRecord.metadataAlignment[key];
 }
}
test('procurement repair preserves treasury sources, contracts, receipts and financial values byte for byte',()=>{
 for(const p of ['public/treasury-connection-model.js','public/nusd-contract-record.js','src/native-treasury.js','src/treasury-alignment.js','src/stripe-treasury.js','src/treasury-evidence.js','runtime/nusd/mint-receipt.json','runtime/nusd/deployment-receipt.json','runtime/nusd/deployment-verification.json','runtime/nusd/treasury-settlement-receipt.json','runtime/nusd/treasury-settlement-receipt-validation.json','docs/nusd/treasury-settlement-receipt-validation.json','release-evidence/numina-singular-treasury-settlement-receipt-validation-2026-09-26.json'])assert.deepEqual(current(p),original(p),p);
 for(const p of ['public/business-core.json','config/numina-architecture.json']){
  const a=json(original(p)),b=json(current(p));delete a.procurement_usage;delete b.procurement_usage;delete a.procurementAuthorization;delete b.procurementAuthorization;removeForwardProvenanceFields(b,a);assert.deepEqual(b,a,p);
 }
});
test('inventory repair preserves financial fields and tracks version-only changes to maintained packages',()=>{
 for(const p of ['public/metadata-alignment.json','docs/Numina-Metadata-Alignment-v4.json']){
  const a=json(original(p)),b=json(current(p));const missing='release-evidence/numina-singular-treasury-settlement-validation-2026-09-26.json';
  const removed=a.retainedInventory.records.find(x=>x.path===missing);assert.equal(removed.sha256,'516f8aa968584603d88f607030ef10b8ca624b33be08fe123a50b63e2d6d2dad');assert.equal(fs.existsSync(new URL('../'+missing,import.meta.url)),false);
  a.retainedInventory.records=a.retainedInventory.records.filter(x=>x.path!==missing);
  for(const directory of ['runtime/nusd','runtime/nusd/development'])for(const file of ['package.json','package-lock.json']){
    const source=directory+'/'+file,old=json(original(source)),now=json(current(source));
    old.version='4.0.0';if(file==='package-lock.json')old.packages[''].version='4.0.0';
    assert.deepEqual(now,old,'Only maintained package version identities may change: '+source);
    const record=a.retainedInventory.records.find(x=>x.path===source),bytes=current(source);
    record.bytes=bytes.length;record.sha256=createHash('sha256').update(bytes).digest('hex');
  }
  a.retainedInventory.recordCount=a.retainedInventory.records.length;removeForwardProvenanceFields(b,a);assert.deepEqual(b,a,p);
 }
});
test('published policy, schema and release aliases consistently disable automatic procurement',()=>{
 for(const file of ['release.json','application-release-v2.json','application-release-v3.json','application-release-v4.json']){const r=json(current('dist/client/downloads/'+file));assert.equal(r.procurement_usage,false);assert.equal(r.procurement.status,'DISABLED_BY_DEFAULT');assert.equal(r.procurement.automaticPurchasing,false);}
 assert.equal(json(current('public/schemas/application-release-v2.schema.json')).properties.procurement_usage.const,false);
 for(const p of ['procurement-policy.js','procurement-projection.js','schemas/procurement-evidence-v1.schema.json'])assert.deepEqual(current('dist/client/'+p),current('public/'+p));
});
