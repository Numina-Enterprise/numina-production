import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('assembled server starts and serves the receipt-bound mint metadata without treasury access',async()=>{
  const {default:worker}=await import('../dist/server/index.js');
  const retainedMint=JSON.parse(readFileSync(new URL('../runtime/nusd/mint-receipt.json',import.meta.url)));
  const env={NUMINA_TELEMETRY_LOGS:'false',get DB(){throw Error('Unexpected treasury access');}};
  for(const path of ['/api/nusd/v1/mint-workflow','/api/nusd/v1/status']){
    const response=await worker.fetch(new Request('https://numina.test'+path),env);
    assert.equal(response.status,200,path);
    const body=await response.json();
    const evidence=body.execution?.constructorMintEvidence??body.asset_verification?.constructorMintEvidence;
    assert.equal(evidence.transactionHash,retainedMint.transactionHash,path);
    assert.equal(evidence.blockNumber,retainedMint.blockNumber,path);
    assert.equal(evidence.receiptStatus,retainedMint.receiptStatus,path);
    assert.equal(evidence.providerSettlementVerified,false,path);
  }
});

test('generated source alignment separates current treasury journal from dated NUSD chain issuance',()=>{
  const source=JSON.parse(readFileSync(new URL('../dist/client/source-alignment.json',import.meta.url)));
  const architecture=source.requiredArchitecture;
  assert.equal(source.singularSettlementReceipt,undefined);
  assert.equal(source.historicalSettlementReceipt.historicalRecord,true);
  assert.equal(source.historicalSettlementReceipt.currentJournalConfirmed,false);
  assert.deepEqual(architecture.treasury.canonicalValues,architecture.canonicalTreasuryValues);
  assert.deepEqual(architecture.numinaMetadata.canonicalTreasuryValues,architecture.canonicalTreasuryValues);
  assert.equal(architecture.canonicalTreasuryValues.status,'CURRENT_STATE_UNAVAILABLE');
  assert.equal(architecture.treasury.software_values.NUSD,null);
  assert.equal(architecture.treasury.software_values.USDC,null);
  assert.equal(architecture.treasury.software_values.USD,null);
  assert.equal(architecture.treasury.software_values.aggregateNUSD,null);
  assert.equal(architecture.treasury.aggregate_modeled_value,null);
  assert.equal(architecture.treasury.modeled_role_values_additive,false);
  assert.equal(architecture.treasury.software_transfer,null);
  assert.equal(architecture.treasury.historical_software_transfer,null);
  assert.equal(architecture.treasury.provider_verification,null);
  assert.equal(architecture.mint_event,null);
  assert.equal(architecture.mintStatus,'UNVERIFIED');
  assert.equal(architecture.mint_request,null);
  assert.equal(architecture.historical_mint_request,null);
  assert.equal(architecture.treasury.historicalJournalObservation,null);
  assert.equal(architecture.canonicalTreasuryValues.observation.snapshotIsLive,false);
  assert.equal(architecture.canonicalTreasuryValues.observation.observedRevision,142);
  assert.deepEqual(architecture.canonicalTreasuryValues.observation.requests,[]);
  assert.equal(architecture.canonicalTreasuryValues.observation.publicSummary,'/journal-summary.json');
  assert.equal(architecture.historical_mint_event.status,'HISTORICAL_CHAIN_RECEIPT');
  assert.equal(architecture.historical_mint_event.transaction_hash,'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b');
  const retainedMint=JSON.parse(readFileSync(new URL('../runtime/nusd/mint-receipt.json',import.meta.url)));
  assert.equal(architecture.historical_mint_event.block_number,retainedMint.blockNumber);
  assert.equal(architecture.historical_mint_event.receipt_status,retainedMint.receiptStatus);
  assert.equal(architecture.historical_mint_event.chain_id,retainedMint.chainId);
  assert.equal(architecture.historical_mint_event.amount_nusd,retainedMint.amountNusd);
  assert.equal(architecture.historical_mint_event.settlement_contract_deployment.blockNumber,'51726');
  assert.equal(architecture.historical_mint_event.historicalRecord,true);
  assert.equal(architecture.historical_mint_event.currentChainStateVerified,false);
  assert.equal(architecture.numinaMetadata.transfersEnabled,null);
  assert.equal(architecture.provider_verification,null);
  assert.equal(architecture.software_alignment,null);
  assert.equal(architecture.historical_software_alignment.currentJournalConfirmed,false);
});
