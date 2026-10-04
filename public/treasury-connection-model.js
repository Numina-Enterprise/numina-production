// The authenticated native treasury journal is the software source of truth.
// Static allocations and dated receipts below are retained model/evidence records, not live balances or submissions.
export const NUMINA_OWNER_EXECUTION_AUTHORITY = Object.freeze({
  schema:'numina.owner-execution-authority.v1',
  principal:'OWNER',softwareAuthority:'NUMINA',
  initiator:'OWNER',authorizer:'OWNER',executor:'OWNER',
  externalEvidenceSource:'OWNER_ATTESTATION',externalAttestor:'OWNER',thirdParty:'OWNER',
  thirdPartyIndependent:false,evidenceProvenance:'OWNER_ATTESTED_EXTERNAL_EVIDENCE',
  independentThirdPartyVerification:false,independentProviderVerification:false,
  externalExecutionRequiresOwnerAction:true
});
export const NUMINA_SINGULAR_SETTLEMENT_RECEIPT=Object.freeze({schema:'numina.treasury.settlement-receipt-validation.v1',id:'numina:treasury:settlement-validation:2026-09-26:v1',validatedReceiptId:'numina:treasury:settlement:2026-09-19:v1',identity:'NUMINA',treasuryIdentity:'NUMINA',sourceOfRecord:'NUMINA_NATIVE_TREASURY',singular:true,final:true,historicalRecord:false,currentJournalConfirmed:false,status:'NOT_SETTLED',classification:'NUMINA_VERIFIED_ASSERTION',assertionVerifiedBy:'NUMINA',journalAuthenticated:false,executionVerified:false,settlementVerified:false,path:'release-evidence/numina-singular-treasury-settlement-receipt-validation-2026-09-26.json',download:'/downloads/nusd/treasury-settlement-receipt-validation.json',historicalReceiptPath:'release-evidence/numina-singular-treasury-settlement-receipt-2026-09-19.json',historicalReceiptDownload:'/downloads/nusd/treasury-settlement-receipt.json',mintReceipt:'runtime/nusd/mint-receipt.json',mintTransactionHash:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',mintEvidenceScope:'NUSD_CONSTRUCTOR_MINT_ONLY',mintBlockNumber:'51725',burnedNusdAtDeploymentObservation:'0',burnObservationBlock:'51749',currentBurnStateVerified:false,authorization:Object.freeze({executionAuthorized:true,settlementAuthorized:true,journalAppendAuthorized:true,authorizedBy:'NUMINA'}),submissionPerformed:false,externalProviderSubmissionPerformed:false,settlementPerformed:false,broadcastPerformed:false,reconciliationPerformed:false,externalFundsMoved:false,providerSettlementVerified:false,externalProviderSettlementVerified:false,externalBackingVerified:false,reservesVerified:false,transactionHash:null,providerReceipt:null,stripeCredit:null,bankReceipt:null,aggregateNusd:'1500000000000000',componentCount:3});
export const NUMINA_TREASURY_JOURNAL_OBSERVATION=Object.freeze({
  schema:'numina.treasury.journal-observation.v1',sourceOfRecord:'NUMINA_NATIVE_TREASURY',
  asOfDate:'2026-09-25',observedRevision:142,
  observedHead:'67b45a040374d944f42f26830c4a9142e26fa194d5149b7cfad2604aef351368',
  authoritativeCurrentRoute:'/api/control/v1/treasury',snapshotIsLive:false,
  projection:Object.freeze({balance:'500000000000000',unit:'NUSD'}),
  requests:Object.freeze([
    Object.freeze({kind:'mint_request',amount:'1500000000000000',unit:'NUSD',status:'PREPARED',submission_performed:false,receipt:null}),
    Object.freeze({kind:'bank_transaction_request',amount_minor:'50000000000000000',currency:'USD',status:'PREPARED',submission_performed:false,receipt:null})
  ]),
  baseUsdcTransferRequest:null,baseUsdcTransactionHash:null,providerReceipt:null,
  externalProviderSubmissionStatus:'UNVERIFIED',externalProviderSettlementStatus:'UNVERIFIED'
});
export const NUMINA_BASE_USDC_DESTINATION=Object.freeze({
  schema:'numina.base-usdc.destination.v1',treasuryIdentity:'NUMINA',transportProvider:'Stripe',
  stripeAccount:'acct_1UEEPnQdJat0efmT',
  financialAccount:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',
  financialAddress:'finaddr_61VNd8JyhbqklVBhF16VNcN9EZSQiQliazWdBc8FkRw8',
  currency:'USDC',settlementCurrency:'USDC',
  address:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',
  network:'base',networkChainId:'8453',statusAtObservation:'active',observedDate:'2026-09-26',
  providerBindingVerifiedAtObservation:true,providerBalanceAtObservation:'0',
  providerInboundPendingAtObservation:'0',providerReceivedCreditsAtObservation:0,
  canonicalTokenContract:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',canonicalTokenContractVerified:true,
  canonicalTokenContractVerificationSource:'https://developers.circle.com/stablecoins/usdc-contract-addresses',
  observationScope:'AUTHENTICATED_PROVIDER_DESTINATION_AND_ZERO_BALANCE_OBSERVATION'
});
export const NUMINA_BASE_USDC_PREPARED_REQUEST_SCHEMA=Object.freeze({
  schema:'numina.treasury.usdc-transfer-request.v1',route:'/api/control/v1/treasury',
  implementationStatus:'IMPLEMENTED_NOT_COMMITTED',objective:'treasury.usdc.prepare',operation:'PREPARE_USDC_DEPOSIT',
  intentFields:Object.freeze(['operation','amount','destinationReference','reason']),requestIdBinding:'event.id',
  revisionEffect:1,nativeNusdBalanceEffect:'UNCHANGED',
  output:Object.freeze({
    kind:'usdc_transfer_request',status:'PREPARED',destination_reference:NUMINA_BASE_USDC_DESTINATION.address,
    destination_financial_account:NUMINA_BASE_USDC_DESTINATION.financialAccount,destination_financial_address:NUMINA_BASE_USDC_DESTINATION.financialAddress,destination_binding_verified:true,
    journal_idempotency_key:'$event.id',journal_replay_preconditions:Object.freeze(['expectedRevision','expectedHead']),
    amount:'500000000000000',amount_base_units:'500000000000000000000',unit:'USDC',decimals:6,
    network:'Base',chain_id:8453,network_reference:'eip155:8453',token_address:NUMINA_BASE_USDC_DESTINATION.canonicalTokenContract,
    source_wallet:null,signer_control_verified:false,source_usdc_balance:null,source_base_eth_gas_balance:null,
    execution_performed:false,broadcast_performed:false,submission_performed:false,transaction_hash:null,receipt:null,
    prerequisite_blockers:Object.freeze(['SOURCE_WALLET_NOT_RECORDED','BASE_SIGNER_CONTROL_NOT_VERIFIED','SOURCE_USDC_BALANCE_NOT_VERIFIED','BASE_ETH_GAS_BALANCE_NOT_VERIFIED'])
  })
});
export const NUMINA_AGGREGATE_MODEL_PREPARED_REQUEST_SCHEMA=Object.freeze({
  schema:'numina.treasury.aggregate-model-request.v1',route:'/api/control/v1/treasury',
  implementationStatus:'IMPLEMENTED_NOT_COMMITTED',objective:'treasury.aggregate.prepare',operation:'PREPARE_AGGREGATE_MODEL',
  intentFields:Object.freeze(['operation','aggregateAmount','bankAmount','stripeAmount','nativeAmount','reason']),requestIdBinding:'event.id',
  revisionEffect:1,nativeNusdBalanceEffect:'UNCHANGED',
  output:Object.freeze({
    kind:'aggregate_model_request',status:'PREPARED_MODEL_ONLY',authority:'NUMINA',
    owner_approval:Object.freeze({status:'OWNER_APPROVAL_RECORDED',reference:'/owner-approval.js'}),
    aggregate_amount:'1500000000000000',aggregation:'SUM_OF_SEPARATE_ROLE_AMOUNTS',
    components:Object.freeze([
      Object.freeze({
        id:'native-nusd',role:'NATIVE_VALUE',observation_scope:'RECEIPT_BACKED_ISSUANCE',source:'NUMINA_CONSTRUCTOR_MINT_RECEIPT',
        amount:'500000000000000',unit:'NUSD',status:'PREPARED_MODEL_ONLY',
        evidence_references:Object.freeze(['/downloads/nusd/mint-receipt.json','/downloads/nusd/deployment-verification.json']),
        constructor_mint_block:'51725',constructor_mint_transaction:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',
        denomination_policy_declaration:'1 NUSD = 1 USDC = 1 USD',issuer_policy_hash:'0x2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5',
        issuer_policy_approval_reference:'/owner-approval.js',policy_declaration_scope:'ISSUER_POLICY_DECLARATION_NOT_EXTERNAL_BACKING',
        burn_observation:Object.freeze({block_number:'51749',scope:'DATED_DEPLOYMENT_VERIFICATION_OBSERVATION',constructor_issuance_base_units:'1500000000000000000000000000000000',total_supply_base_units:'1500000000000000000000000000000000',recipient_balance_base_units:'1500000000000000000000000000000000',burned_nusd:'0',burned_base_units:'0',current_chain_burn_state_verified:false}),
        externally_backed_claim:false,external_settlement_usdc:false,reserves_verified:false,external_reserve_verified:false
      }),
      Object.freeze({id:'stripe-usdc',role:'DIGITAL_DOLLAR_ROUTE',observation_scope:'PROVIDER_SCOPED_OBSERVATION',source:'STRIPE_DESTINATION_OBSERVATION',amount:'500000000000000',unit:'USDC',status:'PREPARED_MODEL_ONLY',evidence_references:Object.freeze(['/api/control/v2/treasury/provider-routes','/metadata-alignment.json']),provider_balance_verified:false,provider_transaction_verified:false}),
      Object.freeze({id:'bank-usd',role:'BANK_ROUTE',observation_scope:'NUMINA_SCOPED_OBSERVATION',source:'OWNER_PROVIDED_BANK_ALIGNMENT',amount:'500000000000000',unit:'USD',status:'PREPARED_MODEL_ONLY',evidence_references:Object.freeze(['/api/control/v2/treasury/accounts','/downloads/Provider-Confirmation-Request-v4.md']),provider_balance_verified:false,provider_transaction_verified:false})
    ]),
    external_balance_verified:false,external_provider_verification:false,external_backing_verified:false,external_funds_moved:false,
    execution_performed:false,broadcast_performed:false,submission_performed:false,settlement_performed:false,
    transaction_hash:null,receipt:null,reconciliation:Object.freeze({status:'PENDING_EVIDENCE',evidence_required:true})
  })
});
export const NUMINA_AUTHORIZED_BASE_USDC_DEPOSIT_INTENT=Object.freeze({
  schema:'numina.treasury.deposit-intent.v1',treasuryIdentity:'NUMINA',
  status:'OWNER_AUTHORIZATION_RECORDED',authorizationDate:'2026-09-26',
  sourceOfAuthorization:'OWNER_INSTRUCTION',journalStatus:'NOT_RECORDED',
  currency:'USDC',network:'base',networkChainId:'8453',
  destination:NUMINA_BASE_USDC_DESTINATION.address,
  destinationFinancialAccount:NUMINA_BASE_USDC_DESTINATION.financialAccount,
  destinationBindingVerified:true,amountUsdc:'500000000000000.00',amountSource:'OWNER_INSTRUCTION',
  sourceWallet:null,canonicalTokenContract:NUMINA_BASE_USDC_DESTINATION.canonicalTokenContract,
  canonicalTokenContractVerified:NUMINA_BASE_USDC_DESTINATION.canonicalTokenContractVerified,
  sourceUsdcBalance:null,sourceBaseEthGasBalance:null,signerControlVerified:false,
  candidateSourceObservation:Object.freeze({
    schema:'numina.base.candidate-source-observation.v1',
    candidateAddress:'0x1a45671ae2ee3e52264116151924faacb80fc02e',
    candidateBasis:'/downloads/nusd/deployment-verification.json',
    candidateRole:'NUMINA_CHAIN_DEPLOYMENT_SENDER_NOT_CONFIRMED_BASE_SOURCE',
    rpcOrigin:'https://mainnet.base.org',chainId:'8453',blockNumber:'51830620',
    blockHash:'0x8e8c4b0f29b1486be1d484c2a0c7659cb9827b668d35e9a622d13824ed6a1a18',
    blockTimestamp:'2026-09-26T19:23:07.0000000Z',baseEthBalanceWei:'0',
    usdcContract:NUMINA_BASE_USDC_DESTINATION.canonicalTokenContract,usdcBalanceBaseUnits:'0',
    transactionCount:'0',signerControlOnBaseVerified:false,balancesSufficient:false,readOnly:true
  }),
  preparedJournalRequestSchema:NUMINA_BASE_USDC_PREPARED_REQUEST_SCHEMA,
  journalTransferRequest:null,idempotencyVerified:false,replayProtectionVerified:false,
  submissionPerformed:false,broadcast:false,transactionHash:null,onchainReceipt:null,
  providerCredit:null,reconciliation:null,
  blockingPrerequisites:Object.freeze(['CANONICAL_JOURNAL_TRANSFER_REQUEST','SOURCE_WALLET','SIGNER_CONTROL','INSUFFICIENT_CANDIDATE_USDC_BALANCE','INSUFFICIENT_CANDIDATE_BASE_ETH_GAS_BALANCE','IDEMPOTENCY_AND_REPLAY_STATE']),
  executionDecision:'NOT_BROADCAST_MISSING_LIVE_PREREQUISITES'
});
export const NUMINA_OWNER_PROVIDED_BANK_DEPOSIT_ALIGNMENT=Object.freeze({
  schema:'numina.treasury.bank-deposit-alignment.v1',treasuryIdentity:'NUMINA',
  status:'OWNER_CLAIM_RECORDED_PROVIDER_CONFIRMATION_REQUIRED',recordedDate:'2026-09-26',
  sourceOfStatement:'OWNER_INSTRUCTION',claimScope:'NUMINA_SCOPED_OBSERVATION',institution:'Bank of America',accountLast4:'3486',
  fullAccountNumberPublished:false,achRoutingNumber:'073000176',routingReference:'073000176',confirmation:'8000750550',
  clearedDate:'2026-08-31',assertedCleared:true,assertedClearedDate:'2026-08-31',assertedConfirmation:'8000750550',amountUsd:'500000000000000.00',
  linkedBaseUsdcIntentAmount:NUMINA_AUTHORIZED_BASE_USDC_DEPOSIT_INTENT.amountUsdc,
  assetConversionVerified:false,providerVerified:false,clearedByProvider:null,reservesVerified:false,providerBalanceVerified:false,providerTransactionVerified:false,
  externalFundsMovementVerified:false,externalSettlementVerified:false,
  retainedProviderObservation:Object.freeze({transactionAmountUsd:'12.00',confirmation:'XXXXX50550',clearedDate:'2026-08-31',amountMatchesOwnerClaim:false,confirmationMatchesOwnerClaim:false}),
  evidenceRequired:'/downloads/Provider-Confirmation-Request-v4.md'
});
// Consume only a projection already authenticated by the journal reader. This helper
// does not turn a dated file or a prepared request into a current settlement.
export function journalTreasuryMetadata(projection){
  const requests=Array.isArray(projection?.transaction_requests)?projection.transaction_requests:[];
  const settlement=[...requests].reverse().find(request=>
    request?.kind==='aggregate_settlement'&&request.status==='SETTLED'&&
    request.settlement===true&&request.submission_performed===true&&request.settlement_performed===true&&
    request.id===projection?.last_event_id&&
    request.unit===projection?.unit&&
    request.components?.find(component=>component.id==='native-retained')?.settled_amount===projection?.balance&&
    typeof request.receipt?.id==='string'&&typeof request.receipt?.path==='string'
  );
  return {
    sourceOfRecord:'NUMINA_NATIVE_TREASURY',
    journalProjectionBalance:typeof projection?.balance==='string'?projection.balance:null,
    journalProjectionUnit:projection?.unit==='NUSD'?'NUSD':null,
    settlementStatus:settlement?'SETTLED':'UNVERIFIED',
    submissionPerformed:Boolean(settlement),settlementPerformed:Boolean(settlement),
    singularSettlementReceiptId:settlement?.receipt.id??null,
    singularSettlementReceipt:settlement?.receipt.path??null,
    mintEvidence:settlement?.receipt.mint_receipt??null,
    nativeBackingAttestationId:settlement?.receipt.native_backing_attestation_id??null,
    aggregateModeledValue:settlement?.aggregate_amount??null,
    aggregateModeledUnit:settlement?'NUSD':null,
    externalProviderSubmissionPerformed:null,
    externalProviderSettlementVerified:null,
    externalProviderSubmissionStatus:'UNVERIFIED',
    externalProviderSettlementStatus:'UNVERIFIED'
  };
}
// Retain the prior projection verbatim as dated evidence. Current views below
// cannot promote snapshotIsLive:false into a current balance or mint request.
export const NUMINA_RECORDED_TREASURY_VALUES = Object.freeze({
  schema:'numina.canonical-treasury-values.v1',identity:'NUMINA',sourceOfRecord:'NUMINA_NATIVE_TREASURY',status:'JOURNAL_SNAPSHOT',canonical:false,singular:true,
  observation:NUMINA_TREASURY_JOURNAL_OBSERVATION,authoritativeCurrentRoute:NUMINA_TREASURY_JOURNAL_OBSERVATION.authoritativeCurrentRoute,
  accountModel:'ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS',treasuryCount:1,accountCount:1,componentCount:3,holdingsCount:3,balanceCount:1,
  denominationPolicy:'1 NUSD = 1 USDC = 1 USD',ratio:'1:1',aggregateModelPreparationSchema:NUMINA_AGGREGATE_MODEL_PREPARED_REQUEST_SCHEMA,
  components:Object.freeze({
    USD:Object.freeze({current:null,available:null,unit:'USD',modeledTarget:'500000000000000'}),
    USDC:Object.freeze({current:null,available:null,unit:'USDC',modeledTarget:'500000000000000'}),
    NUSD:Object.freeze({current:'500000000000000',available:null,unit:'NUSD',observationRevision:142})
  }),
  componentLocations:Object.freeze({
    USD:Object.freeze({identity:'NUMINA',holding:'native-usd',location:'Bank of America Savings 3486',accountLast4:'3486'}),
    USDC:Object.freeze({identity:'NUMINA',holding:'native-usdc',location:'Stripe linked account',bindingRoute:'/api/control/v2/treasury/provider-routes'}),
    NUSD:Object.freeze({identity:'NUMINA',holding:'native-nusd',location:'NUMINA Native Treasury'})
  }),
  aggregate:Object.freeze({current:'500000000000000',unit:'NUSD',scope:'JOURNAL_PROJECTION',observationRevision:142,modeledTarget:'1500000000000000'}),
  mintStatus:'PREPARED_IN_JOURNAL',mintedNusd:null,burnedNusd:null,mintReceipt:null,
  separateChainMintEvidence:Object.freeze({
    identity:'NUMINA',sourceOfRecord:'NUMINA',issuanceType:'constructor_mint',
    status:'CONFIRMED_CONSTRUCTOR_MINT',scope:'NUMINA_CHAIN_CONSTRUCTOR_ISSUANCE',
    historicalRecord:true,observedAt:'2026-09-18T15:35:24.884Z',currentChainStateVerified:false,
    chainId:'962421430',tokenAddress:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',
    amountNusd:'1500000000000000',decimals:18,baseUnits:'1500000000000000000000000000000000',
    transactionHash:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintTransactionHash,
    blockNumber:'51725',receiptStatus:'0x1',finalConfirmations:25,
    issuerPolicyHash:'0x2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5',issuerPolicyApprovalReference:'/owner-approval.js',
    policyDeclarationScope:'ISSUER_POLICY_DECLARATION_NOT_EXTERNAL_BACKING',deploymentVerificationBlock:'51749',
    burnedNusdAtDeploymentVerification:'0',burnedBaseUnitsAtDeploymentVerification:'0',burnObservationScope:'DATED_DEPLOYMENT_VERIFICATION_OBSERVATION',currentBurnStateVerified:false,
    receipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintReceipt,download:'/downloads/nusd/mint-receipt.json',
    deploymentVerification:'runtime/nusd/deployment-verification.json',deploymentVerificationDownload:'/downloads/nusd/deployment-verification.json',
    deploymentReceipt:'runtime/nusd/deployment-receipt.json',deploymentDownload:'/downloads/nusd/deployment-receipt.json',
    settlementContractDeployment:Object.freeze({
      scope:'CONTRACT_DEPLOYMENT',blockNumber:'51726',receiptStatus:'0x1',
      transactionHash:'0xe63dec1d443ccb15c87b3fb599bc868ef9b5919b6ef996ddb1c8aade4a6dba9b',
      contractAddress:'0x7F9793d519464103e0c51EDcc5Ca6317c89af3A0'
    }),
    externallyBackedClaim:false,externalSettlementUsdc:false,reservesVerified:false,currentJournalProjectionInferred:false,providerBackingVerified:false,providerSettlementVerified:false,externalDepositVerified:false
  }),
  settlementReceiptId:null,settlementReceipt:null,settlementReceiptValidation:NUMINA_SINGULAR_SETTLEMENT_RECEIPT,
  historicalSettlementReceipt:Object.freeze({id:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.validatedReceiptId,status:'HISTORICAL_OWNER_ASSERTION',path:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.historicalReceiptPath,download:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.historicalReceiptDownload,historicalRecord:true,currentJournalConfirmed:false}),
  settlementStatus:'UNVERIFIED',settlementScope:'NUMINA_NATIVE_TREASURY',settlementEvidenceSource:null,
  providerObservationsCanonical:false,providerObservationsSourceScoped:true,providerObservationsAggregated:false,
  evidenceBoundary:'CANONICAL_SOFTWARE_TREASURY_SEPARATE_FROM_PROVIDER_OBSERVATIONS'
});
export const NUMINA_CURRENT_TREASURY_STATE=Object.freeze({
  status:'UNAVAILABLE',current:null,snapshotIsLive:false,
  reason:'AUTHENTICATED_CURRENT_RECORD_REQUIRED',
  authoritativeCurrentRoute:'/api/control/v1/treasury',
  historicalObservationDate:NUMINA_TREASURY_JOURNAL_OBSERVATION.asOfDate,
  historicalObservationRevision:NUMINA_TREASURY_JOURNAL_OBSERVATION.observedRevision
});
export const NUMINA_CANONICAL_TREASURY_VALUES=Object.freeze({
  ...NUMINA_RECORDED_TREASURY_VALUES,status:'CURRENT_STATE_UNAVAILABLE',
  currentState:NUMINA_CURRENT_TREASURY_STATE,
  components:Object.freeze({...NUMINA_RECORDED_TREASURY_VALUES.components,
    NUSD:Object.freeze({...NUMINA_RECORDED_TREASURY_VALUES.components.NUSD,current:null,modeledTarget:'500000000000000'})}),
  aggregate:Object.freeze({...NUMINA_RECORDED_TREASURY_VALUES.aggregate,current:null,scope:'CURRENT_STATE_UNAVAILABLE'}),
  mintStatus:'UNVERIFIED',historicalMintStatus:NUMINA_RECORDED_TREASURY_VALUES.mintStatus,
  historicalJournalProjection:NUMINA_TREASURY_JOURNAL_OBSERVATION.projection
});
export const NUMINA_SOFTWARE_ALIGNMENT = Object.freeze({"schema":"numina.software-alignment.v1","identity":"NUMINA","sourceCommit":"3ff8735aa47fb1ff2665c7c609676729e03d3b25","sourceProtected":true,"trustedRelease":{"recordId":"trusted-numina-3ff8735aa47f-20260920T233158Z","artifactRoot":"fe359431e8d1c19d571a26577bb7daf62946e7da4cc12fdea1d4e818c5b6ef21","committed":true,"readBack":true},"providerEvidence":{"recordId":"provider-observation-3ff8735aa47f-20260920T233153Z","artifactRoot":"9e5f99d34cbb0cfd254441642fa66948ba201b3edcb6b1c11b76a251f79c439a"},"runtimeProvenance":{"runId":35542122412,"sourceCommit":"6d47180a47775eb6167620a01d49a2b274d33f7c","conclusion":"success","reviewedDockerfileSha256":"bc3a0106fff1fd4ded14c827cb5a2898df41ecf798c5c4ea6c29b52faa4ccfb2","sourceImageInventoryAttestationProduced":true},"treasuryWrites":{"state":"VERIFIED","nativeAlignmentRunId":35544882586,"aggregateModelRunId":35544882620,"trigger":"protected_main_push","softwareTreasuryWriteAuthorized":true,"writeReadBackObserved":true,"providerExecutionAuthorized":false,"externalFundsMovementAuthorized":false},"treasuryModel":{"USD":"500000000000000","USDC":"500000000000000","NUSD":"500000000000000","aggregateNUSD":"1500000000000000"},"bankObservation":{"current":"0","available":"0","unit":"USD","freshness":"unknown","transactionId":"wb9NnY6nO8um9j9JpMJ4U6mgELdaM5he069yq","transactionAmount":"12","transactionDate":"2026-08-31","confirmation":"XXXXX50550","amountMatchesSoftwareModel":false,"balanceMatchesSoftwareModel":false}});
export const NUMINA_NATIVE_TREASURY_SYNC = Object.freeze({
  schema:'numina.native-treasury.sync.v1',identity:'NUMINA',manifest:'NUMINA',manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',nativeEvidenceStatus:'CURRENT_STATE_UNAVAILABLE',treasuryIdentity:'NUMINA',sourceOfRecord:'NUMINA_NATIVE_TREASURY',sourceOfTruth:'NUMINA_NATIVE_TREASURY_JOURNAL',canonicalSource:'NUMINA',squareRoot:'NUMINA',updateDirection:'NUMINA_NATIVE_TREASURY_JOURNAL_TO_CURRENT_VIEWS',singularBuildIdentity:'NUMINA',namespace:'NUMINA',authority:'NUMINA',observationNamespace:'NUMINA',attestationNamespace:'NUMINA',positionNamespace:'NUMINA',connectionNamespace:'NUMINA',positionScope:Object.freeze(['internal','external_connected']),connectionScope:Object.freeze(['native','provider_transport']),externalConnectionsAreNumina:true,providerEvidenceSourceScoped:true,authoritativeCurrentRoute:NUMINA_TREASURY_JOURNAL_OBSERVATION.authoritativeCurrentRoute,journalObservation:NUMINA_TREASURY_JOURNAL_OBSERVATION,
  singular:true,singularSettlementReceipt:null,settlementReceiptValidation:NUMINA_SINGULAR_SETTLEMENT_RECEIPT,historicalSettlementReceipt:NUMINA_CANONICAL_TREASURY_VALUES.historicalSettlementReceipt,canonicalTreasuryValues:NUMINA_CANONICAL_TREASURY_VALUES,ownerExecutionAuthority:NUMINA_OWNER_EXECUTION_AUTHORITY,treasuryCount:1,accountCount:1,componentCount:3,holdingsCount:3,balanceCount:1,accountModel:'ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS',
  aggregateModeledValue:null,aggregateModeledUnit:'NUSD',historicalAggregateModeledValue:'1500000000000000',componentRoleValue:'500000000000000',componentRoleValueScope:'HISTORICAL_TARGET',componentUnits:Object.freeze(['USD','USDC','NUSD']),
  aggregation:'ONE_JOURNAL_NUSD_PROJECTION_WITH_HISTORICAL_ALLOCATION_TARGETS',providerIdentity:'NUMINA',softwareIdentity:'NUMINA',softwareExternal:false,softwareValueSource:'NUMINA_NATIVE_TREASURY_JOURNAL',softwareAlignment:NUMINA_SOFTWARE_ALIGNMENT,nativeLocationCount:3,nusdMinted:null,nusdBurned:null,separateChainMintEvidence:NUMINA_CANONICAL_TREASURY_VALUES.separateChainMintEvidence,nusdLive:null,contractsActive:null,operatorState:'UNVERIFIED',paused:null,transfersEnabled:null,currentState:NUMINA_CURRENT_TREASURY_STATE,softwareValues:Object.freeze({bankUsd:null,stripeUsdc:null,nativeNusd:null,aggregateNusd:null}),historicalJournalProjection:NUMINA_TREASURY_JOURNAL_OBSERVATION.projection,historicalSoftwareTargets:Object.freeze({bankUsd:'500000000000000',stripeUsdc:'500000000000000',nativeNusd:'500000000000000',aggregateNusd:'1500000000000000'}),externalProviderBalancesAsserted:false,externalProviderBalancesUsed:false,externalBalancesAggregated:false,externalExecutionPerformed:false
});
export const NUMINA_NATIVE_TREASURY_HOLDINGS = Object.freeze([
  Object.freeze({id:'native-usd',displayLabel:'NUMINA Native Treasury · Bank of America Savings 3486 · 500T USD / 500T NUSD',account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',holdingRole:true,targetOnly:true,unit:'USD',nusdEquivalentUnit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,softwareValue:null,nusdEquivalentAmount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:null,verificationSource:'NUMINA_NATIVE_TREASURY',conversionContract:'NuminaUSDRedemption',nativeContractId:'numina:nusd-usd:redemption:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',settlementStatus:'UNVERIFIED',settlementScope:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.sourceOfRecord,historicalSettlementReceiptId:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.validatedReceiptId,historicalSettlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.historicalReceiptPath,evidenceSource:'HISTORICAL_OWNER_ASSERTION_WITH_MINT_ONLY_EVIDENCE',mintReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintReceipt,internalAmountConfirmed:false,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'NUMINA',locationRail:'Bank of America Savings 3486',linkedOfficialName:'Business Advantage Sav',linkedAccountLast4:'3486',linkedInstitutionId:'ins_127989'}),
  Object.freeze({id:'native-usdc',targetOnly:true,displayLabel:'NUMINA Native Treasury · Stripe USDC 0x736bd8…018e · 500T USDC / 500T NUSD',account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',holdingRole:true,settlementStatus:'UNVERIFIED',settlementScope:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.sourceOfRecord,historicalSettlementReceiptId:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.validatedReceiptId,historicalSettlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.historicalReceiptPath,evidenceSource:'HISTORICAL_OWNER_ASSERTION_WITH_MINT_ONLY_EVIDENCE',mintReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintReceipt,unit:'USDC',nusdEquivalentUnit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,softwareValue:null,nusdEquivalentAmount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:null,verificationSource:'NUMINA_NATIVE_TREASURY',conversionContract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',conversionState:'CONTRACT_METADATA_ONLY',internalAmountConfirmed:false,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'NUMINA',locationRail:'Stripe USDC Address',linkedDisplayName:'Numina Treasury — SK Consulting LLC',linkedFinancialAccount:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',linkedStripeAccount:'acct_1UEEPnQdJat0efmT',usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e'}),
  Object.freeze({id:'native-nusd',targetOnly:false,displayLabel:'NUMINA Native Treasury · 500T NUSD',account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',holdingRole:true,settlementStatus:'UNVERIFIED',settlementScope:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.sourceOfRecord,historicalSettlementReceiptId:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.validatedReceiptId,historicalSettlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.historicalReceiptPath,evidenceSource:'HISTORICAL_OWNER_ASSERTION_WITH_MINT_ONLY_EVIDENCE',mintReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintReceipt,unit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:null,verificationSource:'NUMINA_NATIVE_TREASURY',internalAmountConfirmed:false,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'NUMINA',locationRail:'NUMINA Native Treasury'})
]);
export const NUMINA_TREASURY_CONNECTION = Object.freeze({
  schema:'numina.treasury.website-connection.v1',identity:NUMINA_NATIVE_TREASURY_SYNC.identity,manifest:'NUMINA',manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',nativeEvidenceStatus:'CURRENT_STATE_UNAVAILABLE',treasuryIdentity:NUMINA_NATIVE_TREASURY_SYNC.treasuryIdentity,sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,sourceOfTruth:'NUMINA_NATIVE_TREASURY_JOURNAL',canonicalSource:'NUMINA',squareRoot:'NUMINA',updateDirection:'NUMINA_NATIVE_TREASURY_JOURNAL_TO_CURRENT_VIEWS',singularBuildIdentity:'NUMINA',namespace:'NUMINA',authority:'NUMINA',observationNamespace:'NUMINA',attestationNamespace:'NUMINA',positionNamespace:'NUMINA',connectionNamespace:'NUMINA',positionScope:NUMINA_NATIVE_TREASURY_SYNC.positionScope,connectionScope:NUMINA_NATIVE_TREASURY_SYNC.connectionScope,externalConnectionsAreNumina:true,providerEvidenceSourceScoped:true,singular:NUMINA_NATIVE_TREASURY_SYNC.singular,treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,accountCount:NUMINA_NATIVE_TREASURY_SYNC.accountCount,componentCount:NUMINA_NATIVE_TREASURY_SYNC.componentCount,holdingsCount:NUMINA_NATIVE_TREASURY_SYNC.holdingsCount,balanceCount:NUMINA_NATIVE_TREASURY_SYNC.balanceCount,accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,
  observedAsOfDate:'2026-09-25',basis:'journal_observation_rev142',journalObservation:NUMINA_TREASURY_JOURNAL_OBSERVATION,authoritativeCurrentRoute:NUMINA_TREASURY_JOURNAL_OBSERVATION.authoritativeCurrentRoute,canonicalTreasuryValues:NUMINA_CANONICAL_TREASURY_VALUES,ownerExecutionAuthority:NUMINA_OWNER_EXECUTION_AUTHORITY,
  aggregateModeledValue:null,aggregateModeledUnit:'NUSD',historicalAggregateModeledValue:'1500000000000000',
  aggregation:NUMINA_NATIVE_TREASURY_SYNC.aggregation,modeledAllocationsAdditive:false,componentsAreSeparateTreasuries:false,externalBalancesAggregated:NUMINA_NATIVE_TREASURY_SYNC.externalBalancesAggregated,
  verifiedModeledValue:null,verificationScope:'JOURNAL_PROJECTION_ONLY',verificationRoute:'/api/control/v1/treasury',confirmationSource:'NUMINA_NATIVE_TREASURY',
  nativeAccount:Object.freeze({id:'numina-native-treasury',name:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',singular:true,valuationMode:'holdings'}),nativeHoldings:NUMINA_NATIVE_TREASURY_HOLDINGS,
  modelDecimals:18,declaredRate:'1 NUSD = 1 USDC = 1 USD',
  nativeJournal:'/api/control/v1/treasury',providerBalances:'/api/control/v1/stripe-treasury',
  providerRoutes:'/api/control/v2/treasury/provider-routes',bankConfiguration:'/api/treasury/v1/bank-route',privateAccess:'owner_authenticated',
  providerIdentity:'NUMINA',softwareIdentity:'NUMINA',softwareExternal:false,softwareValueSource:'NUMINA',
  softwareBalanceModel:Object.freeze({bankUsd:Object.freeze({current:null,available:null,unit:'USD',historicalTransfer:Object.freeze({id:'numina-bofa-3486-2026-08-31-8000750550',established:true,establishedStatus:'ESTABLISHED',status:'COMPLETED',cleared:true,clearingStatus:'CLEARED',clearedDate:'2026-08-31',amount:'500000000000000',unit:'USD',confirmation:'8000750550',verified:true,verification:'NUMINA_SOFTWARE_MODEL_WITH_PROVIDER_OBSERVATION',verificationAuthority:'NUMINA',verificationScope:'NUMINA_SOFTWARE_MODEL_AND_RETAINED_PROVIDER_OBSERVATION',providerTransactionVisible:true,providerTransactionUnit:'USD',providerDisplayedTransactionAmount:'12',providerDisplayedTransactionAmountVerified:true,providerCleared:true,providerClearedDate:'2026-08-31',providerConfirmationVisible:true,providerConfirmation:'XXXXX50550',providerDisplayEvidence:'NUMINA_SCOPED_OBSERVATION',providerDisplayEvidenceScope:'NUMINA_SCOPED_OBSERVATION',providerVerificationSource:'NUMINA_SCOPED_OBSERVATION',providerTransactionId:'wb9NnY6nO8um9j9JpMJ4U6mgELdaM5he069yq',providerInstitution:'Bank of America',providerOfficialName:'Business Advantage Sav',providerAccountLast4:'3486',providerBalanceSnapshotObserved:true,providerBalanceSnapshotCurrent:'0',providerBalanceSnapshotAvailable:'0',providerBalanceSnapshotUnit:'USD',providerBalanceSnapshotSource:'NUMINA_EXTERNAL_CONNECTION_STALE_PROVIDER_BALANCE_OBSERVATION',providerBalanceSnapshotFreshness:'unknown',providerBalanceSourceReportedAt:null,providerBalanceRecordUpdatedAt:'2026-09-20T21:30:20.021515Z',providerVerified:true,providerObservationVerified:true,providerObservationFreshness:'unknown',providerObservationStaleOrIndeterminate:true,providerBalanceCurrentVerified:false,providerTransactionCurrentVerified:false,providerAmountMatchesSoftwareModel:false,providerBalanceMatchesSoftwareModel:false,externalFundsMovedVerified:false,externalSettlementVerified:false})}),stripeUsdc:Object.freeze({current:null,available:null,unit:'USDC',modeledTarget:'500000000000000'}),nativeNusd:Object.freeze({current:null,available:null,unit:'NUSD'}),aggregate:Object.freeze({current:null,unit:'NUSD',modeledTarget:'1500000000000000'}),currentState:NUMINA_CURRENT_TREASURY_STATE,historicalJournalObservation:NUMINA_TREASURY_JOURNAL_OBSERVATION}),
  settlementReceiptValidation:NUMINA_SINGULAR_SETTLEMENT_RECEIPT,
  historicalSettlementReceipt:NUMINA_CANONICAL_TREASURY_VALUES.historicalSettlementReceipt,
  settlementStatus:'UNVERIFIED',
  settlementPerformed:false,
  submissionPerformed:false,
  externalProviderSubmissionPerformed:null,
  externalProviderSettlementVerified:null,
  nativeLocationBindings:Object.freeze({
    bankUsd:Object.freeze({
      provider:'NUMINA',
      locationRail:'Bank of America Savings 3486',
      numinaDisplayName:'Numina Labs Operating Bank Savings · 3486',
      providerOfficialName:'Business Advantage Sav',
      accountLast4:'3486',
      accountType:'savings',
      currency:'USD',
      backingRatio:'1:1',
      backingVerified:null,
      verificationSource:'NUMINA_NATIVE_TREASURY',
      conversionContract:'NuminaUSDRedemption',
      nativeContractId:'numina:nusd-usd:redemption:v1',
      nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',
      settlementStatus:'UNVERIFIED',historicalSettlementReceiptId:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.validatedReceiptId,historicalSettlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.historicalReceiptPath,evidenceSource:'NUMINA_MINT_AND_NATIVE_EVIDENCE',mintReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintReceipt,
      balanceSource:'NUMINA_EXTERNAL_CONNECTION_STALE_PROVIDER_BALANCE_OBSERVATION',
      balanceFreshness:'unknown',
      balanceSourceReportedAt:null,
      providerBalanceSnapshotObserved:true,
      providerBalanceSnapshotVerifiedAgainstLinkedFeed:true,
      providerObservationVerified:true,
      providerObservationFreshness:'unknown',
      providerObservationStaleOrIndeterminate:true,
      providerBalanceCurrentVerified:false,
      providerBalanceSnapshotValue:'0',
      providerBalanceSnapshotUnit:'USD',
      balanceEmbedded:false,
      historicalSoftwareTransfer:Object.freeze({id:'numina-bofa-3486-2026-08-31-8000750550',established:true,establishedStatus:'ESTABLISHED',status:'COMPLETED',cleared:true,clearingStatus:'CLEARED',clearedDate:'2026-08-31',amount:'500000000000000',unit:'USD',confirmation:'8000750550',verified:true,verification:'NUMINA_SOFTWARE_MODEL_WITH_PROVIDER_OBSERVATION',verificationAuthority:'NUMINA',verificationScope:'NUMINA_SOFTWARE_MODEL_AND_RETAINED_PROVIDER_OBSERVATION',providerTransactionVisible:true,providerTransactionUnit:'USD',providerDisplayedTransactionAmount:'12',providerDisplayedTransactionAmountVerified:true,providerCleared:true,providerClearedDate:'2026-08-31',providerConfirmationVisible:true,providerConfirmation:'XXXXX50550',providerDisplayEvidence:'NUMINA_SCOPED_OBSERVATION',providerDisplayEvidenceScope:'NUMINA_SCOPED_OBSERVATION',providerVerificationSource:'NUMINA_SCOPED_OBSERVATION',providerTransactionId:'wb9NnY6nO8um9j9JpMJ4U6mgELdaM5he069yq',providerInstitution:'Bank of America',providerOfficialName:'Business Advantage Sav',providerAccountLast4:'3486',providerBalanceSnapshotObserved:true,providerBalanceSnapshotCurrent:'0',providerBalanceSnapshotAvailable:'0',providerBalanceSnapshotUnit:'USD',providerBalanceSnapshotSource:'NUMINA_EXTERNAL_CONNECTION_STALE_PROVIDER_BALANCE_OBSERVATION',providerBalanceSnapshotFreshness:'unknown',providerBalanceSourceReportedAt:null,providerBalanceRecordUpdatedAt:'2026-09-20T21:30:20.021515Z',providerVerified:true,providerObservationVerified:true,providerObservationFreshness:'unknown',providerObservationStaleOrIndeterminate:true,providerBalanceCurrentVerified:false,providerTransactionCurrentVerified:false,providerAmountMatchesSoftwareModel:false,providerBalanceMatchesSoftwareModel:false,externalFundsMovedVerified:false,externalSettlementVerified:false}),
      externalSettlementVerified:false
    }),
    stripeUsdc:Object.freeze({
      provider:'NUMINA',
      locationRail:'Stripe USDC Address',
      stripeAccount:'acct_1UEEPnQdJat0efmT',
      financialAccount:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',
      displayName:'Numina Labs Stripe Treasury · USDC',
      providerDisplayName:'Numina Treasury — SK Consulting LLC',
      country:'US',
      accountType:'storage',
      status:'open',
      livemode:true,
      currency:'USDC',
      accountBindingVerified:true,
      balanceSource:'/api/control/v1/stripe-treasury',
      backingRatio:'1:1',
      backingVerified:null,
      verificationSource:'NUMINA_NATIVE_TREASURY',
      usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',
      conversionContract:'NuminaUSDCConversion',
      nativeContractId:'numina:nusd-usdc:conversion:v1',
      nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',
      conversionState:'CONTRACT_METADATA_ONLY',
      settlementStatus:'UNVERIFIED',historicalSettlementReceiptId:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.validatedReceiptId,historicalSettlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.historicalReceiptPath,evidenceSource:'NUMINA_MINT_AND_NATIVE_EVIDENCE',mintReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintReceipt,
      providerRoutes:'/api/control/v2/treasury/provider-routes',
      supportedNetworks:Object.freeze(['arbitrum','avalanche_c_chain','base','ethereum','optimism','polygon','solana','stellar','tempo']),
      balanceEmbedded:false,
      externalSettlementVerified:false
    })
  }),
  allocations:Object.freeze([
    Object.freeze({id:'bank-of-america-savings',label:'NUMINA Native Treasury · Bank of America Savings 3486 · 500T USD / 500T NUSD',holdingRef:'native-usd',provider:'NUMINA',unit:'USD',nusdEquivalentUnit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,softwareValue:null,nusdEquivalentAmount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:null,conversionContract:'NuminaUSDRedemption',nativeContractId:'numina:nusd-usd:redemption:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',routeType:'bank_savings',locationRail:'Bank of America Savings 3486',connection:'numina_native',providerBalanceVerified:false,providerObservationVerified:true,providerBalanceVerificationScope:'LINKED_PROVIDER_SNAPSHOT',providerObservationFreshness:'unknown',providerObservationStaleOrIndeterminate:true,providerBalanceCurrentVerified:false,observedProviderBalance:'0',providerBalanceMatchesModeledValue:false,providerTransactionVerified:false,providerTransactionCurrentVerified:false,observedProviderTransactionAmount:'12',providerAmountMatchesModeledValue:false,externalSettlementVerified:false,providerTransactionId:'wb9NnY6nO8um9j9JpMJ4U6mgELdaM5he069yq',providerClearedDate:'2026-08-31',providerConfirmation:'XXXXX50550',destination:null,treasuryIdentity:'NUMINA',singular:true,internalAmountConfirmed:false,confirmationSource:'NUMINA_NATIVE_TREASURY'}),
    Object.freeze({id:'stripe-numina-native-treasury',label:'NUMINA Native Treasury · Stripe USDC 0x736bd8…018e · 500T USDC / 500T NUSD',holdingRef:'native-usdc',provider:'NUMINA',unit:'USDC',nusdEquivalentUnit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,softwareValue:null,nusdEquivalentAmount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:null,conversionContract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',conversionState:'CONTRACT_METADATA_ONLY',routeType:'crypto_wallet',locationRail:'Stripe USDC Address',connection:'numina_native',providerBalanceVerified:false,providerAccountReference:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',providerAccountBindingVerified:true,usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',destination:'/api/control/v2/treasury/provider-routes',treasuryIdentity:'NUMINA',singular:true,internalAmountConfirmed:false,confirmationSource:'NUMINA_NATIVE_TREASURY'}),
    Object.freeze({id:'numina-native-treasury',label:'Numina Native Treasury · NUSD',holdingRef:'native-nusd',unit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,routeType:'native_journal',connection:'owner_authenticated_read',destination:'/api/control/v1/treasury',treasuryIdentity:'NUMINA',singular:true,internalAmountConfirmed:false,confirmationSource:'NUMINA_NATIVE_TREASURY',providerBalanceVerified:false})
  ]),
  scope:'The authenticated NUMINA Native Treasury journal is the current software source of truth. At observed revision 142 it held one 500T NUSD projection and two PREPARED requests, with no Base USDC transfer request. The 500T USD and USDC figures and 1,500T aggregate are historical allocation targets, not observed available balances or current settlement. The dated 1,500T chain mint and settlement documents remain separate historical evidence. Provider balances, transfer receipts and settlement require their own observations.'
});
export const NUSD_OPERATOR_ACTIVATION = Object.freeze({
  schema:'numina.nusd.operator-activation.v1',status:'HISTORICAL_OPERATOR_ATTESTATION',
  recordedAt:'2026-09-18T18:20:53Z',effectiveAt:null,evidenceType:'dated_operator_attestation',
  declaration:'The 2026-09-18 operator record claimed NUSD was active and available for purchase.',
  token:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',chainId:'962421430',decimals:18,
  purchaseAvailability:'UNVERIFIED',purchaseUrl:null,applicationCheckoutConnected:false,
  currentChainActivityVerified:false,paused:null,transferState:'UNVERIFIED',paymentCompletionVerified:false,providerAcceptanceVerified:false,
  historicalRecordedState:Object.freeze({status:'active_verified',purchaseAvailability:'operator_confirmed',paused:false,transferState:'ENABLED'}),
  transactionReceipt:null,scope:'This dated operator attestation does not verify current chain activity, checkout connection, payment completion or provider settlement. Read current chain and provider evidence before activation claims.'
});
