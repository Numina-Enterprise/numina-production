from numina_core import (
    AuthorityDomainSample, AuthorityAdjustment, HomeostasisTarget,
    PredictiveAuthorityController, GovernedExpansion,
    StressScenario, SafetyEnvelope, CounterfactualShadowEngine,
    ConstitutionalChaosEngine,
)

samples = [
    AuthorityDomainSample("US", 1_000_000, reserved_usd_minor=100_000,
                          pending_legitimate_demand_usd_minor=700_000,
                          authority_velocity_usd_minor_per_seq=100_000,
                          observation_lag_seq=1, dependency_ids=("issuer-1",)),
    AuthorityDomainSample("EU", 600_000, reserved_usd_minor=50_000,
                          pending_legitimate_demand_usd_minor=100_000,
                          authority_velocity_usd_minor_per_seq=50_000,
                          observation_lag_seq=1, dependency_ids=("issuer-1",)),
]

target = HomeostasisTarget(
    target_liquidity_usd_minor=900_000,
    target_pressure_bps=5_000,
    target_uncertainty_usd_minor=0,
    target_observation_lag_seq=1,
    target_dependency_concentration_bps=8_000,
    max_horizon_mrec_usd_minor=1_500_000,
)

candidates = (
    ("hold", ()),
    ("contract-us", (AuthorityAdjustment("US", 800_000, 75_000, "reduce-reachability"),)),
    ("expand-us", (AuthorityAdjustment("US", 1_200_000, 125_000, "demand"),)),
)

trajectories = PredictiveAuthorityController.evaluate(samples, target, candidates, 10)
automatic = PredictiveAuthorityController.choose_automatic(trajectories)
expansion = GovernedExpansion.propose(
    samples,
    (AuthorityAdjustment("US", 1_200_000, 125_000, "demand"),),
    "expansion-1",
    "increase bounded US operating authority",
)
proof = GovernedExpansion.make_proof(expansion, ("treasury-a", "treasury-b"), 2, 7)
expansion_authorized = GovernedExpansion.authorize(expansion, proof, 7, 1_800_000)

envelope = SafetyEnvelope(2_000_000, 200_000, 200_000, 5, 10_000, 100_000)
shadows = CounterfactualShadowEngine.run(
    samples,
    (StressScenario("network-lag", observation_lag_add_seq=3),
     StressScenario("uncertainty", uncertainty_add_usd_minor=250_000)),
    envelope,
    10,
)
chaos = ConstitutionalChaosEngine.run(
    samples,
    (("CONTRACT", "US", 750_000), ("ADD_LAG", "EU", 2), ("CONTRACT_VELOCITY", "US", 50_000)),
    "chaos-1",
)

print("automatic", automatic.trajectory_id, automatic.requires_governance)
print("expansion_authorized", expansion_authorized)
print("shadow_universes", [(x.scenario_id, x.envelope_assessment.compliant) for x in shadows])
print("chaos_passed", chaos.passed)
