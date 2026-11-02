# Numina Clearing Stability Runtime v1.8

v1.8 adds an autonomous clearing and systemic-stability control layer above the v1.7 constitutional market runtime.

## Laws

1. Margin deficiency is measured from open gross obligations, eligible collateral, settlement capacity, and an explicit maintenance profile.
2. A margin call is a bounded response to deficiency; it is not new authority or new collateral.
3. Default waterfalls may allocate only pre-existing declared resources and preserve residual deficiency explicitly.
4. Recovery actions are limited to obligation-satisfying, risk-reducing, reconciliation, and collateralization classes. Risk-adding recovery is invalid.
5. Systemic envelopes preserve gross open obligation provenance even when netting views exist.
6. Crisis response is valid only when risk-adding authority is non-increasing and uncertainty is not erased by assertion.
7. Assessment and proof generation are observational; they do not mutate economic state.

## Runtime objects

`MarginProfile`, `MarginAssessment`, `MarginCall`, `WaterfallLayer`, `WaterfallResult`, `RecoveryStep`, `RecoveryPlan`, `SystemicEnvelope`, and `CrisisNonAmplificationProof`.

The layer remains integer-only and deterministic. It does not custody assets, move money, or claim external legal/regulatory status.
