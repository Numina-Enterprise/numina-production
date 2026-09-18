import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
// Numina's functional architecture layers, all resolving to the NUMINA manifest; journal and storage are mechanics only.
export const NUMINA_LAYERS = Object.freeze({
  schema:'numina.architecture-layers.v1',classification:'architecture',
  rootCount:1,lineageCount:1,productionEnvironmentCount:1,
  denomination_policy:NUMINA_DENOMINATION_POLICY,
  procurement_usage:true,
  procurement:Object.freeze({status:'ACTIVE',singular:true,identity:'NUMINA',policy:'/business-core.json',scope:'NUMINA',paymentEvidence:'provider_receipt_confirms_completion',automaticPurchasing:false}),
  distribution:{identity:'NUMINA',teamCount:1,sharedAcrossLayers:true,policy:'/downloads/distribution-policy.json'},
  treasury:{route:'/api/control/v1/treasury',readInterface:'readTreasury()',writeInterface:'writeTreasury(event)',unit:'NUSD',balanceCount:1,sharedAcrossLayers:true,accountViewRoute:'/api/control/v2/treasury/accounts',fundingStatusPointer:'/nativeFundingView/status'},
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
