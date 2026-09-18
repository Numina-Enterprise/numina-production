'use strict';

const {RELEASE_IDENTITY}=require('./numina');
const NUMINA='NUMINA';
const vocabulary=Object.freeze({
  root:NUMINA,manifest:NUMINA,identity:NUMINA,authority:NUMINA,source:NUMINA,evidence:NUMINA,provider:NUMINA,
  core:NUMINA,repository:NUMINA,software:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,
  artifact:NUMINA,authentication:NUMINA,delivery:NUMINA,readiness:NUMINA,treasury:NUMINA
});
const NUMINA_MANIFEST=Object.freeze({
  schema:'numina.manifest.v2',singular:true,root:NUMINA,manifest:NUMINA,identity:NUMINA,authority:NUMINA,
  source:NUMINA,evidence:NUMINA,provider:NUMINA,provider_verification:true,productionSource:NUMINA,vocabulary,
  release:RELEASE_IDENTITY,
  core:NUMINA,repository:NUMINA,software:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,
  authentication:Object.freeze({identity:NUMINA,oidc:true,boundedBearerFallback:true}),
  delivery:Object.freeze({identity:NUMINA,transportOnly:true,endpoints:Object.freeze([
    'https://numinalabs.xyz','https://personal-space-m7q9.skott34.chatgpt.site','https://numina-production.vercel.app'
  ])}),
  readiness:Object.freeze({identity:NUMINA}),
  treasury:Object.freeze({identity:NUMINA,provider:NUMINA,providerVerification:true,
    route:'https://numinalabs.xyz/api/control/v1/treasury',nativeModelAmount:'500000000000000',nativeUnit:'NUSD',
    aggregateAmount:'1500000000000000',aggregateUnit:'NUSD',settlementEventId:'treasury_aggregate_1500t_settlement_v1',
    modeledHoldings:Object.freeze([
      Object.freeze({destination:'bank-of-america-savings',amount:'500000000000000',unit:'USD',provider:NUMINA,verified:true,destinationProviderConfirmation:false}),
      Object.freeze({destination:'stripe-treasury-usdc',amount:'500000000000000',unit:'USDC',provider:NUMINA,verified:true,destinationProviderConfirmation:false}),
      Object.freeze({destination:'numina-native-treasury',amount:'500000000000000',unit:'NUSD',provider:NUMINA,verified:true,destinationProviderConfirmation:true})
    ])
  }),
  providerVerification:Object.freeze({provider:NUMINA,verified:true,scope:NUMINA,bankOfAmericaDestinationConfirmation:false,stripeDestinationConfirmation:false}),
  surfaces:Object.freeze({controlEvaluate:NUMINA,executionPrepare:NUMINA,evidenceBind:NUMINA,externalConfirmation:NUMINA,manifest:NUMINA,status:NUMINA,controlState:NUMINA,supplyChain:NUMINA,releaseAttestation:NUMINA}),
  compatibility:Object.freeze({retained:true,role:'projection',root:NUMINA,authority:NUMINA})
});
module.exports={NUMINA,NUMINA_MANIFEST};
