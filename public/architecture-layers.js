// Numina's functional architecture layers, all sharing the canonical control journal.
export const NUMINA_LAYERS = Object.freeze({
  schema:'numina.architecture-layers.v1',classification:'architecture',
  rootCount:1,lineageCount:1,productionEnvironmentCount:1,
  procurement_usage:true,
  procurement:Object.freeze({policy:'/business-core.json',authorization:'owner_authorized_existing_workflows',scope:'Numina software, service requests and provider handoff preparation',permissions:'existing_owner_and_delegated_permissions',paymentEvidence:'provider_confirmation_required',automaticPurchasing:false}),
  distribution:{team:'Numina',authority:'NUMINA',teamCount:1,sharedAcrossLayers:true,policy:'/downloads/distribution-policy.json'},
  treasury:{route:'/api/control/v1/treasury',readInterface:'readTreasury()',writeInterface:'writeTreasury(event)',unit:'NUSD',balanceCount:1,sharedAcrossLayers:true,accountViewRoute:'/api/control/v2/treasury/accounts',fundingStatusPointer:'/nativeFundingView/status'},
  layers:[
    {id:'L1',name:'Root and state',capabilities:['one perpetual authority root','canonical journal','current head','connected permissioned blockchain observation'],routes:['/api/control/v2/head','/api/control/v1/health','/v2/network/status']},
    {id:'L2',name:'Intent and evidence',capabilities:['Principal / Authority / Objective / Intent','scoped requests','evidence references','causal lineage'],routes:['/api/control/v1/state','/api/control/v2/requests']},
    {id:'L3',name:'Authority',capabilities:['agent identity','delegated authority','ALLOW/DENY/ESCALATE policy','human approval'],routes:['/api/control/v2/principals','/api/control/v2/policies','/api/control/v2/decisions','/api/control/v2/approvals']},
    {id:'L4',name:'Execution',capabilities:['governed requests','provider handoff preparation','internal record execution','MCP','A2A'],routes:['/api/control/v2/requests','/api/control/v2/prepare','/api/control/v2/execute','/api/control/v2/mcp','/api/control/v2/a2a']},
    {id:'L5',name:'Canonical evidence',capabilities:['signed provenance','journal head binding','singular Numina-native NUSD projection'],routes:['/api/control/v2/receipts/{eventId}','/api/control/v1/treasury']}
  ],
  authoritativeHead:'/api/control/v2/head',privateState:'/api/control/v2/state',
  approvals:'Decisions are bound to the request and policy; external approvals come from the corresponding provider.'
});
