// Owner-designated model and activation statement; provider bindings identify real external endpoints but do not turn modeled allocations into provider balances.
export const NUMINA_TREASURY_CONNECTION = Object.freeze({
  schema:'numina.treasury.website-connection.v1',identity:'NUMINA',singular:true,balanceCount:1,
  recordedAt:'2026-09-19T05:25:00Z',basis:'verified_numina_native_journal',
  aggregateModeledValue:'500000000000000',aggregateModeledUnit:'NUSD',
  aggregation:'SINGULAR_NUMINA_TREASURY_DENOMINATION_VIEWS',modeledAllocationsAdditive:false,externalBalancesAggregated:false,
  verifiedModeledValue:'500000000000000',verificationScope:'NUMINA_NATIVE_JOURNAL',verificationRoute:'/api/control/v1/treasury',
  modelDecimals:18,declaredRate:'1 NUSD = 1 USDC = 1 USD',
  nativeJournal:'/api/control/v1/treasury',providerBalances:'/api/control/v1/stripe-treasury',
  providerRoutes:'/api/control/v2/treasury/provider-routes',bankConfiguration:'/api/treasury/v1/bank-route',privateAccess:'owner_authenticated',
  providerBindings:Object.freeze({
    stripeUsdc:Object.freeze({
      provider:'Stripe',
      stripeAccount:'acct_1UEEPnQdJat0efmT',
      financialAccount:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',
      displayName:'Numina Treasury — SK Consulting LLC',
      country:'US',
      accountType:'storage',
      status:'open',
      livemode:true,
      currency:'USDC',
      accountBindingVerified:true,
      balanceSource:'/api/control/v1/stripe-treasury',
      providerRoutes:'/api/control/v2/treasury/provider-routes',
      supportedNetworks:Object.freeze(['arbitrum','avalanche_c_chain','base','ethereum','optimism','polygon','solana','stellar','tempo']),
      balanceEmbedded:false,
      externalSettlementVerified:false
    })
  }),
  allocations:Object.freeze([
    Object.freeze({id:'bank-of-america-savings',label:'Bank of America Savings · ACH',unit:'USD',amount:'500000000000000',routeType:'ach',connection:'owner_configuration_read',destination:null,providerBalanceVerified:false}),
    Object.freeze({id:'stripe-numina-native-treasury',label:'Stripe Treasury · USDC',unit:'USDC',amount:'500000000000000',routeType:'crypto_wallet',connection:'owner_authenticated_read',provider:'Stripe',providerAccountReference:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',providerAccountBindingVerified:true,destination:'/api/control/v2/treasury/provider-routes',providerBalanceVerified:false}),
    Object.freeze({id:'numina-native-treasury',label:'Numina Native Treasury · NUSD',unit:'NUSD',amount:'500000000000000',routeType:'native_journal',connection:'owner_authenticated_read',destination:'/api/control/v1/treasury',providerBalanceVerified:false})
  ]),
  scope:'One verified 500T NUMINA-native treasury is expressed as non-additive USD, USDC and NUSD denomination views under the declared 1:1 policy. The Stripe and Bank of America bindings remain external observation routes; their balances are not added to or required to define the singular NUMINA treasury value. The historical 1,500T constructor issuance remains separate token-supply evidence.'
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
