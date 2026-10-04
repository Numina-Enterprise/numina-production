import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {NUMINA_CANONICAL_TREASURY_VALUES as values,NUMINA_TREASURY_JOURNAL_OBSERVATION as observation} from '../public/treasury-connection-model.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const activePaths=[
  'package.json','config/numina-metadata-overrides.v1.json','config/numina-manifest.v2.json',
  'config/numina-architecture.json','public/business-core.json','public/current-environments.json','integrations/numina/package.json',
  'integrations/numina/distribution.json','integrations/numina/verification.json','integrations/numina/file-manifest.json'
];
const preservedPaths=[
  'config/active-provenance-policy.v1.json','public/treasury-connection-model.js',
  'public/final-build.json','docs/NUMINA-FINAL-BUILD.json',
  'mobile/signing/release-identities.json','src/native-treasury-model.js','src/bank-route-model.js',
  'public/treasury-proof.js','runtime/nusd/mint-receipt.json','runtime/nusd/deployment-receipt.json',
  'runtime/nusd/treasury-settlement-receipt.json','docs/nusd/treasury-settlement-receipt.json',
  'release-evidence/numina-singular-treasury-settlement-receipt-2026-09-19.json',
  'runtime/nusd/treasury-settlement-receipt-validation.json','docs/nusd/treasury-settlement-receipt-validation.json',
  'release-evidence/numina-singular-treasury-settlement-receipt-validation-2026-09-26.json'
];
function fixture(t){
  const work=path.join(root,'work');fs.mkdirSync(work,{recursive:true});
  const dir=fs.mkdtempSync(path.join(work,'metadata-scope-test-'));
  t.after(()=>{
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(work));
    assert.ok(path.basename(dir).startsWith('metadata-scope-test-'));
    fs.rmSync(dir,{recursive:true});
  });
  const write=(name,bytes)=>{const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);};
  for(const name of ['scripts/apply-numina-manifest-metadata.mjs',...preservedPaths])write(name,fs.readFileSync(path.join(root,name)));
  const stale={schema:values.schema,status:'FINAL',canonical:true,components:{
    USD:{unit:'USD',current:'500000000000000',available:'500000000000000'},
    USDC:{unit:'USDC',current:'500000000000000',available:'500000000000000'},
    NUSD:{unit:'NUSD',current:'500000000000000',available:'500000000000000'}
  },aggregate:{unit:'NUSD',current:'1500000000000000'}};
  for(const name of activePaths)write(name,JSON.stringify({
    name:'isolated-metadata-fixture',type:'module',version:'4.0.0',mechanics:{repository:{},build_model:{}},
    canonicalTreasuryValues:stale,transfersEnabled:true,provider_verification:false,
    numina:{canonicalTreasuryValues:stale,transfersEnabled:true,provider_verification:false},
    bankProviderObservation:{providerBalanceVerified:false,providerTransactionVerified:false,externalSettlementVerified:false,providerBalancesChanged:false},
    historicalReceipt:{historicalRecord:true,status:'SETTLED',provider_verification:true},
    resolution:{treasurySettlement:'historical-receipt'},treasury:{}
  },null,2)+'\n');
  const bytes=names=>new Map(names.map(name=>[name,fs.readFileSync(path.join(dir,name))]));
  const unchanged=snapshot=>{for(const [name,before] of snapshot)assert.ok(fs.readFileSync(path.join(dir,name)).equals(before),name+' bytes changed');};
  const run=(...args)=>spawnSync(process.execPath,[path.join(dir,'scripts/apply-numina-manifest-metadata.mjs'),...args],{cwd:dir,encoding:'utf8',timeout:10000});
  const json=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  return {dir,write,bytes,unchanged,run,json};
}

test('metadata synchronization updates active snapshots without rewriting financial evidence or source modules',t=>{
  const f=fixture(t),protectedBytes=f.bytes(preservedPaths),initialBytes=f.bytes(activePaths);
  const staleCheck=f.run('--check');assert.equal(staleCheck.status,1,staleCheck.stderr);
  assert.ok(staleCheck.stdout,staleCheck.stderr);assert.equal(JSON.parse(staleCheck.stdout).consistent,false);
  f.unchanged(initialBytes);f.unchanged(protectedBytes);
  const update=f.run();assert.equal(update.status,0,update.stderr);
  const report=JSON.parse(update.stdout);
  assert.deepEqual(report.updatedFiles,activePaths);assert.equal(report.providerExecutionPerformed,false);
  for(const name of activePaths){
    const record=f.json(name);
    assert.deepEqual(record.canonicalTreasuryValues,values,name);
    assert.deepEqual(record.numina.canonicalTreasuryValues,values,name+' nested values');
    assert.deepEqual(record.treasuryJournalObservation,observation,name+' observation');
    assert.equal(record.authoritativeCurrentTreasuryRoute,'/api/control/v1/treasury');
    assert.equal(record.transfersEnabled,null);assert.equal(record.provider_verification,null);
    assert.equal(record.numina.transfersEnabled,null);assert.equal(record.numina.provider_verification,null);
    assert.deepEqual(record.bankProviderObservation,{providerBalanceVerified:false,providerTransactionVerified:false,externalSettlementVerified:false,providerBalancesChanged:false});
    assert.equal(record.metadataAlignment.ownerProvidedBankDepositAlignment.providerBalanceVerified,false);
    assert.equal(record.metadataAlignment.ownerProvidedBankDepositAlignment.providerTransactionVerified,false);
    assert.equal(record.metadataAlignment.externalProviderVerificationPromoted,false);
    assert.deepEqual(record.historicalReceipt,{historicalRecord:true,status:'SETTLED',provider_verification:true});
  }
  f.unchanged(protectedBytes);
  const synchronized=f.bytes(activePaths),again=f.run();assert.equal(again.status,0,again.stderr);
  assert.deepEqual(JSON.parse(again.stdout).updatedFiles,[]);
  const currentCheck=f.run('--check');assert.equal(currentCheck.status,0,currentCheck.stderr);
  assert.equal(JSON.parse(currentCheck.stdout).consistent,true);
  f.unchanged(synchronized);f.unchanged(protectedBytes);
});

test('a contradictory constructor receipt rejects synchronization before any metadata write',t=>{
  const f=fixture(t),mint=f.json('runtime/nusd/mint-receipt.json');
  mint.decimals=6;f.write('runtime/nusd/mint-receipt.json',JSON.stringify(mint)+'\n');
  const before=f.bytes([...activePaths,...preservedPaths]),result=f.run();
  assert.notEqual(result.status,0);assert.match(result.stderr,/Constructor mint decimals/);
  f.unchanged(before);
});
