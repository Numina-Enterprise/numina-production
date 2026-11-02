from numina_core import (
    AuthorityDomainSample, SafetyEnvelope, AuthorityPhysicsV11,
    ContinuousSafetyEnvelope, AdaptiveAuthorityController,
    AdaptiveResponseProofs, StressScenario, AuthorityStressEngine,
)

samples = [
    AuthorityDomainSample(
        "US", 1_000_000,
        reserved_usd_minor=100_000,
        committed_usd_minor=100_000,
        uncertain_usd_minor=50_000,
        pending_legitimate_demand_usd_minor=700_000,
        revocation_delay_seq=3,
        authority_velocity_usd_minor_per_seq=200_000,
        observation_lag_seq=3,
        dependency_ids=("issuer-1", "oracle-1"),
    ),
    AuthorityDomainSample(
        "EU", 600_000,
        reserved_usd_minor=50_000,
        pending_legitimate_demand_usd_minor=100_000,
        activation_delay_seq=2,
        revocation_delay_seq=1,
        authority_velocity_usd_minor_per_seq=100_000,
        observation_lag_seq=1,
        dependency_ids=("issuer-1",),
    ),
]

envelope = SafetyEnvelope(
    max_mrec_usd_minor=900_000,
    max_uncertain_usd_minor=25_000,
    max_authority_velocity_usd_minor_per_seq=100_000,
    max_observation_lag_seq=1,
    max_dependency_concentration_bps=8_000,
    max_pressure_bps=10_000,
)

metrics = AuthorityPhysicsV11.metrics(samples, horizon_seq=10)
assessment = ContinuousSafetyEnvelope.assess(metrics, envelope)
plan = AdaptiveAuthorityController.plan(samples, envelope, horizon_seq=10)
proof = AdaptiveResponseProofs.prove_non_expansion(plan)
stress = AuthorityStressEngine.simulate(samples, StressScenario("network-lag", observation_lag_add_seq=2), 10)

print("metrics", metrics)
print("compliant", assessment.compliant, assessment.breaches)
print("instructions", plan.instructions)
print("non_expansion", proof.valid, proof.proof_digest)
print("stress_mrec", stress.stressed_metrics.mrec_usd_minor)
