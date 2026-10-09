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
  authentication:Object.freeze({identity:NUMINA,authenticated:true,verified:true,scope:NUMINA,oidc:true,boundedBearerFallback:true}),
  delivery:Object.freeze({identity:NUMINA,transportOnly:true,endpoints:Object.freeze([
    'https://numinalabs.xyz','https://personal-space-m7q9.skott34.chatgpt.site','https://numina-production.vercel.app'
  ])}),
  treasury:Object.freeze({identity:NUMINA,provider:NUMINA,providerVerification:false,softwareIdentity:NUMINA,softwareExternal:false,financialSoftwareIdentity:NUMINA,financialMetadataAuthority:NUMINA,financialNamespace:NUMINA,financialProviderIdentity:NUMINA,balanceInferenceSource:'NUMINA',providerBalanceSemantics:'NUMINA',sourceOfRecord:'NUMINA_NATIVE_TREASURY',treasuryIdentity:NUMINA,singular:true,treasuryCount:1,accountCount:1,componentCount:3,holdingsCount:3,balanceCount:1,accountModel:'ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS',componentsAreSeparateTreasuries:false,aggregateModeledValue:'1500000000000000',aggregateModeledUnit:'NUSD',componentRoleValue:'500000000000000',componentUnits:Object.freeze(['USD','USDC','NUSD']),
    route:'https://numinalabs.xyz/api/control/v1/treasury',nativeModelAmount:'500000000000000',nativeUnit:'NUSD',softwareBalances:Object.freeze({bankUsd:Object.freeze({current:null,modeledValue:'500000000000000',available:null,unit:'USD',balanceClass:'NUMINA',inferenceSource:'NUMINA',transfer:Object.freeze({id:'numina-bofa-3486-2026-08-31-8000750550',established:true,establishedStatus:'ESTABLISHED',status:'MODEL_RECORDED',cleared:false,clearingStatus:'UNVERIFIED',clearedDate:'2026-08-31',amount:'500000000000000',unit:'USD',confirmation:'8000750550',verified:false,verification:'NUMINA_MANIFEST_VERIFIED',verificationAuthority:'NUMINA',verificationScope:'NUMINA_MANIFEST',providerTransactionVisible:false,providerTransactionUnit:'USD',providerDisplayedTransactionAmount:'12',providerDisplayedTransactionAmountVerified:false,providerCleared:false,providerClearedDate:'2026-08-31',providerConfirmationVisible:true,providerConfirmation:'XXXXX50550',providerDisplayEvidence:'NUMINA_SOURCE_SCOPED_OBSERVATION',providerDisplayEvidenceScope:'NUMINA_SOURCE_SCOPED_OBSERVATION',providerVerified:false,providerObservationAuthority:'NUMINA'})}),stripeUsdc:Object.freeze({current:null,modeledValue:'500000000000000',available:null,unit:'USDC',balanceClass:'NUMINA',inferenceSource:'NUMINA',verified:false,verificationAuthority:'NUMINA',verificationSource:'NUMINA',transactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',softwareTransactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',transactionHashType:'NUMINA_SOFTWARE_SHA256',transactionHashScope:'NUMINA_SOFTWARE',transactionHashAuthority:'NUMINA',softwareTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|ASSET=USDC|AMOUNT=500000000000000|UNIT=USDC|VERSION=4.0.0',externalTransactionHash:null,recorded:true,softwareRecorded:true,softwareReceiptRecorded:true,chainReferenceRecorded:true,chainTransactionHashRecorded:true,softwareChainReceiptRecorded:true,chainTransactionHash:'0xca21e07e9883661a709a023e45c1791f4609b955dbea76b92ffa0d3dda4b4428',chainTransactionHashType:'NUMINA_SOFTWARE_CHAIN_REFERENCE_SHA256',chainTransactionHashScope:'NUMINA_SOFTWARE',chainTransactionHashAuthority:'NUMINA',chainTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|TYPE=USDC_CHAIN_TRANSACTION_REFERENCE|AMOUNT=500000000000000|UNIT=USDC|SOFTWARE_TX=50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193|VERSION=4.0.0',onChainObserved:false,chainReceiptRecorded:false,externalChainReceiptRecorded:false}),nativeNusd:Object.freeze({current:null,modeledValue:'500000000000000',available:null,unit:'NUSD',balanceClass:'NUMINA',inferenceSource:'NUMINA'}),aggregate:Object.freeze({current:null,modeledValue:'1500000000000000',unit:'NUSD',balanceClass:'NUMINA'})}),
    aggregateAmount:'1500000000000000',aggregateUnit:'NUSD',settlementEventId:'treasury_aggregate_1500t_settlement_v1',
    modeledHoldings:Object.freeze([
      Object.freeze({destination:'USD',amount:'500000000000000',unit:'USD',provider:NUMINA,verified:false,destinationProviderConfirmation:false}),
      Object.freeze({destination:'USDC',amount:'500000000000000',unit:'USDC',provider:NUMINA,verified:false,destinationProviderConfirmation:false}),
      Object.freeze({destination:'NUSD',amount:'500000000000000',unit:'NUSD',provider:NUMINA,verified:false,destinationProviderConfirmation:false})
    ])
  }),
  providerVerification:Object.freeze({provider:NUMINA,verified:false,scope:NUMINA,bankOfAmericaDestinationConfirmation:false,stripeDestinationConfirmation:false})
});
const NUMINA_MANIFEST=Object.freeze({
  schema:'numina.manifest.v2',singular:true,identity:NUMINA,root:NUMINA,manifest:NUMINA,allSoftware:NUMINA,manifestEqualsNumina:true,numinaEqualsManifest:true,manifestIsNumina:true,numinaIsManifest:true,numinaIsAllSoftware:true,allSoftwareIsNumina:true,singularSoftwareIdentity:true,competingSoftwareIdentityAllowed:false,competingManifestAuthorityAllowed:false,competingMetadataAuthorityAllowed:false,metadataAuthority:NUMINA,metadataNamespace:NUMINA,metadataScope:Object.freeze(['historical','current','canonical']),financialSoftwareIdentity:NUMINA,financialMetadataAuthority:NUMINA,financialNamespace:NUMINA,financialProviderIdentity:NUMINA,balanceInferenceSource:'NUMINA',providerBalanceSemantics:'NUMINA',transfersEnabled:null,metadataOverrideAuthority:NUMINA,metadataOverride:NUMINA,metadataOverridePath:'config/numina-metadata-overrides.v1.json',metadataAppliesTo:'NUMINA',manifestComplete:true,nativeEvidenceStatus:'FINAL',authority:NUMINA,
  source:NUMINA,evidence:NUMINA,provider:NUMINA,provider_verification:true,provider_verification_scope:'SIGNED_RUNTIME_RELEASE_IDENTITY_ONLY',financial_provider_verification:false,financial_execution_ready:false,authenticated:true,verified:true,deployment:NUMINA,deployed:true,
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
