import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const json=path=>JSON.parse(read(path));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('historical inventory preserves original records and applies one current interpretation',()=>{
  const record=json('public/metadata-alignment.json');
  assert.equal(record.identity,'NUMINA');
  assert.equal(record.softwareSourceOfTruth,'NUMINA_NATIVE_TREASURY_JOURNAL');
  assert.equal(record.canonicalConstructorMint.blockNumber,'51725');
  assert.equal(record.canonicalConstructorMint.transactionHash,'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b');
  assert.equal(record.canonicalConstructorMint.amountNusd,'1500000000000000');
  assert.equal(record.canonicalConstructorMint.decimals,18);
  assert.equal(record.canonicalConstructorMint.settlementContractDeployment.blockNumber,'51726');
  assert.equal(record.journalObservation.observedRevision,142);
  assert.equal(record.journalObservation.baseUsdcTransferRequest,null);
  assert.equal(record.baseUsdcDestination.address,'0x736bd8f274dce00a8bb374edd85df0d2e631018e');
  assert.equal(record.baseUsdcDestination.network,'base');
  assert.equal(record.baseUsdcDestination.networkChainId,'8453');
  assert.equal(record.baseUsdcDestination.financialAccount,'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu');
  assert.equal(record.baseUsdcDestination.financialAddress,'finaddr_61VNd8JyhbqklVBhF16VNcN9EZSQiQliazWdBc8FkRw8');
  assert.equal(record.baseUsdcDestination.providerBindingVerifiedAtObservation,true);
  assert.equal(record.baseUsdcDestination.canonicalTokenContract,null);
  assert.equal(record.authorizedDepositIntent.status,'OWNER_AUTHORIZATION_RECORDED');
  assert.equal(record.authorizedDepositIntent.amountUsdc,null);
  assert.equal(record.authorizedDepositIntent.journalTransferRequest,null);
  assert.equal(record.authorizedDepositIntent.broadcast,false);
  assert.equal(record.authorizedDepositIntent.transactionHash,null);
  assert.deepEqual(record.executionEffects,{journalWrite:false,tokenIssuance:false,conversion:false,externalDeposit:false,reconciliation:false});
  const indexed=new Map(record.retainedInventory.records.map(item=>[item.path,item]));
  for(const path of ['runtime/nusd/mint-receipt.json','runtime/nusd/deployment-receipt.json','config/treasury-aggregate-settlement-1500t.v1.json']){
    const entry=indexed.get(path);
    assert.ok(entry,path);
    assert.equal(entry.sha256,digest(read(path)),path);
    assert.equal(entry.originalBytesPreserved,true,path);
    assert.equal(entry.currentBalanceOrReadinessInferred,false,path);
  }
  assert.deepEqual(json('docs/Numina-Metadata-Alignment-v4.json'),record);
});

test('built metadata and release aliases expose the same alignment record',()=>{
  const record=json('public/metadata-alignment.json');
  assert.deepEqual(json('dist/client/metadata-alignment.json'),record);
  assert.deepEqual(json('dist/client/source-alignment.json').metadataAlignment,record);
  for(const name of ['release.json','application-release-v2.json','application-release-v3.json','application-release-v4.json']){
    const release=json('dist/client/downloads/'+name);
    assert.equal(release.metadataAlignment,'/metadata-alignment.json',name);
    assert.equal(release.transfersEnabled,null,name);
    assert.equal(release.nusd_transaction_receipts.deployment.block_number,'51725',name);
    assert.equal(release.nusd_transaction_receipts.settlement.block_number,'51726',name);
    assert.deepEqual(release.baseUsdcDestination,record.baseUsdcDestination,name);
    assert.deepEqual(release.authorizedDepositIntent,record.authorizedDepositIntent,name);
  }
});

test('current views contain no live transfer or activation claim outside historical scope',()=>{
  function check(value,path=[],inheritedHistorical=false){
    if(!value||typeof value!=='object')return;
    const historical=inheritedHistorical||value.historicalRecord===true||path.some(part=>/^(historical|retained)/i.test(part));
    if(!historical){
      assert.notEqual(value.transfersEnabled,true,path.join('.')+': transfers');
      assert.notEqual(value.status,'FINAL_DEPLOYED_ACTIVE',path.join('.')+': activation');
      assert.notEqual(value.live,true,path.join('.')+': live');
      assert.notEqual(value.canonicalTreasuryValueStatus,'FINAL',path.join('.')+': treasury status');
    }
    for(const [key,item] of Object.entries(value))check(item,[...path,key],historical);
  }
  for(const path of ['public/business-core.json','public/final-build.json','public/final-manifest.json','public/current-environments.json','config/numina-architecture.json','dist/client/downloads/application-release-v4.json'])check(json(path),[path]);
});
