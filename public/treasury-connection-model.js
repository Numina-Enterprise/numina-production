// Owner-designated model and activation statement; not provider balance evidence.
export const NUMINA_TREASURY_CONNECTION = Object.freeze({
  schema:'numina.treasury.website-connection.v1',identity:'NUMINA',singular:true,balanceCount:1,
  recordedAt:'2026-09-18T18:20:53Z',basis:'owner_confirmed_route_allocation',
  aggregateModeledValue:'1500000000000000',aggregateModeledUnit:'NUSD',
  aggregation:'MODEL_ROUTE_ALLOCATIONS',modeledAllocationsAdditive:true,externalBalancesAggregated:false,
  modelDecimals:18,declaredRate:'1 NUSD = 1 USDC = 1 USD',
  nativeJournal:'/api/control/v1/treasury',providerBalances:'/api/control/v1/stripe-treasury',
  providerRoutes:'/api/control/v2/treasury/provider-routes',bankConfiguration:'/api/treasury/v1/bank-route',privateAccess:'owner_authenticated',
  allocations:Object.freeze([
    Object.freeze({id:'bank-of-america-savings',label:'Bank of America Savings · ACH',unit:'USD',amount:'500000000000000',routeType:'ach',connection:'owner_configuration_read',destination:null,providerBalanceVerified:false}),
    Object.freeze({id:'stripe-numina-native-treasury',label:'Stripe Treasury · USDC address',unit:'USDC',amount:'500000000000000',routeType:'crypto_wallet',connection:'owner_authenticated_read',destination:null,providerBalanceVerified:false}),
    Object.freeze({id:'numina-native-treasury',label:'Numina Native Treasury · NUSD',unit:'NUSD',amount:'500000000000000',routeType:'native_journal',connection:'owner_authenticated_read',destination:'/api/control/v1/treasury',providerBalanceVerified:false})
  ]),
  scope:'One NUMINA treasury; three designated route allocations compose the 1,500T model. Native journal balances and external provider observations retain their own evidence. No transfer, bank balance or reserve coverage is established by this model.'
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
