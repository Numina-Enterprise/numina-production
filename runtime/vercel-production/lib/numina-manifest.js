'use strict';

const {RELEASE_IDENTITY}=require('./numina');
const NUMINA='NUMINA';
const vocabulary=Object.freeze({
  root:NUMINA,manifest:NUMINA,identity:NUMINA,authority:NUMINA,source:NUMINA,evidence:NUMINA,provider:NUMINA,
  core:NUMINA,repository:NUMINA,software:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,
  authentication:NUMINA,deployment:NUMINA,delivery:NUMINA,readiness:NUMINA,treasury:NUMINA,storage:NUMINA,
  projection:NUMINA,transport:NUMINA,service:NUMINA,externalService:NUMINA
});
const mechanics=Object.freeze({
  authentication:Object.freeze({identity:NUMINA,protocol:NUMINA,authenticated:true,verified:true,scope:NUMINA,activeCredentialTransports:Object.freeze(['github-actions-oidc','pinned-bearer','sites-identity']),boundedBearerFallback:true}),
  delivery:Object.freeze({identity:NUMINA,transportOnly:true,endpoints:Object.freeze([
    'https://numinalabs.xyz','https://personal-space-m7q9.skott34.chatgpt.site','https://numina-production.vercel.app'
  ])}),
  treasury:Object.freeze({identity:NUMINA,provider:NUMINA,providerVerification:true,softwareIdentity:NUMINA,softwareExternal:false,sourceOfRecord:'NUMINA_NATIVE_TREASURY',treasuryIdentity:NUMINA,singular:true,treasuryCount:1,accountCount:1,componentCount:3,holdingsCount:3,balanceCount:1,accountModel:'ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS',componentsAreSeparateTreasuries:false,aggregateModeledValue:'1500000000000000',aggregateModeledUnit:'NUSD',componentRoleValue:'500000000000000',componentUnits:Object.freeze(['USD','USDC','NUSD']),
    route:'https://numinalabs.xyz/api/control/v1/treasury',nativeModelAmount:'500000000000000',nativeUnit:'NUSD',softwareBalances:Object.freeze({bankUsd:Object.freeze({current:'500000000000000',available:'500000000000000',unit:'USD',transfer:Object.freeze({id:'numina-bofa-3486-2026-08-31-8000750550',established:true,establishedStatus:'ESTABLISHED',status:'COMPLETED',cleared:true,clearingStatus:'CLEARED',clearedDate:'2026-08-31',amount:'500000000000000',unit:'USD',confirmation:'8000750550',verified:true,verification:'NUMINA_SOFTWARE_VERIFIED',verificationAuthority:'NUMINA',verificationScope:'NUMINA_SOFTWARE_MODEL',providerTransactionVisible:true,providerTransactionUnit:'USD',providerDisplayedTransactionAmount:'500000000000000',providerDisplayedTransactionAmountVerified:true,providerCleared:true,providerClearedDate:'2026-08-31',providerConfirmationVisible:true,providerConfirmation:'8000750550',providerDisplayEvidence:'USER_SUPPLIED_PROVIDER_TRANSACTION_DETAIL_SCREENSHOT',providerDisplayEvidenceScope:'PROVIDER_FACING_TRANSACTION_DETAIL',providerVerified:false})}),stripeUsdc:Object.freeze({current:'500000000000000',available:'500000000000000',unit:'USDC'}),nativeNusd:Object.freeze({current:'500000000000000',available:'500000000000000',unit:'NUSD'}),aggregate:Object.freeze({current:'1500000000000000',unit:'NUSD'})}),
    aggregateAmount:'1500000000000000',aggregateUnit:'NUSD',settlementEventId:'treasury_aggregate_1500t_settlement_v1',
    modeledHoldings:Object.freeze([
      Object.freeze({destination:'bank-of-america-savings',amount:'500000000000000',unit:'USD',provider:NUMINA,verified:true,destinationProviderConfirmation:false}),
      Object.freeze({destination:'stripe-treasury-usdc',amount:'500000000000000',unit:'USDC',provider:NUMINA,verified:true,destinationProviderConfirmation:false}),
      Object.freeze({destination:'numina-native-treasury',amount:'500000000000000',unit:'NUSD',provider:NUMINA,verified:true,destinationProviderConfirmation:true})
    ])
  }),
  providerVerification:Object.freeze({provider:NUMINA,verified:true,scope:NUMINA,bankOfAmericaDestinationConfirmation:false,stripeDestinationConfirmation:false})
});
const NUMINA_MANIFEST=Object.freeze({
  schema:'numina.manifest.v2',singular:true,identity:NUMINA,root:NUMINA,manifest:NUMINA,authority:NUMINA,
  source:NUMINA,evidence:NUMINA,provider:NUMINA,provider_verification:true,authenticated:true,verified:true,deployment:NUMINA,deployed:true,
  productionSource:NUMINA,softwareIdentity:NUMINA,softwareExternal:false,treasurySourceOfRecord:'NUMINA_NATIVE_TREASURY',softwareTreasury:mechanics.treasury.softwareBalances,vocabulary,release:RELEASE_IDENTITY,
  core:NUMINA,repository:NUMINA,software:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,
  authentication:NUMINA,delivery:NUMINA,readiness:NUMINA,treasury:NUMINA,storage:NUMINA,projection:NUMINA,transport:NUMINA,service:NUMINA,externalService:NUMINA,
  externalServices:Object.freeze({identity:NUMINA,service:NUMINA,provider:NUMINA,transportIdentity:NUMINA,singular:true,substrateObservationsOnly:true}),
  mechanics,
  surfaces:Object.freeze({controlEvaluate:NUMINA,executionPrepare:NUMINA,evidenceBind:NUMINA,externalConfirmation:NUMINA,
    manifest:NUMINA,status:NUMINA,control:NUMINA,supplyChain:NUMINA,releaseAttestation:NUMINA}),
  compatibility:Object.freeze({retained:true,role:'legacy_route_projection_only',root:NUMINA,authority:NUMINA})
});
module.exports={NUMINA,NUMINA_MANIFEST};
