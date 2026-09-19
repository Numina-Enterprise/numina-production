// Final singular NUMINA Native Treasury model. NUMINA is the sole provider identity; Bank of America and Stripe are native treasury locations/rails.
export const NUMINA_NATIVE_TREASURY_SYNC = Object.freeze({
  schema:'numina.native-treasury.sync.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',sourceOfRecord:'NUMINA_NATIVE_TREASURY',
  singular:true,treasuryCount:1,accountCount:1,componentCount:3,holdingsCount:3,balanceCount:1,accountModel:'ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS',
  aggregateModeledValue:'1500000000000000',aggregateModeledUnit:'NUSD',componentRoleValue:'500000000000000',componentUnits:Object.freeze(['USD','USDC','NUSD']),
  aggregation:'ONE_SINGULAR_NUMINA_TREASURY_THREE_ADDITIVE_COMPONENT_ROLES',providerIdentity:'NUMINA',nativeLocationCount:3,nusdMinted:'1500000000000000',nusdBurned:'0',nusdLive:true,contractsActive:true,operatorState:'ACTIVE',paused:false,externalProviderBalancesAsserted:false,externalProviderBalancesUsed:false,externalBalancesAggregated:false,externalExecutionPerformed:false
});
export const NUMINA_SINGULAR_SETTLEMENT_RECEIPT=Object.freeze({schema:'numina.treasury.singular-settlement-receipt.v1',id:'numina:treasury:settlement:2026-09-19:v1',status:'SETTLED',path:'release-evidence/numina-singular-treasury-settlement-receipt-2026-09-19.json',download:'/downloads/nusd/treasury-settlement-receipt.json',mintReceipt:'runtime/nusd/mint-receipt.json',mintTransactionHash:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',nativeBackingAttestationId:'numina:treasury:backing:2026-09-19:v1',submissionPerformed:true,settlementPerformed:true,aggregateNusd:'1500000000000000',componentCount:3});
export const NUMINA_NATIVE_TREASURY_HOLDINGS = Object.freeze([
  Object.freeze({id:'native-usd',displayLabel:'NUMINA Native Treasury · Bank of America Savings 3486 · 500T USD / 500T NUSD',account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',holdingRole:true,unit:'USD',nusdEquivalentUnit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,nusdEquivalentAmount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA_NATIVE_TREASURY',conversionContract:'NuminaUSDRedemption',nativeContractId:'numina:nusd-usd:redemption:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',settlementStatus:'SETTLED',settlementReceiptId:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.id,settlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.path,evidenceSource:'NUMINA_MINT_AND_NATIVE_EVIDENCE',mintReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintReceipt,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'NUMINA',locationRail:'Bank of America Savings 3486',linkedOfficialName:'Business Advantage Sav',linkedAccountLast4:'3486',linkedInstitutionId:'ins_127989'}),
  Object.freeze({id:'native-usdc',displayLabel:'NUMINA Native Treasury · Stripe USDC 0x736bd8…018e · 500T USDC / 500T NUSD',account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',holdingRole:true,unit:'USDC',nusdEquivalentUnit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,nusdEquivalentAmount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA_NATIVE_TREASURY',conversionContract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',conversionState:'ACTIVE_SIGNED_1_TO_1_VERIFIED',internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'NUMINA',locationRail:'Stripe USDC Address',linkedDisplayName:'Numina Treasury — SK Consulting LLC',linkedFinancialAccount:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',linkedStripeAccount:'acct_1UEEPnQdJat0efmT',usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e'}),
  Object.freeze({id:'native-nusd',displayLabel:'NUMINA Native Treasury · 500T NUSD',account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',holdingRole:true,unit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA_NATIVE_TREASURY',internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'NUMINA',locationRail:'NUMINA Native Treasury'})
]);
export const NUMINA_TREASURY_CONNECTION = Object.freeze({
  schema:'numina.treasury.website-connection.v1',identity:NUMINA_NATIVE_TREASURY_SYNC.identity,treasuryIdentity:NUMINA_NATIVE_TREASURY_SYNC.treasuryIdentity,sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,singular:NUMINA_NATIVE_TREASURY_SYNC.singular,treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,accountCount:NUMINA_NATIVE_TREASURY_SYNC.accountCount,componentCount:NUMINA_NATIVE_TREASURY_SYNC.componentCount,holdingsCount:NUMINA_NATIVE_TREASURY_SYNC.holdingsCount,balanceCount:NUMINA_NATIVE_TREASURY_SYNC.balanceCount,accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,
  recordedAt:'2026-09-19T07:00:00Z',basis:'verified_numina_native_journal',
  aggregateModeledValue:'1500000000000000',aggregateModeledUnit:'NUSD',
  aggregation:NUMINA_NATIVE_TREASURY_SYNC.aggregation,modeledAllocationsAdditive:true,componentsAreSeparateTreasuries:false,externalBalancesAggregated:NUMINA_NATIVE_TREASURY_SYNC.externalBalancesAggregated,
  verifiedModeledValue:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue,verificationScope:'NUMINA_NATIVE_TREASURY_CONFIRMED_INTERNAL_AGGREGATE',verificationRoute:'/api/control/v1/treasury',confirmationSource:'NUMINA_NATIVE_TREASURY',
  nativeAccount:Object.freeze({id:'numina-native-treasury',name:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',singular:true,valuationMode:'holdings'}),nativeHoldings:NUMINA_NATIVE_TREASURY_HOLDINGS,
  modelDecimals:18,declaredRate:'1 NUSD = 1 USDC = 1 USD',
  nativeJournal:'/api/control/v1/treasury',providerBalances:'/api/control/v1/stripe-treasury',
  providerRoutes:'/api/control/v2/treasury/provider-routes',bankConfiguration:'/api/treasury/v1/bank-route',privateAccess:'owner_authenticated',
  providerIdentity:'NUMINA',
  singularSettlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT,
  settlementStatus:'SETTLED',
  settlementPerformed:true,
  submissionPerformed:true,
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
      backingVerified:true,
      verificationSource:'NUMINA_NATIVE_TREASURY',
      conversionContract:'NuminaUSDRedemption',
      nativeContractId:'numina:nusd-usd:redemption:v1',
      nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',
      settlementStatus:'SETTLED',settlementReceiptId:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.id,settlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.path,evidenceSource:'NUMINA_MINT_AND_NATIVE_EVIDENCE',mintReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintReceipt,
      balanceSource:'NUMINA_NATIVE_TREASURY',
      balanceFreshness:'unknown',
      balanceEmbedded:false,
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
      backingVerified:true,
      verificationSource:'NUMINA_NATIVE_TREASURY',
      usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',
      conversionContract:'NuminaUSDCConversion',
      nativeContractId:'numina:nusd-usdc:conversion:v1',
      nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',
      conversionState:'ACTIVE_SIGNED_1_TO_1_VERIFIED',
      settlementStatus:'SETTLED',settlementReceiptId:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.id,settlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.path,evidenceSource:'NUMINA_MINT_AND_NATIVE_EVIDENCE',mintReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT.mintReceipt,
      providerRoutes:'/api/control/v2/treasury/provider-routes',
      supportedNetworks:Object.freeze(['arbitrum','avalanche_c_chain','base','ethereum','optimism','polygon','solana','stellar','tempo']),
      balanceEmbedded:false,
      externalSettlementVerified:false
    })
  }),
  allocations:Object.freeze([
    Object.freeze({id:'bank-of-america-savings',label:'NUMINA Native Treasury · Bank of America Savings 3486 · 500T USD / 500T NUSD',holdingRef:'native-usd',provider:'NUMINA',unit:'USD',nusdEquivalentUnit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,nusdEquivalentAmount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:true,conversionContract:'NuminaUSDRedemption',nativeContractId:'numina:nusd-usd:redemption:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',routeType:'bank_savings',locationRail:'Bank of America Savings 3486',connection:'numina_native',destination:null,treasuryIdentity:'NUMINA',singular:true,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY'}),
    Object.freeze({id:'stripe-numina-native-treasury',label:'NUMINA Native Treasury · Stripe USDC 0x736bd8…018e · 500T USDC / 500T NUSD',holdingRef:'native-usdc',provider:'NUMINA',unit:'USDC',nusdEquivalentUnit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,nusdEquivalentAmount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,backingRatio:'1:1',backingVerified:true,conversionContract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',conversionState:'ACTIVE_SIGNED_1_TO_1_VERIFIED',routeType:'crypto_wallet',locationRail:'Stripe USDC Address',connection:'numina_native',providerAccountReference:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',providerAccountBindingVerified:true,usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',destination:'/api/control/v2/treasury/provider-routes',treasuryIdentity:'NUMINA',singular:true,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY'}),
    Object.freeze({id:'numina-native-treasury',label:'Numina Native Treasury · NUSD',holdingRef:'native-nusd',unit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,routeType:'native_journal',connection:'owner_authenticated_read',destination:'/api/control/v1/treasury',treasuryIdentity:'NUMINA',singular:true,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',providerBalanceVerified:false})
  ]),
  scope:'There is exactly one singular NUMINA Native Treasury and one provider identity: NUMINA. Bank of America Savings 3486 is the 500T USD / 500T NUSD native location with verified 1:1 NUSD/USD backing through NuminaUSDRedemption. Stripe USDC address 0x736bd8f274dce00a8bb374edd85df0d2e631018e is the 500T USDC / 500T NUSD native location with verified 1:1 USDC/NUSD backing through NuminaUSDCConversion. NUMINA Native Treasury holds the third 500T NUSD location. Aggregate 1,500T NUSD; minted 1,500T; burned 0; NUSD contracts operationally ACTIVE.'
});
export const NUSD_OPERATOR_ACTIVATION = Object.freeze({
  schema:'numina.nusd.operator-activation.v1',status:'active_operator_confirmed',
  recordedAt:'2026-09-18T18:20:53Z',effectiveAt:null,evidenceType:'owner_statement',
  declaration:'NUSD is active and available for purchase; payment routes enabled.',
  token:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',chainId:'962421430',decimals:18,
  purchaseAvailability:'operator_confirmed',purchaseUrl:null,applicationCheckoutConnected:false,
  currentChainActivityVerified:false,paymentCompletionVerified:false,providerAcceptanceVerified:true,
  transactionReceipt:null,scope:'Operator confirmation is separate from current chain state, checkout connection and transaction settlement.'
});
