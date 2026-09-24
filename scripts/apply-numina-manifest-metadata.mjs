import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NUMINA_CANONICAL_TREASURY_VALUES as values,NUMINA_SINGULAR_SETTLEMENT_RECEIPT as receipt,NUMINA_TREASURY_CONNECTION as connection} from '../public/treasury-connection-model.js';

// Synchronize current metadata projections. Journal events, historical evidence,
// provider observations, signatures and artifact bytes are never rewritten.
const root=new URL('../',import.meta.url);
const check=process.argv.includes('--check');
if(process.argv.slice(2).some(arg=>arg!=='--check'))throw Error('Usage: node scripts/apply-numina-manifest-metadata.mjs [--check]');
const read=path=>readFileSync(new URL(path,root),'utf8');
const json=path=>JSON.parse(read(path));
const blob=bytes=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+Buffer.byteLength(bytes)+'\0'),Buffer.from(bytes)])).digest('hex');
const currentPaths=[
  'package.json',
  'config/numina-metadata-overrides.v1.json','config/numina-manifest.v2.json',
  'config/numina-architecture.json','config/treasury-aggregate-settlement-1500t.v1.json',
  'public/final-build.json','docs/NUMINA-FINAL-BUILD.json','public/business-core.json',
  'integrations/numina/package.json','integrations/numina/distribution.json',
  'integrations/numina/verification.json','integrations/numina/file-manifest.json',
  'runtime/nusd/policies/issuer-policy-1500t-18d.json'
];

const native=json('runtime/nusd/treasury-settlement-receipt.json');
for(const path of ['runtime/nusd/treasury-settlement-receipt.json','docs/nusd/treasury-settlement-receipt.json',receipt.path]){
  const record=json(path);
  assert.equal(record.id,receipt.id,path+' receipt ID');
  assert.equal(record.identity,'NUMINA',path+' identity');
  assert.equal(record.sourceOfRecord,receipt.sourceOfRecord,path+' source');
  assert.equal(record.singular,true,path+' singular');
  assert.equal(record.status,receipt.status,path+' status');
  assert.equal(record.final,true,path+' finality');
  assert.equal(record.submissionPerformed,receipt.submissionPerformed,path+' native submission');
  assert.equal(record.settlementPerformed,receipt.settlementPerformed,path+' native settlement');
  assert.deepEqual(record.aggregate,native.aggregate,path+' aggregate');
  assert.deepEqual(record.mintEvidence,native.mintEvidence,path+' mint evidence');
  assert.deepEqual(record.components,native.components,path+' holdings');
}
assert.equal(native.components.find(item=>item.settledUnit==='USDC').usdcAddress,connection.nativeLocationBindings.stripeUsdc.usdcAddress,'Canonical Stripe USDC deposit address');
assert.equal(values.status,'FINAL');
assert.equal(native.aggregate.amountNusd,values.aggregate.current);
assert.equal(native.components.length,3);
assert.equal(values.componentCount,3);
assert.equal(values.treasuryCount,1);
assert.equal(values.accountCount,1);
assert.equal(values.balanceCount,1);
assert.equal(values.mintStatus,'CONFIRMED');
assert.equal(native.mintEvidence.mintedNusd,values.mintedNusd);
assert.equal(native.mintEvidence.burnedNusd,values.burnedNusd);
assert.equal(native.mintEvidence.transactionHash,receipt.mintTransactionHash);
assert.equal(native.components.reduce((sum,item)=>sum+BigInt(item.amountNusd),0n).toString(),values.aggregate.current);
for(const item of native.components){
  assert.equal(item.settlementReceiptId,receipt.id);
  assert.equal(item.status,receipt.status);
  assert.equal(item.settledAmount,values.components[item.settledUnit].current);
}

const planned=new Map(),records=new Map();
function updateValues(value){
  if(Array.isArray(value)){value.forEach(updateValues);return;}
  if(!value||typeof value!=='object')return;
  for(const key of Object.keys(value)){
    if(key==='canonicalTreasuryValues')value[key]=structuredClone(values);
    else updateValues(value[key]);
  }
}
function serialize(path,value){
  const newline=read(path).includes('\r\n')?'\r\n':'\n';
  return (JSON.stringify(value,null,2)+'\n').replace(/\n/g,newline);
}
for(const path of currentPaths){
  const data=json(path);
  data.canonicalTreasuryValues=structuredClone(values);
  updateValues(data);
  records.set(path,data);
}
const override=records.get('config/numina-metadata-overrides.v1.json');
override.resolution.treasurySettlement=receipt.id;
override.canonicalSettlementAppliesTo='ALL_CURRENT_AND_CANONICAL_NUMINA_SOFTWARE_METADATA';
const finalBuild=records.get('public/final-build.json');
finalBuild.treasury.singularSettlementReceipt=structuredClone(receipt);
// This updates a native receipt projection, not an operation or provider balance.
const finalBytes=serialize('public/final-build.json',finalBuild);
planned.set('public/final-build.json',finalBytes);
planned.set('docs/NUMINA-FINAL-BUILD.json',finalBytes);
const packageData=records.get('package.json');
const previousPin=packageData.numina.finalBuildManifest.blob;
const finalPin=blob(finalBytes);
packageData.numina.finalBuildManifest.blob=finalPin;
for(const [path,data] of records){
  if(!planned.has(path))planned.set(path,serialize(path,data));
}
for(const path of ['scripts/build.mjs','scripts/package-github-release.mjs','.github/workflows/numina.yml']){
  const original=read(path);
  assert.ok(original.includes(previousPin)||original.includes(finalPin),path+' FINAL pin missing');
  planned.set(path,original.split(previousPin).join(finalPin).replace(/\r\n/g,'\n'));
}
const changed=[...planned].filter(([path,body])=>read(path)!==body);
if(check){
  console.log(JSON.stringify({identity:'NUMINA',receiptId:receipt.id,consistent:changed.length===0,staleFiles:changed.map(([path])=>path)}));
  if(changed.length)process.exitCode=1;
}else{
  for(const [path,body] of changed)writeFileSync(fileURLToPath(new URL(path,root)),body);
  console.log(JSON.stringify({identity:'NUMINA',receiptId:receipt.id,updatedFiles:changed.map(([path])=>path),finalBuildBlob:finalPin}));
}
