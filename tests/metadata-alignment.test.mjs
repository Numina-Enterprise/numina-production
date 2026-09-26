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
  assert.equal(record.baseUsdcDestination.canonicalTokenContract,'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.equal(record.baseUsdcDestination.canonicalTokenContractVerified,true);
  assert.equal(record.authorizedDepositIntent.status,'OWNER_AUTHORIZATION_RECORDED');
  assert.equal(record.authorizedDepositIntent.amountUsdc,'500000000000000.00');
  assert.equal(record.authorizedDepositIntent.sourceWallet,null);
  assert.deepEqual(record.authorizedDepositIntent.candidateSourceObservation,{
    schema:'numina.base.candidate-source-observation.v1',
    candidateAddress:'0x1a45671ae2ee3e52264116151924faacb80fc02e',
    candidateBasis:'/downloads/nusd/deployment-verification.json',
    candidateRole:'NUMINA_CHAIN_DEPLOYMENT_SENDER_NOT_CONFIRMED_BASE_SOURCE',
    rpcOrigin:'https://mainnet.base.org',chainId:'8453',blockNumber:'51830620',
    blockHash:'0x8e8c4b0f29b1486be1d484c2a0c7659cb9827b668d35e9a622d13824ed6a1a18',
    blockTimestamp:'2026-09-26T19:23:07.0000000Z',baseEthBalanceWei:'0',
    usdcContract:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',usdcBalanceBaseUnits:'0',
    transactionCount:'0',signerControlOnBaseVerified:false,balancesSufficient:false,readOnly:true
  });
  assert.deepEqual(record.authorizedDepositIntent.preparedJournalRequestSchema,{
    schema:'numina.treasury.usdc-transfer-request.v1',route:'/api/control/v1/treasury',
    implementationStatus:'IMPLEMENTED_NOT_COMMITTED',objective:'treasury.usdc.prepare',operation:'PREPARE_USDC_DEPOSIT',
    intentFields:['operation','amount','destinationReference','reason'],requestIdBinding:'event.id',
    revisionEffect:1,nativeNusdBalanceEffect:'UNCHANGED',
    output:{
      kind:'usdc_transfer_request',status:'PREPARED',destination_reference:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',
      destination_financial_account:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',destination_financial_address:'finaddr_61VNd8JyhbqklVBhF16VNcN9EZSQiQliazWdBc8FkRw8',destination_binding_verified:true,
      journal_idempotency_key:'$event.id',journal_replay_preconditions:['expectedRevision','expectedHead'],
      amount:'500000000000000',amount_base_units:'500000000000000000000',unit:'USDC',decimals:6,
      network:'Base',chain_id:8453,network_reference:'eip155:8453',token_address:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      source_wallet:null,signer_control_verified:false,source_usdc_balance:null,source_base_eth_gas_balance:null,
      execution_performed:false,broadcast_performed:false,submission_performed:false,transaction_hash:null,receipt:null,
      prerequisite_blockers:['SOURCE_WALLET_NOT_RECORDED','BASE_SIGNER_CONTROL_NOT_VERIFIED','SOURCE_USDC_BALANCE_NOT_VERIFIED','BASE_ETH_GAS_BALANCE_NOT_VERIFIED']
    }
  });
  assert.deepEqual(record.authorizedDepositIntent.blockingPrerequisites,[
    'CANONICAL_JOURNAL_TRANSFER_REQUEST','SOURCE_WALLET','SIGNER_CONTROL',
    'INSUFFICIENT_CANDIDATE_USDC_BALANCE','INSUFFICIENT_CANDIDATE_BASE_ETH_GAS_BALANCE',
    'IDEMPOTENCY_AND_REPLAY_STATE'
  ]);
  assert.equal(record.authorizedDepositIntent.journalTransferRequest,null);
  assert.equal(record.authorizedDepositIntent.broadcast,false);
  assert.equal(record.authorizedDepositIntent.transactionHash,null);
  assert.equal(record.aggregateModelPreparationSchema.implementationStatus,'IMPLEMENTED_NOT_COMMITTED');
  assert.equal(record.aggregateModelPreparationSchema.objective,'treasury.aggregate.prepare');
  assert.equal(record.aggregateModelPreparationSchema.operation,'PREPARE_AGGREGATE_MODEL');
  assert.equal(record.aggregateModelPreparationSchema.revisionEffect,1);
  assert.equal(record.aggregateModelPreparationSchema.nativeNusdBalanceEffect,'UNCHANGED');
  const aggregate=record.aggregateModelPreparationSchema.output;
  assert.equal(aggregate.status,'PREPARED_MODEL_ONLY');assert.equal(aggregate.authority,'NUMINA');assert.equal(aggregate.aggregate_amount,'1500000000000000');
  assert.deepEqual(aggregate.components.map(component=>[component.role,component.observation_scope,component.amount,component.unit]),[
    ['NATIVE_VALUE','RECEIPT_BACKED_ISSUANCE','500000000000000','NUSD'],
    ['DIGITAL_DOLLAR_ROUTE','PROVIDER_SCOPED_OBSERVATION','500000000000000','USDC'],
    ['BANK_ROUTE','NUMINA_SCOPED_OBSERVATION','500000000000000','USD']
  ]);
  const issuance=aggregate.components[0];
  assert.equal(issuance.constructor_mint_block,'51725');assert.equal(issuance.issuer_policy_hash,'0x2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5');
  assert.equal(issuance.policy_declaration_scope,'ISSUER_POLICY_DECLARATION_NOT_EXTERNAL_BACKING');assert.equal(issuance.externally_backed_claim,false);assert.equal(issuance.external_settlement_usdc,false);assert.equal(issuance.reserves_verified,false);
  assert.deepEqual(issuance.burn_observation,{block_number:'51749',scope:'DATED_DEPLOYMENT_VERIFICATION_OBSERVATION',constructor_issuance_base_units:'1500000000000000000000000000000000',total_supply_base_units:'1500000000000000000000000000000000',recipient_balance_base_units:'1500000000000000000000000000000000',burned_nusd:'0',burned_base_units:'0',current_chain_burn_state_verified:false});
  for(const field of ['external_balance_verified','external_provider_verification','external_backing_verified','external_funds_moved','execution_performed','broadcast_performed','submission_performed','settlement_performed'])assert.equal(aggregate[field],false);
  assert.equal(aggregate.transaction_hash,null);assert.equal(aggregate.receipt,null);assert.deepEqual(aggregate.reconciliation,{status:'PENDING_EVIDENCE',evidence_required:true});
  assert.equal(record.canonicalConstructorMint.deploymentVerificationBlock,'51749');assert.equal(record.canonicalConstructorMint.burnedNusdAtDeploymentVerification,'0');assert.equal(record.canonicalConstructorMint.burnedBaseUnitsAtDeploymentVerification,'0');assert.equal(record.canonicalConstructorMint.currentBurnStateVerified,false);
  assert.equal(record.canonicalConstructorMint.externallyBackedClaim,false);assert.equal(record.canonicalConstructorMint.externalSettlementUsdc,false);assert.equal(record.canonicalConstructorMint.reservesVerified,false);
  const bank=record.ownerProvidedBankDepositAlignment;
  assert.equal(bank.claimScope,'NUMINA_SCOPED_OBSERVATION');assert.equal(bank.assertedCleared,true);assert.equal(bank.assertedClearedDate,'2026-08-31');assert.equal(bank.assertedConfirmation,'8000750550');
  assert.equal(bank.routingReference,'073000176');assert.equal(bank.accountLast4,'3486');assert.equal(bank.fullAccountNumberPublished,false);
  assert.equal(bank.providerVerified,false);assert.equal(bank.clearedByProvider,null);assert.equal(bank.reservesVerified,false);assert.equal(bank.providerTransactionVerified,false);
  assert.equal(JSON.stringify(record).includes('445003163486'),false);
  assert.equal(record.ownerProvidedBankDepositAlignment.accountLast4,'3486');
  assert.equal(record.ownerProvidedBankDepositAlignment.fullAccountNumberPublished,false);
  assert.equal(record.ownerProvidedBankDepositAlignment.achRoutingNumber,'073000176');
  assert.equal(record.ownerProvidedBankDepositAlignment.confirmation,'8000750550');
  assert.equal(record.ownerProvidedBankDepositAlignment.amountUsd,'500000000000000.00');
  assert.equal(record.ownerProvidedBankDepositAlignment.providerTransactionVerified,false);
  assert.doesNotMatch(JSON.stringify(record),/445003163486/);
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
    assert.deepEqual(release.ownerProvidedBankDepositAlignment,record.ownerProvidedBankDepositAlignment,name);
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
