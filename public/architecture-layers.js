import {NUMINA_STATE_RECONCILIATION} from './state-reconciliation.js';
import {NUMINA_PROCUREMENT_POLICY} from './procurement-policy.js';
import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
import {NUMINA_NATIVE_TREASURY_SYNC,NUMINA_TREASURY_CONNECTION} from './treasury-connection-model.js';
// Numina's five functional architecture layers resolve to one finalized singular build. The public frontier is a finalized-build projection; legacy journal/storage code is not required for public readiness.
export const NUMINA_LAYERS = Object.freeze({
  schema:'numina.architecture-layers.v1',classification:'architecture',identity:'NUMINA',manifest:'NUMINA',manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',metadataNamespace:'NUMINA',metadataScope:Object.freeze(['historical','current','canonical']),nativeEvidenceStatus:'CURRENT_STATE_UNAVAILABLE',
  stateReconciliation:NUMINA_STATE_RECONCILIATION,
  rootCount:1,lineageCount:1,productionEnvironmentCount:1,
  denomination_policy:NUMINA_DENOMINATION_POLICY,
  procurement_usage:false,
  procurement:NUMINA_PROCUREMENT_POLICY,
  distribution:{identity:'NUMINA',repository:'NUMINA',build:'NUMINA',release:'NUMINA',deployment:'NUMINA',teamCount:1,sharedAcrossLayers:true,policy:'/downloads/distribution-policy.json',finalBuild:'/final-build.json',applicationVersion:'4.0.0',androidVersionCode:4,iosBuildNumber:6},
  database:{identity:'NUMINA',transactionAuthority:'NUMINA',journal:'NUMINA',storage:'NUMINA',revisionModel:'NUMINA',evidenceHead:'NUMINA',sharedAcrossLayers:true},
  treasury:{
    canonicalTreasuryValues:NUMINA_NATIVE_TREASURY_SYNC.canonicalTreasuryValues,
    historicalJournalObservation:NUMINA_NATIVE_TREASURY_SYNC.journalObservation,
    currentState:NUMINA_NATIVE_TREASURY_SYNC.currentState,
    authoritativeCurrentRoute:'/api/control/v1/treasury',
    identity:'NUMINA',treasuryIdentity:'NUMINA',sourceOfRecord:'NUMINA_NATIVE_TREASURY',
    softwareIdentity:'NUMINA',softwareExternal:false,
    softwareBalances:NUMINA_TREASURY_CONNECTION.softwareBalanceModel,
    settlementStatus:'UNVERIFIED',settlementPerformed:false,submissionPerformed:false,
    externalProviderSubmissionPerformed:null,externalProviderSettlementVerified:null,
    historicalSettlementReceipt:NUMINA_NATIVE_TREASURY_SYNC.singularSettlementReceipt,
    singularIdentity:true,singular:true,treasuryCount:1,accountCount:1,balanceCount:1,
    unit:'NUSD',sharedAcrossLayers:true,fundingStatusPointer:'/nativeFundingView/status',
    transportVerificationChannel:'NUMINA',alignmentSchema:'numina.treasury.alignment.v2',
    accountViewSchema:'numina.treasury.account-view.v2',canonicalReferenceSchema:'numina.treasury.canonical-reference.v2',
    separateRoles:true,providerRoleBalancesAdditive:false,
    aggregateModeledValue:null,historicalAggregateModeledValue:'1500000000000000',
    nativeProjectionUnit:'NUSD',componentRoleValue:'500000000000000',componentRoleValueScope:'HISTORICAL_TARGET',
    bankLocation:{label:'Bank of America Savings 3486',target:'500000000000000',current:null,available:null,unit:'USD',verified:null,settlementStatus:'UNVERIFIED'},
    stripeLocation:{label:'Stripe USDC Address',address:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',target:'500000000000000',current:null,available:null,unit:'USDC',verified:null,settlementStatus:'UNVERIFIED'},
    route:'/api/control/v1/treasury',readInterface:'readTreasury()',writeInterface:'writeTreasury(event)',
    accountViewRoute:'/api/control/v2/treasury/accounts'
  },
  nusd:{
    identity:'NUMINA',provider:'NUMINA',status:'CURRENT_CHAIN_STATE_UNVERIFIED',live:null,
    settlementStatus:'UNVERIFIED',currentJournalMintStatus:'UNVERIFIED',historicalJournalMintStatus:'PREPARED',
    mintedNusd:null,burnedNusd:null,nativeBackingVerified:null,
    historicalSettlementReceipt:NUMINA_NATIVE_TREASURY_SYNC.singularSettlementReceipt,
    separateChainMintEvidence:NUMINA_NATIVE_TREASURY_SYNC.separateChainMintEvidence,
    chainId:'962421430',decimals:18,token:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',
    tokenTransaction:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',
    settlement:'0x7F9793d519464103e0c51EDcc5Ca6317c89af3A0',
    settlementTransaction:'0xe63dec1d443ccb15c87b3fb599bc868ef9b5919b6ef996ddb1c8aade4a6dba9b',
    usdcConversion:{status:'CONTRACT_METADATA_ONLY',nativeContractId:'numina:nusd-usdc:conversion:v1',chainReceiptRecorded:false},
    usdRedemption:{status:'CONTRACT_METADATA_ONLY',nativeContractId:'numina:nusd-usd:redemption:v1',chainReceiptRecorded:false},
    receipt:'/downloads/nusd/deployment-receipt.json',externalBackingClaimed:false
  },
  layers:[
    {id:'L1',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v2/head','/api/control/v1/health','/api/nusd/v1/status']},
    {id:'L2',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v2/manifest','/final-build.json']},
    {id:'L3',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v2/architecture','/business-core.json']},
    {id:'L4',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v2/discovery-mcp','/.well-known/agent-card.json']},
    {id:'L5',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v2/manifest','/api/control/v1/manifest','/downloads/nusd/deployment-receipt.json']}
  ],
  authoritativeHead:'/api/control/v2/head',controlManifestRoute:'/api/control/v1/manifest',legacyProjectionRoute:'/api/control/v2/state',
  approvals:'NUMINA'
});
