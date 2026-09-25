import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NUMINA_TREASURY_JOURNAL_OBSERVATION as observation} from '../public/treasury-connection-model.js';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root));
const json=path=>JSON.parse(read(path));
const currentFiles=[
  'package.json','config/numina-metadata-overrides.v1.json','config/numina-manifest.v2.json',
  'config/numina-architecture.json',
  'public/business-core.json','public/current-environments.json','public/final-build.json',
  'public/final-manifest.json','docs/NUMINA-FINAL-BUILD.json','docs/NUMINA-FINAL-MANIFEST.json',
  'integrations/numina/package.json','integrations/numina/distribution.json',
  'integrations/numina/verification.json','integrations/numina/file-manifest.json'
];

test('maintained metadata stays anchored to the dated journal observation, without provider balances',()=>{
  assert.equal(observation.observedRevision,142);
  assert.equal(observation.observedHead,'67b45a040374d944f42f26830c4a9142e26fa194d5149b7cfad2604aef351368');
  assert.equal(observation.snapshotIsLive,false);
  assert.deepEqual(observation.requests.map(request=>[request.kind,request.status,request.submission_performed,request.receipt]),[
    ['mint_request','PREPARED',false,null],['bank_transaction_request','PREPARED',false,null]
  ]);
  assert.equal(observation.requests[1].amount_minor,'50000000000000000');
  assert.equal(observation.baseUsdcTransferRequest,null);
  for(const path of currentFiles){
    const data=json(path);
    assert.deepEqual(data.treasuryJournalObservation,observation,`${path}: snapshot anchor`);
    assert.equal(data.authoritativeCurrentTreasuryRoute,'/api/control/v1/treasury',`${path}: live route`);
    const views=[];
    function visit(value){
      if(!value||typeof value!=='object')return;
      if(value.schema==='numina.canonical-treasury-values.v1')views.push(value);
      for(const child of Object.values(value))visit(child);
    }
    visit(data);
    assert.ok(views.length>0,`${path}: canonical values projection exists`);
    for(const view of views){
      assert.equal(view.status,'JOURNAL_SNAPSHOT',`${path}: dated scope`);
      assert.equal(view.canonical,false,`${path}: live source retained`);
      assert.deepEqual(view.observation,observation,`${path}: nested anchor`);
      assert.equal(view.components.USD.current,null,`${path}: USD current`);
      assert.equal(view.components.USD.available,null,`${path}: USD available`);
      assert.equal(view.components.USDC.current,null,`${path}: USDC current`);
      assert.equal(view.components.USDC.available,null,`${path}: USDC available`);
      assert.equal(view.components.NUSD.current,'500000000000000',`${path}: NUSD projection`);
      assert.equal(view.components.NUSD.available,null,`${path}: NUSD spendability`);
      assert.equal(view.settlementStatus,'UNVERIFIED',`${path}: current settlement`);
      assert.equal(view.settlementReceiptId,null,`${path}: current receipt`);
      assert.equal(view.historicalSettlementReceipt.historicalRecord,true,`${path}: retained receipt scope`);
    }
  }
  const build=json('public/final-build.json');
  assert.equal(build.nusd.status,'JOURNAL_SNAPSHOT');
  assert.equal(build.nusd.currentChainState,'UNVERIFIED');
  assert.equal(build.nusd.journalSubmissionPerformed,false);
  assert.equal(build.nusd.journalMintReceipt,null);
  assert.equal(build.nusd.mintedNusd,null);
  assert.equal(build.nusd.nativeBackingVerified,null);
  assert.equal(build.nusd.usdcConversion.backingVerified,null);
  assert.equal(build.nusd.usdRedemption.backingVerified,null);
  assert.equal(build.nusd.operatorActivation.currentChainActivityVerified,false);
  assert.equal(build.historicalNusdRelease.historicalRecord,true);
  assert.equal(build.historicalNusdRelease.currentJournalConfirmed,false);
  assert.equal(build.historicalNusdRelease.token.transactionHash,build.nusd.historicalChainMintEvidence.transactionHash);
});

test('retained mint and settlement evidence bytes are preserved',()=>{
  const baselines={
    'runtime/nusd/treasury-settlement-receipt.json':'36b9b9667b572d6edc759ed1237f62166e45b6193f5c53ddfcacd18048e24014',
    'docs/nusd/treasury-settlement-receipt.json':'b966343d78c20ff9d36b6f40d12fff29c8ace3b6a75ca760a66bb68d8d2ec0a9',
    'release-evidence/numina-singular-treasury-settlement-receipt-2026-09-19.json':'b966343d78c20ff9d36b6f40d12fff29c8ace3b6a75ca760a66bb68d8d2ec0a9',
    'runtime/nusd/mint-receipt.json':'3dab1a847ba8b0b4a14a92a0b881e5e888af7ffbbab74a9af0e1fe9935bc63ee',
    'runtime/nusd/settlement-receipt.json':'47a8494d6342ea9793c4d17d9925d46da7198e914a9fe87e128242dc4e3af9f4',
    'runtime/nusd/policies/issuer-policy-1500t-18d.json':'3215a97a723f5cdb5ef9d2acd9315274dbb3a301f8269960e93d9629955463ba',
    'config/treasury-aggregate-settlement-1500t.v1.json':'2f6ef7c485f21a37743230b8da8e9e317b009c4920226b3e44e42c678ae4e6e8'
  };
  for(const [path,expected] of Object.entries(baselines)){
    assert.equal(createHash('sha256').update(read(path)).digest('hex'),expected,path);
  }
});

test('packaged integration keeps current journal claims separate from dated chain evidence',()=>{
  for(const path of ['integrations/numina/verification.json','integrations/numina/distribution.json','integrations/numina/file-manifest.json']){
    const data=json(path),alignment=data.treasuryAlignment,contracts=data.nusdContracts;
    assert.deepEqual(data.treasuryJournalObservation,observation,`${path}: journal observation`);
    assert.equal(alignment.status,'JOURNAL_SNAPSHOT',`${path}: treasury status`);
    assert.equal(alignment.aggregateModeledValue,null,`${path}: current aggregate`);
    assert.equal(alignment.historicalAggregateModeledValue,'1500000000000000',`${path}: historical target`);
    assert.equal(alignment.submissionPerformed,false,`${path}: journal submission`);
    assert.equal(alignment.settlementReceiptId,null,`${path}: current settlement receipt`);
    assert.equal(alignment.historicalSettlementReceipt.currentJournalConfirmed,false,`${path}: historical receipt`);
    assert.equal(alignment.baseUsdcTransferRequest,null,`${path}: Base transfer request`);
    assert.equal(alignment.baseUsdcTransactionHash,null,`${path}: Base transaction hash`);
    assert.equal(contracts.journalMintStatus,'PREPARED',`${path}: journal mint`);
    assert.equal(contracts.journalMintReceipt,null,`${path}: journal mint receipt`);
    assert.equal(contracts.nativeBackingVerified,null,`${path}: current backing`);
    assert.equal(contracts.currentChainOperationalState,'UNVERIFIED',`${path}: current chain state`);
    assert.equal(contracts.historicalChainMintEvidence.historicalRecord,true,`${path}: chain mint scope`);
  }
  const verification=json('integrations/numina/verification.json');
  assert.equal(verification.nusdActivated,null);
  assert.equal(verification.mintPerformed,null);
  assert.equal(verification.journalMintPerformed,false);
  assert.equal(verification.transferPerformed,null);
  assert.equal(verification.baseUsdcTransferRecordedInJournal,false);
  assert.equal(verification.mintStatus,'PREPARED_IN_JOURNAL');
});
