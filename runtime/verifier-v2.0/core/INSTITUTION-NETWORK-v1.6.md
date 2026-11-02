# Numina Institution Network v1.6

v1.6 extends Rights Foundry and the Institutional Compiler into a cross-institution rights and obligation network.

## Constitutional rules

1. Recognition may expose a right in another domain but never widens intrinsic available capacity.
2. Rights propagation is explicit and non-transitive by default; every onward hop must permit transitivity.
3. Propagation capacity monotonically narrows along the route.
4. Claim priority is deterministic; lower numeric priority is senior and ties are broken by claim id.
5. Insolvency never erases claims. Deficiency remains explicit.
6. Contract-network reachability is cycle-safe and cannot inflate consequence by revisiting domains or obligations.
7. Settlement proof is identity-, amount-, sequence-, and prior-state-bound and is replay protected.
8. Local and network obligation state move together on accepted settlement proof.
9. Authority synthesized from a right is bounded by requested ceiling, intrinsic available capacity, and recognized capacity.
10. Network analysis derives from constitutional state and cannot mint rights or authority.

## New primitives

- `RightPropagationEdge` / `RightPropagationProof`
- `RecognitionSurface`
- `PriorityClaim` / `WaterfallAllocation`
- `InsolvencyAssessment`
- `ContractNetworkEdge` / `ContractNetworkReachability`
- `SettlementProof`
- `AuthoritySynthesis`
- `InstitutionalRightsNetwork`

## Scope

Reference implementation only. It models institutional rights/obligation mechanics and does not assert legal enforceability, regulatory recognition, external adoption, or production safety.
