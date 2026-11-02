import pytest
from numina_core import (
    AuthorityDomainSample, AuthorityAdjustment, HomeostasisTarget,
    PredictiveAuthorityController, GovernedExpansion, ConstitutionalError,
    StressScenario, SafetyEnvelope, CounterfactualShadowEngine,
    ConstitutionalChaosEngine, AuthorityPhysicsV11,
)


def sample(domain="A", live=1000, *, occupied=0, demand=0, velocity=100, lag=1, deps=()):
    return AuthorityDomainSample(
        domain, live,
        reserved_usd_minor=occupied,
        pending_legitimate_demand_usd_minor=demand,
        authority_velocity_usd_minor_per_seq=velocity,
        observation_lag_seq=lag,
        dependency_ids=deps,
    )


def target(max_mrec=10_000):
    return HomeostasisTarget(500, 5_000, 0, 1, 5_000, max_mrec)


def envelope():
    return SafetyEnvelope(
        max_mrec_usd_minor=2_000,
        max_uncertain_usd_minor=500,
        max_authority_velocity_usd_minor_per_seq=500,
        max_observation_lag_seq=5,
        max_dependency_concentration_bps=10_000,
        max_pressure_bps=100_000,
    )


def test_predictive_controller_is_deterministic():
    xs=[sample(demand=600)]
    c=(('hold',()),('contract',(AuthorityAdjustment('A',800,80,'risk'),)))
    a=PredictiveAuthorityController.evaluate(xs,target(),c,5)
    b=PredictiveAuthorityController.evaluate(xs,target(),c,5)
    assert [x.trajectory_digest for x in a]==[x.trajectory_digest for x in b]


def test_predictive_controller_marks_expansion_governed():
    xs=[sample()]
    c=(('expand',(AuthorityAdjustment('A',1200,100,'demand'),)),)
    t=PredictiveAuthorityController.evaluate(xs,target(),c,5)[0]
    assert t.requires_governance


def test_automatic_choice_never_selects_expansion():
    xs=[sample()]
    c=(
        ('expand',(AuthorityAdjustment('A',1200,100,'demand'),)),
        ('hold',()),
        ('contract',(AuthorityAdjustment('A',900,90,'risk'),)),
    )
    chosen=PredictiveAuthorityController.choose_automatic(PredictiveAuthorityController.evaluate(xs,target(),c,5))
    assert not chosen.requires_governance


def test_predictive_trajectory_cannot_erase_occupied_consequence():
    xs=[sample(occupied=700)]
    c=(('bad',(AuthorityAdjustment('A',600,50,'bad'),)),)
    with pytest.raises(ConstitutionalError):
        PredictiveAuthorityController.evaluate(xs,target(),c,5)


def test_governed_expansion_requires_real_expansion():
    xs=[sample()]
    with pytest.raises(ConstitutionalError):
        GovernedExpansion.propose(xs,(AuthorityAdjustment('A',900,90,'contract'),),'p','x')


def test_governed_expansion_threshold_enforced():
    xs=[sample()]
    p=GovernedExpansion.propose(xs,(AuthorityAdjustment('A',1200,100,'growth'),),'p','need capacity')
    proof=GovernedExpansion.make_proof(p,('alice',),2,7)
    assert not GovernedExpansion.authorize(p,proof,7,2_000)


def test_governed_expansion_epoch_enforced():
    xs=[sample()]
    p=GovernedExpansion.propose(xs,(AuthorityAdjustment('A',1200,100,'growth'),),'p','need capacity')
    proof=GovernedExpansion.make_proof(p,('alice','bob'),2,7)
    assert not GovernedExpansion.authorize(p,proof,8,2_000)


def test_governed_expansion_parent_conservation_enforced():
    xs=[sample()]
    p=GovernedExpansion.propose(xs,(AuthorityAdjustment('A',1200,100,'growth'),),'p','need capacity')
    proof=GovernedExpansion.make_proof(p,('alice','bob'),2,7)
    assert not GovernedExpansion.authorize(p,proof,7,1_100)
    assert GovernedExpansion.authorize(p,proof,7,1_200)


def test_governance_approvers_are_distinct():
    xs=[sample()]
    p=GovernedExpansion.propose(xs,(AuthorityAdjustment('A',1200,100,'growth'),),'p','need capacity')
    proof=GovernedExpansion.make_proof(p,('alice','alice','bob'),2,7)
    assert proof.approver_ids==('alice','bob')


def test_shadow_universes_are_sorted_and_deterministic():
    xs=[sample()]
    scenarios=(StressScenario('z',observation_lag_add_seq=2),StressScenario('a',uncertainty_add_usd_minor=100))
    u1=CounterfactualShadowEngine.run(xs,scenarios,envelope(),5)
    u2=CounterfactualShadowEngine.run(xs,scenarios,envelope(),5)
    assert [u.scenario_id for u in u1]==['a','z']
    assert [u.universe_digest for u in u1]==[u.universe_digest for u in u2]


def test_shadow_universe_does_not_mutate_live_samples():
    xs=[sample(live=1000)]
    before=AuthorityPhysicsV11.metrics(xs,5).digest()
    CounterfactualShadowEngine.run(xs,(StressScenario('stress',authority_multiplier_bps=5000),),envelope(),5)
    after=AuthorityPhysicsV11.metrics(xs,5).digest()
    assert before==after


def test_chaos_contraction_preserves_non_expansion():
    xs=[sample(live=1000,velocity=100)]
    r=ConstitutionalChaosEngine.run(xs,(('CONTRACT','A',700),('CONTRACT_VELOCITY','A',50)),'c1')
    assert r.passed
    assert r.maximum_observed_authority_usd_minor<=r.initial_authority_usd_minor


def test_chaos_uncertainty_does_not_create_reusable_authority():
    xs=[sample(live=1000,occupied=100)]
    r=ConstitutionalChaosEngine.run(xs,(('ADD_UNCERTAINTY','A',200),),'c2')
    assert r.passed


def test_chaos_invalid_fault_is_reported():
    xs=[sample()]
    r=ConstitutionalChaosEngine.run(xs,(('EXPAND','A',5000),),'c3')
    assert not r.passed
    assert r.invariant_failures==('INVALID_FAULT:1',)


def test_chaos_unknown_domain_is_reported():
    xs=[sample()]
    r=ConstitutionalChaosEngine.run(xs,(('CONTRACT','B',1),),'c4')
    assert not r.passed


def test_homeostasis_target_rejects_negative_values():
    with pytest.raises(ConstitutionalError):
        HomeostasisTarget(-1,0,0,0,0,0)


def test_predictive_candidate_unknown_domain_rejected():
    xs=[sample()]
    c=(('x',(AuthorityAdjustment('NOPE',1,1,'x'),)),)
    with pytest.raises(ConstitutionalError):
        PredictiveAuthorityController.evaluate(xs,target(),c,5)


def test_expansion_proof_binding_rejects_wrong_proposal():
    xs=[sample()]
    p1=GovernedExpansion.propose(xs,(AuthorityAdjustment('A',1200,100,'g'),),'p1','j')
    p2=GovernedExpansion.propose(xs,(AuthorityAdjustment('A',1300,100,'g'),),'p2','j')
    proof=GovernedExpansion.make_proof(p1,('a','b'),2,1)
    assert not GovernedExpansion.authorize(p2,proof,1,5000)


def test_predictive_invalid_mrec_not_eligible_automatic():
    xs=[sample(live=1000,velocity=0)]
    c=(('hold',()),)
    ts=PredictiveAuthorityController.evaluate(xs,target(max_mrec=100),c,5)
    assert not ts[0].constitutionally_valid
    with pytest.raises(ConstitutionalError):
        PredictiveAuthorityController.choose_automatic(ts)


def test_authority_adjustment_rejects_negative():
    with pytest.raises(ConstitutionalError):
        AuthorityAdjustment('A',-1,0,'x')
