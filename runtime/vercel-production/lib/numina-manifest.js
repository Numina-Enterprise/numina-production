'use strict';

const {RELEASE_IDENTITY}=require('./numina');
const finalManifestReference=require('../final-manifest-reference.json');
const mintReceipt=require('../../nusd/mint-receipt.json');
const deploymentReceipt=require('../../nusd/deployment-receipt.json');
const NUMINA='NUMINA';
const stateReconciliation=require('../state-reconciliation.json');
const journalObservation=Object.freeze({
  schema:'numina.treasury.journal-observation.v1',sourceOfRecord:'NUMINA_NATIVE_TREASURY',
  asOfDate:'2026-09-25',observedRevision:142,
  observedHead:'67b45a040374d944f42f26830c4a9142e26fa194d5149b7cfad2604aef351368',
  authoritativeCurrentRoute:'/api/control/v1/treasury',snapshotIsLive:false,
  projection:Object.freeze({balance:'500000000000000',unit:'NUSD'})
});
const chainMintObservation=Object.freeze({
  identity:NUMINA,sourceOfRecord:NUMINA,status:'CONFIRMED_CONSTRUCTOR_MINT',
  historicalRecord:true,observedAt:mintReceipt.observedAt,currentChainStateVerified:false,
  issuanceType:mintReceipt.issuanceType,chainId:mintReceipt.chainId,tokenAddress:mintReceipt.tokenAddress,
  amountNusd:mintReceipt.amountNusd,decimals:mintReceipt.decimals,baseUnits:mintReceipt.baseUnits,
  transactionHash:mintReceipt.transactionHash,blockNumber:mintReceipt.blockNumber,
  receiptStatus:mintReceipt.receiptStatus,download:'/downloads/nusd/mint-receipt.json',
  settlementContractDeployment:Object.freeze({scope:'CONTRACT_DEPLOYMENT',
    blockNumber:deploymentReceipt.settlement.receipt.blockNumberDecimal,
    transactionHash:deploymentReceipt.settlement.transactionHash,
    contractAddress:deploymentReceipt.settlement.address,
    receiptStatus:deploymentReceipt.settlement.receipt.status}),
  currentJournalProjectionInferred:false,providerBackingVerified:false,
  providerSettlementVerified:false,externalDepositVerified:false
});
const vocabulary=Object.freeze({
  root:NUMINA,manifest:NUMINA,identity:NUMINA,authority:NUMINA,source:NUMINA,evidence:NUMINA,provider:NUMINA,
  core:NUMINA,repository:NUMINA,software:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,
  authentication:NUMINA,deployment:NUMINA,delivery:NUMINA,readiness:NUMINA,treasury:NUMINA,storage:NUMINA,
  projection:NUMINA,transport:NUMINA
});
const mechanics=Object.freeze({
  authentication:Object.freeze({identity:NUMINA,authenticated:true,verified:true,scope:NUMINA,oidc:true,boundedBearerFallback:true}),
  delivery:Object.freeze({identity:NUMINA,transportOnly:true,endpoints:Object.freeze([
    'https://numinalabs.xyz','https://personal-space-m7q9.skott34.chatgpt.site','https://numina-production.vercel.app'
  ])}),
  treasury:Object.freeze({identity:NUMINA,provider:NUMINA,providerVerification:null,
    sourceOfTruth:'NUMINA_NATIVE_TREASURY_JOURNAL',status:'CURRENT_STATE_UNAVAILABLE',currentState:Object.freeze({status:'UNAVAILABLE',current:null,reason:'AUTHENTICATED_CURRENT_RECORD_REQUIRED'}),
    route:'https://numinalabs.xyz/api/control/v1/treasury',nativeModelAmount:null,nativeUnit:'NUSD',
    journalObservation,separateChainMintEvidence:chainMintObservation,
    aggregateAmount:null,aggregateUnit:'NUSD',historicalAggregateAmount:'1500000000000000',
    settlementReceiptId:null,settlementReceipt:null,settlementStatus:'UNVERIFIED',settlementScope:'NUMINA_NATIVE_TREASURY',
    mintStatus:'UNVERIFIED',historicalMintStatus:'PREPARED_IN_JOURNAL',mintedNusd:null,burnedNusd:null,
    externalProviderSettlementVerified:false,settlementEventId:null,transfersEnabled:null,
    historicalSettlementReceipt:Object.freeze({id:'numina:treasury:settlement:2026-09-19:v1',
      receipt:'/downloads/nusd/treasury-settlement-receipt.json',historicalRecord:true,currentJournalConfirmed:false}),
    modeledHoldings:Object.freeze([
      Object.freeze({destination:'bank-of-america-savings',amount:null,modeledTarget:'500000000000000',unit:'USD',provider:NUMINA,verified:null,destinationProviderConfirmation:false}),
      Object.freeze({destination:'stripe-treasury-usdc',amount:null,modeledTarget:'500000000000000',unit:'USDC',provider:NUMINA,verified:null,destinationProviderConfirmation:false}),
      Object.freeze({destination:'numina-native-treasury',amount:null,historicalJournalObservation:journalObservation,unit:'NUSD',provider:NUMINA,verified:null,verificationScope:'AUTHENTICATED_CURRENT_RECORD_REQUIRED',destinationProviderConfirmation:false})
    ])
  }),
  providerVerification:Object.freeze({provider:NUMINA,verified:null,scope:'PROVIDER_EVIDENCE_REQUIRED',bankOfAmericaDestinationConfirmation:false,stripeDestinationConfirmation:false})
});
const NUMINA_MANIFEST=Object.freeze({stateReconciliation,finalManifestReference,
  schema:'numina.manifest.v2',singular:true,identity:NUMINA,root:NUMINA,manifest:NUMINA,authority:NUMINA,
  source:NUMINA,evidence:NUMINA,provider:NUMINA,provider_verification:true,authenticated:true,verified:true,deployment:NUMINA,deployed:true,
  productionSource:NUMINA,vocabulary,release:RELEASE_IDENTITY,
  core:NUMINA,repository:NUMINA,software:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,
  authentication:NUMINA,delivery:NUMINA,readiness:NUMINA,treasury:NUMINA,storage:NUMINA,projection:NUMINA,transport:NUMINA,
  mechanics,
  surfaces:Object.freeze({controlEvaluate:NUMINA,executionPrepare:NUMINA,evidenceBind:NUMINA,externalConfirmation:NUMINA,
    manifest:NUMINA,status:NUMINA,control:NUMINA,supplyChain:NUMINA,releaseAttestation:NUMINA}),
  compatibility:Object.freeze({retained:true,role:'legacy_route_projection_only',root:NUMINA,authority:NUMINA})
});
module.exports={NUMINA,NUMINA_MANIFEST};
