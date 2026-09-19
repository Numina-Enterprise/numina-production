// Owner-designated model and activation statement; provider bindings identify real external endpoints but do not turn modeled allocations into provider balances.
export const NUMINA_NATIVE_TREASURY_SYNC = Object.freeze({
  schema:'numina.native-treasury.sync.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',sourceOfRecord:'NUMINA_NATIVE_TREASURY',
  singular:true,treasuryCount:1,accountCount:1,componentCount:3,holdingsCount:3,balanceCount:1,accountModel:'ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS',
  aggregateModeledValue:'1500000000000000',aggregateModeledUnit:'NUSD',componentRoleValue:'500000000000000',componentUnits:Object.freeze(['USD','USDC','NUSD']),
  aggregation:'ONE_SINGULAR_NUMINA_TREASURY_THREE_ADDITIVE_COMPONENT_ROLES',externalProviderBalancesAsserted:false,externalProviderBalancesUsed:false,externalBalancesAggregated:false,externalExecutionPerformed:false
});
export const NUMINA_NATIVE_TREASURY_HOLDINGS = Object.freeze([
  Object.freeze({id:'native-usd',displayLabel:'Numina Labs Operating Bank Savings · 3486',account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',holdingRole:true,unit:'USD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'Bank of America',providerOfficialName:'Business Advantage Sav',providerAccountLast4:'3486',providerBalanceRole:'PROVIDER_REPORTED_BALANCE_SOURCE',providerBalanceSource:'FINANCES_LINKED_ACCOUNT'}),
  Object.freeze({id:'native-usdc',displayLabel:'Numina Labs Stripe Treasury · USDC',account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',holdingRole:true,unit:'USDC',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'Stripe',providerDisplayName:'Numina Treasury — SK Consulting LLC',providerFinancialAccount:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',providerBalanceRole:'PROVIDER_REPORTED_BALANCE_SOURCE',providerBalanceSource:'STRIPE_MONEY_MANAGEMENT_FINANCIAL_ACCOUNT'}),
  Object.freeze({id:'native-nusd',displayLabel:'Numina Native Treasury · NUSD',account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',holdingRole:true,unit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'NUMINA',providerBalanceRole:'NUMINA_NATIVE_INTERNAL_SOURCE',providerBalanceSource:'NUMINA_NATIVE_TREASURY'})
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
  providerBindings:Object.freeze({
    bankUsd:Object.freeze({
      provider:'Bank of America',
      numinaDisplayName:'Numina Labs Operating Bank Savings · 3486',
      providerOfficialName:'Business Advantage Sav',
      accountLast4:'3486',
      accountType:'savings',
      currency:'USD',
      providerBalanceRole:'PROVIDER_REPORTED_BALANCE_SOURCE',
      balanceSource:'FINANCES_LINKED_ACCOUNT',
      balanceFreshness:'unknown',
      balanceEmbedded:false,
      externalSettlementVerified:false
    }),
    stripeUsdc:Object.freeze({
      provider:'Stripe',
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
      providerBalanceRole:'PROVIDER_REPORTED_BALANCE_SOURCE',
      providerRoutes:'/api/control/v2/treasury/provider-routes',
      supportedNetworks:Object.freeze(['arbitrum','avalanche_c_chain','base','ethereum','optimism','polygon','solana','stellar','tempo']),
      balanceEmbedded:false,
      externalSettlementVerified:false
    })
  }),
  allocations:Object.freeze([
    Object.freeze({id:'bank-of-america-savings',label:'Numina Labs Operating Bank Savings · 3486',holdingRef:'native-usd',unit:'USD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,routeType:'ach',connection:'owner_configuration_read',providerBalanceRole:'PROVIDER_REPORTED_BALANCE_SOURCE',providerBalanceSource:'FINANCES_LINKED_ACCOUNT',destination:null,treasuryIdentity:'NUMINA',singular:true,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',providerBalanceVerified:false}),
    Object.freeze({id:'stripe-numina-native-treasury',label:'Numina Labs Stripe Treasury · USDC',holdingRef:'native-usdc',unit:'USDC',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,routeType:'crypto_wallet',connection:'owner_authenticated_read',provider:'Stripe',providerAccountReference:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',providerAccountBindingVerified:true,providerBalanceRole:'PROVIDER_REPORTED_BALANCE_SOURCE',providerBalanceSource:'/api/control/v1/stripe-treasury',destination:'/api/control/v2/treasury/provider-routes',treasuryIdentity:'NUMINA',singular:true,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',providerBalanceVerified:false}),
    Object.freeze({id:'numina-native-treasury',label:'Numina Native Treasury · NUSD',holdingRef:'native-nusd',unit:'NUSD',amount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,routeType:'native_journal',connection:'owner_authenticated_read',destination:'/api/control/v1/treasury',treasuryIdentity:'NUMINA',singular:true,internalAmountConfirmed:true,confirmationSource:'NUMINA_NATIVE_TREASURY',providerBalanceVerified:false})
  ]),
  scope:'There is exactly one singular Numina Native Treasury account and one 1,500T internal modeled aggregate balance. USD, USDC and NUSD are three additive 500T native holdings inside that account. The USD and USDC holdings are bound to Bank of America and Stripe provider-reported balance sources respectively; provider-reported balances remain independent observations and are not overwritten or inferred from the modeled values. Bank of America and Stripe are not separate NUMINA treasuries.'
});
export const NUSD_OPERATOR_ACTIVATION = Object.freeze({
  schema:'numina.nusd.operator-activation.v1',status:'active_operator_confirmed',
  recordedAt:'2026-09-18T18:20:53Z',effectiveAt:null,evidenceType:'owner_statement',
  declaration:'NUSD is active and available for purchase; payment routes enabled.',
  token:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',chainId:'962421430',decimals:18,
  purchaseAvailability:'operator_confirmed',purchaseUrl:null,applicationCheckoutConnected:false,
  currentChainActivityVerified:false,paymentCompletionVerified:false,providerAcceptanceVerified:false,
  transactionReceipt:null,scope:'Operator confirmation is separate from current chain state, checkout connection and transaction settlement.'
});
