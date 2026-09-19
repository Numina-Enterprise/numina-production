import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
import {NUMINA_NATIVE_TREASURY_SYNC} from './treasury-connection-model.js';
// Numina's functional architecture layers, all resolving to the NUMINA manifest; journal and storage are mechanics only.
export const NUMINA_LAYERS = Object.freeze({
  schema:'numina.architecture-layers.v1',classification:'architecture',
  rootCount:1,lineageCount:1,productionEnvironmentCount:1,
  denomination_policy:NUMINA_DENOMINATION_POLICY,
  procurement_usage:true,
  procurement:Object.freeze({status:'ACTIVE',singular:true,identity:'NUMINA',policy:'/business-core.json',scope:'NUMINA',paymentEvidence:'provider_receipt_confirms_completion',automaticPurchasing:false}),
  distribution:{identity:'NUMINA',repository:'NUMINA',build:'NUMINA',release:'NUMINA',deployment:'NUMINA',teamCount:1,sharedAcrossLayers:true,policy:'/downloads/distribution-policy.json',finalBuild:'/final-build.json',applicationVersion:'4.0.0',androidVersionCode:4,iosBuildNumber:6},
  database:{identity:'NUMINA',transactionAuthority:'NUMINA',journal:'NUMINA',storage:'NUMINA',revisionModel:'NUMINA',evidenceHead:'NUMINA',sharedAcrossLayers:true},
  treasury:{identity:'NUMINA',treasuryIdentity:'NUMINA',singularIdentity:'NUMINA',sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,singular:NUMINA_NATIVE_TREASURY_SYNC.singular,treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,componentCount:NUMINA_NATIVE_TREASURY_SYNC.componentCount,balanceCount:NUMINA_NATIVE_TREASURY_SYNC.balanceCount,componentsAreSeparateTreasuries:false,transportVerificationChannel:'NUMINA',alignmentSchema:'numina.treasury.alignment.v2',accountViewSchema:'numina.treasury.account-view.v2',canonicalReferenceSchema:'numina.treasury.canonical-reference.v2',separateRoles:true,providerRoleBalancesAdditive:false,modeledRoleValuesAdditive:true,aggregation:NUMINA_NATIVE_TREASURY_SYNC.aggregation,aggregateModeledValue:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue,aggregateModeledUnit:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledUnit,componentRoleValue:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,componentUnits:NUMINA_NATIVE_TREASURY_SYNC.componentUnits,route:'/api/control/v1/treasury',readInterface:'readTreasury()',writeInterface:'writeTreasury(event)',unit:'NUSD',sharedAcrossLayers:true,accountViewRoute:'/api/control/v2/treasury/accounts',fundingStatusPointer:'/nativeFundingView/status'},
  nusd:{identity:'NUMINA',status:'FINAL',chainId:'962421430',decimals:18,token:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',tokenTransaction:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',settlement:'0x7F9793d519464103e0c51EDcc5Ca6317c89af3A0',settlementTransaction:'0xe63dec1d443ccb15c87b3fb599bc868ef9b5919b6ef996ddb1c8aade4a6dba9b',receipt:'/downloads/nusd/deployment-receipt.json',externalBackingClaimed:false},
  layers:[
    {id:'L1',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v2/head','/api/control/v1/health','/v2/network/status']},
    {id:'L2',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v1/state','/api/control/v2/requests']},
    {id:'L3',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v2/principals','/api/control/v2/policies','/api/control/v2/decisions','/api/control/v2/approvals']},
    {id:'L4',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v2/requests','/api/control/v2/prepare','/api/control/v2/execute','/api/control/v2/mcp','/api/control/v2/a2a']},
    {id:'L5',name:'NUMINA',capabilities:['NUMINA'],routes:['/api/control/v2/receipts/{eventId}','/api/control/v1/treasury']}
  ],
  authoritativeHead:'/api/control/v2/head',manifest:'/api/control/v1/manifest',legacyProjectionRoute:'/api/control/v2/state',
  approvals:'NUMINA'
});
