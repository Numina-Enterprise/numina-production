// Current procurement policy. Historical owner statements and usage flags are
// not per-request approval, provider access, a budget, or payment evidence.
export const NUMINA_PROCUREMENT_POLICY = Object.freeze({
  schema: 'numina.procurement-policy.v1', id: 'numina:procurement:direct-partnership:v1', revision: 1,
  status: 'DISABLED_BY_DEFAULT', mode: 'PROJECTION_ONLY', procurement_usage: false,
  singular: true, identity: 'NUMINA', scope: 'NUMINA', policy: '/procurement-policy.js',
  automaticPurchasing: false, executionPerformedByEvaluator: false, providerMutationPerformed: false,
  allowedCategories: Object.freeze(['DIRECT_PARTNERSHIP']), currencies: Object.freeze(['USD']),
  permissions: 'request_bound_owner_or_owner_delegated_approval',
  requirements: Object.freeze(['signed_approval', 'signed_budget_reservation', 'signed_provider_access']),
  paymentEvidence: 'exact_signed_provider_receipt',
  evidenceSchema: '/schemas/procurement-evidence-v1.schema.json',
  evaluator: '/procurement-projection.js', trustAnchors: 'server_owned_configuration_required',
  execution: 'manual_provider_workflow_requires_fresh_authority_and_atomic_budget_claim'
});
