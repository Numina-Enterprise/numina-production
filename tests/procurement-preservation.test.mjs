import {NUMINA_CANONICAL_TREASURY_VALUES,NUMINA_RECORDED_TREASURY_VALUES} from '../public/treasury-connection-model.js';
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
// Owner-reviewed d38d316 metadata-only successors. These exact pins are narrow
// exceptions, not a replacement for the immutable procurement baseline.
const approvedProjectionSources={
 'public/treasury-connection-model.js':'7c5f998e9212526044281e7d2a2f041a7601258aa46eeadb3e0bf00cc64fdf4b',
 'public/nusd-contract-record.js':'6fa9ad7a8a0ea4db03787393ded6bd6692f9479a83f50e7ecc6a0db5dba93caf',
 'src/stripe-treasury.js':'0252e04102de225fce0b2cbe50f53134d61fc1ff48fddcebcdd450c0a3823dec'
};
const approvedProjectionRecords={
 'public/business-core.json':'7ce2de625c6c0afde86f4e8f0811fca17050f333c7e8d49c2ea7e3b9048a49b2',
 'config/numina-architecture.json':'e80e7bedc9215c0a1c6f41c1602b3fc2134827379faf7d3e9522e5a6beea584e'
};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

// v147 authorizes these maintained package changes; retained financial and
// historical records still use the original immutable procurement baseline.
const approvedSecurityPackages={
 'node_modules/@adraffy/ens-normalize':{
  version:'1.11.1',
  resolved:'https://registry.npmjs.org/@adraffy/ens-normalize/-/ens-normalize-1.11.1.tgz',
  integrity:'sha512-nhCBV3quEgesuf7c7KYfperqSS14T8bYuvJ8PcLJp6znkZpFc0AuW4qBtr8eKVyPPe/8RSr7sglCWPU5eaxwKQ=='
 },
 'node_modules/ethers':{
  version:'6.17.0',
  resolved:'https://registry.npmjs.org/ethers/-/ethers-6.17.0.tgz',
  integrity:'sha512-BpyrpIPJ3ydEVow8zGaz1DuPS7YU8DcWxuBnY9a0UA/lvAPwrMr+EPXsfrul628SRaekPNeIM4UFh/91GWZang=='
 },
 'node_modules/ws':{
  version:'8.21.0',
  resolved:'https://registry.npmjs.org/ws/-/ws-8.21.0.tgz',
  integrity:'sha512-Vsp28b7DRcimFQvrqu2Wek3z1iYxDCWqHYB8Qsnk/S4RfaCQzPGPyBNuVjJV3cd6UiKtUtp6sNM77gWvzcCH+g=='
 }
};
function expectedMaintainedPackage(record,file,directory){
 const expected=structuredClone(record);
 expected.version='4.0.0';
 const root=file==='package-lock.json'?expected.packages['']:expected;
 root.version='4.0.0';root.license='BSD-3-Clause';
 (root.dependencies??root.devDependencies).ethers='6.17.0';
 if(directory==='runtime/nusd/development'){
  assert.equal(file,'package.json');
  delete root.devDependencies.ganache;root.devDependencies.hardhat='3.18.1';
  root.overrides={solc:{tmp:'0.2.7'}};
 }
 if(file==='package-lock.json'){
  for(const [path,approved]of Object.entries(approvedSecurityPackages))Object.assign(expected.packages[path],approved);
  expected.packages['node_modules/ethers'].dependencies['@adraffy/ens-normalize']='1.11.1';
  expected.packages['node_modules/ethers'].dependencies.ws='8.21.0';
 }
 return expected;
}
function removeForwardProvenanceFields(currentRecord,originalRecord){
 assert.deepEqual(currentRecord.activeProvenancePolicy,activeProvenancePolicy);
 delete currentRecord.activeProvenancePolicy;
 if(currentRecord.metadataAlignment)for(const key of Object.keys(activeProvenancePolicy)){
  if(!Object.hasOwn(originalRecord.metadataAlignment??{},key))delete currentRecord.metadataAlignment[key];
 }
}
test('procurement preserves immutable receipts and pins reviewed current-versus-dated metadata without erasing original values',async()=>{
 for(const p of ['public/treasury-connection-model.js','public/nusd-contract-record.js','src/native-treasury.js','src/treasury-alignment.js','src/stripe-treasury.js','src/treasury-evidence.js','runtime/nusd/mint-receipt.json','runtime/nusd/deployment-receipt.json','runtime/nusd/deployment-verification.json','runtime/nusd/treasury-settlement-receipt.json','runtime/nusd/treasury-settlement-receipt-validation.json','docs/nusd/treasury-settlement-receipt-validation.json','release-evidence/numina-singular-treasury-settlement-receipt-validation-2026-09-26.json']){
  if(Object.hasOwn(approvedProjectionSources,p))assert.equal(digest(current(p)),approvedProjectionSources[p],p+' reviewed projection-only source');
  else assert.deepEqual(current(p),original(p),p);
 }
 const historical=await import('data:text/javascript;base64,'+original('public/treasury-connection-model.js').toString('base64'));
 assert.deepEqual(NUMINA_RECORDED_TREASURY_VALUES,historical.NUMINA_CANONICAL_TREASURY_VALUES,'Entire original private treasury values are preserved');
 assert.deepEqual(NUMINA_CANONICAL_TREASURY_VALUES.observation,NUMINA_RECORDED_TREASURY_VALUES.observation);
 assert.equal(NUMINA_CANONICAL_TREASURY_VALUES.aggregate.current,null);
 for(const p of ['public/business-core.json','config/numina-architecture.json']){
  const a=json(original(p)),b=json(current(p));
  assert.equal(digest(current(p)),approvedProjectionRecords[p],p+' exact reviewed current metadata');
  assert.deepEqual(b.canonicalTreasuryValues.observation,a.canonicalTreasuryValues.observation,p+' retains private historical observation');
  assert.deepEqual(b.canonicalTreasuryValues,NUMINA_CANONICAL_TREASURY_VALUES,p);
 }

});
test('inventory repair preserves financial fields and permits only pinned v147 maintained package changes',()=>{
 for(const p of ['public/metadata-alignment.json','docs/Numina-Metadata-Alignment-v4.json']){
  const a=json(original(p)),b=json(current(p));const missing='release-evidence/numina-singular-treasury-settlement-validation-2026-09-26.json';
  const removed=a.retainedInventory.records.find(x=>x.path===missing);assert.equal(removed.sha256,'516f8aa968584603d88f607030ef10b8ca624b33be08fe123a50b63e2d6d2dad');assert.equal(fs.existsSync(new URL('../'+missing,import.meta.url)),false);
  a.retainedInventory.records=a.retainedInventory.records.filter(x=>x.path!==missing);
  for(const directory of ['runtime/nusd','runtime/nusd/development'])for(const file of ['package.json','package-lock.json']){
    const source=directory+'/'+file,old=json(original(source)),now=json(current(source));
    if(directory==='runtime/nusd/development'&&file==='package-lock.json'){
      // Reviewed replacement of archived Ganache by the isolated Hardhat test
      // engine, with the scoped solc tmp patch. Pin the entire reviewed lock;
      // unrelated package changes fail rather than receiving a broad exception.
      assert.equal(createHash('sha256').update(original(source)).digest('hex'),'6dc10bd224f0ac22ad52a427574cd612fde51cabda72b8e12c3e72dfe505bfac','Retained historical development lock');
      assert.equal(createHash('sha256').update(current(source)).digest('hex'),'6c89e27042f630a68c1d48d3fc8cf6f7d570b4a5945029ae8bb7eea3073b77eb',source);
      assert.equal(now.packages[''].devDependencies.hardhat,'3.18.1');
      assert.equal(now.packages[''].devDependencies.solc,old.packages[''].devDependencies.solc);
      assert.equal(now.packages[''].devDependencies['@openzeppelin/contracts'],old.packages[''].devDependencies['@openzeppelin/contracts']);
      assert.ok(!now.packages['node_modules/ganache']);
    }else assert.deepEqual(now,expectedMaintainedPackage(old,file,directory),'Only approved maintained version, license and security dependency pins may change: '+source);
    const record=a.retainedInventory.records.find(x=>x.path===source),bytes=current(source);
    record.bytes=bytes.length;record.sha256=createHash('sha256').update(bytes).digest('hex');
    record.originalBytesPreserved=false;record.scope='MAINTAINED_SOURCE_CONFIGURATION';
  }
  a.retainedInventory.recordCount=a.retainedInventory.records.length;
  a.currentTreasuryState=structuredClone(NUMINA_CANONICAL_TREASURY_VALUES.currentState);
  const frozen=['/final-build.json','/final-manifest.json','/current-environments.json'];
  assert.ok(frozen.every(path=>a.currentViews.includes(path)));
  a.currentViews=a.currentViews.filter(path=>!frozen.includes(path));
  a.frozenReleaseRecords=frozen;a.frozenReleaseRecordsAreCurrentState=false;
  removeForwardProvenanceFields(b,a);assert.deepEqual(b,a,p);
 }
});
test('published policy, schema and release aliases consistently disable automatic procurement',()=>{
 for(const file of ['release.json','application-release-v2.json','application-release-v3.json','application-release-v4.json']){const r=json(current('dist/client/downloads/'+file));assert.equal(r.procurement_usage,false);assert.equal(r.procurement.status,'DISABLED_BY_DEFAULT');assert.equal(r.procurement.automaticPurchasing,false);}
 assert.equal(json(current('public/schemas/application-release-v2.schema.json')).properties.procurement_usage.const,false);
 for(const p of ['procurement-policy.js','procurement-projection.js','schemas/procurement-evidence-v1.schema.json'])assert.deepEqual(current('dist/client/'+p),current('public/'+p));
});
