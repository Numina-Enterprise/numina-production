// Numina's functional architecture layers, all sharing the canonical control journal.
export const NUMINA_LAYERS = Object.freeze({
  schema:'numina.architecture-layers.v1',classification:'architecture',
  rootCount:1,lineageCount:1,productionEnvironmentCount:1,
  layers:[
    {id:'L3',name:'Authority',capabilities:['agent identity','delegated authority','ALLOW/DENY/ESCALATE policy','human approval'],routes:['/api/control/v2/principals','/api/control/v2/policies','/api/control/v2/decisions','/api/control/v2/approvals']},
    {id:'L4',name:'Execution',capabilities:['governed requests','provider handoff preparation','internal record execution','MCP','A2A'],routes:['/api/control/v2/requests','/api/control/v2/prepare','/api/control/v2/execute','/api/control/v2/mcp','/api/control/v2/a2a']},
    {id:'L5',name:'Canonical evidence',capabilities:['signed provenance','journal head binding','singular Numina-native NUSD projection'],routes:['/api/control/v2/receipts/{eventId}','/api/control/v1/treasury']}
  ],
  authoritativeHead:'/api/control/v1/health',privateState:'/api/control/v2/state',
  approvals:'Decisions are bound to the request and policy; external approvals come from the corresponding provider.'
});
