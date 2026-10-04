import {NUMINA_AUTHORIZED_BASE_USDC_DEPOSIT_INTENT as depositIntent,NUMINA_BASE_USDC_DESTINATION as destination,NUMINA_CANONICAL_TREASURY_VALUES as values,NUMINA_NATIVE_TREASURY_SYNC as native,NUMINA_OWNER_PROVIDED_BANK_DEPOSIT_ALIGNMENT as bankAlignment} from '../public/treasury-connection-model.js';

// Both release builders use this projection. Retained receipts remain byte-for-byte
// evidence; this wrapper states what their dated observations establish.
export function alignNusdReleaseMetadata(record){
  const mint=values.separateChainMintEvidence,settlement=mint.settlementContractDeployment;
  const observation={historicalRecord:true,observedAt:mint.observedAt,currentChainStateVerified:false};
  record.sourceOfTruth='NUMINA_NATIVE_TREASURY_JOURNAL';
  record.authoritativeCurrentTreasuryRoute=values.authoritativeCurrentRoute;
  record.currentTreasuryState=structuredClone(values.currentState);
  record.historicalJournalObservation=structuredClone(values.observation);
  record.metadataAlignment='/metadata-alignment.json';
  record.baseUsdcDestination=structuredClone(destination);
  record.authorizedDepositIntent=structuredClone(depositIntent);
  record.ownerProvidedBankDepositAlignment=structuredClone(bankAlignment);
  record.transfersEnabled=null;
  record.transferStateSource='CURRENT_CHAIN_STATE_UNVERIFIED';
  record.nusd_transaction_receipts={
    ...record.nusd_transaction_receipts,...observation,
    record_type:'retained_verified_deployment_receipts',
    expected_network:{name:'Numina',chain_id:mint.chainId},
    deployment:{...observation,status:'FINAL',record_type:'CONSTRUCTOR_MINT_AND_TOKEN_DEPLOYMENT',
      contract_address:mint.tokenAddress,transaction_hash:mint.transactionHash,
      block_number:mint.blockNumber,receipt_status:mint.receiptStatus,
      amount_nusd:mint.amountNusd,decimals:mint.decimals,base_units:mint.baseUnits,
      receipt:mint.download,verification:{status:'verified_at_observation',verified_at:mint.observedAt}},
    settlement:{...observation,status:'FINAL',record_type:'SETTLEMENT_CONTRACT_DEPLOYMENT',
      contract_address:settlement.contractAddress,transaction_hash:settlement.transactionHash,
      block_number:settlement.blockNumber,receipt_status:settlement.receiptStatus,
      provider_reference:null,receipt:mint.deploymentDownload,
      verification:{status:'verified_at_observation',verified_at:mint.observedAt},financial_settlement_verified:false},
    scope:'Retained NUMINA chain observations establish the constructor mint at block 51725 and separate settlement-contract deployment at block 51726. Current treasury state comes from the authenticated native journal; provider balances, conversion and external settlement require their own evidence.'
  };
  record.nusd_activation_readiness={
    ...record.nusd_activation_readiness,status:'CURRENT_OPERATIONAL_STATE_UNVERIFIED',
    current_status_source:'/api/nusd/v1/status',transfersEnabled:null,
    transferStateSource:'CURRENT_CHAIN_STATE_UNVERIFIED',currentPaused:null,currentChainStateVerified:false,
    historical_deployment_observation:{...observation,status:'DEPLOYED_PAUSED_AT_OBSERVATION',
      constructor_mint:structuredClone(mint),settlement_contract_deployment:structuredClone(settlement)},
    verified:[
      {id:'contract_identity',status:'verified_at_observation',observed_at:mint.observedAt,evidence:mint.deploymentDownload},
      {id:'execution_host',status:'verified_for_historical_deployment',observed_at:mint.observedAt,evidence:'/downloads/nusd/deployment-verification.json'},
      {id:'constructor_issuance',status:'verified_at_observation',observed_at:mint.observedAt,
        amount_nusd:mint.amountNusd,decimals:mint.decimals,block_number:mint.blockNumber,evidence:mint.download}
    ],
    purchasing_available:false,
    scope:'Constructor issuance and both contract deployments are retained confirmed observations. Current pause state, transfer readiness, reserves, conversion, redemption and provider deposits are not established by these historical records.'
  };
  record.scope={...record.scope,nusd_issuance_verified_in_current_state:false,contract_deployment_verified_in_current_state:false};
  if(record.native_treasury_alignment){
    Object.assign(record.native_treasury_alignment,{
      status:'CURRENT_STATE_UNAVAILABLE',verificationScope:'AUTHENTICATED_CURRENT_RECORD_REQUIRED',currentState:structuredClone(values.currentState),
      historicalJournalObservation:structuredClone(values.observation),
      aggregation:native.aggregation,modeledAllocationsAdditive:false,
      aggregateModeledValue:null,historicalAggregateModeledValue:native.historicalAggregateModeledValue,
      settlementStatus:values.settlementStatus,mintStatus:values.mintStatus,
      mintedNusd:values.mintedNusd,burnedNusd:values.burnedNusd,
      authoritativeCurrentRoute:values.authoritativeCurrentRoute
    });
  }
  return record;
}
