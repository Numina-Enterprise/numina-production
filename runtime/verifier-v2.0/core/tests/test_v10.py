import pytest
from numina.authority_physics import *


def e(i,s,t,cap,delay=0,velocity=0,risk=True,deps=frozenset()):
    return AuthorityFieldEdge(i,s,t,cap,delay,velocity,risk,deps)


def test_horizon_mrec_respects_activation_delay():
    rt=AuthorityPhysicsRuntime([e('a','root','agent',1000,delay=5)])
    assert rt.horizon_reachability('root',4).mrec_usd_minor==0
    assert rt.horizon_reachability('root',5).mrec_usd_minor==1000


def test_horizon_mrec_respects_velocity():
    rt=AuthorityPhysicsRuntime([e('a','root','agent',1000,velocity=100)])
    assert rt.horizon_reachability('root',0).mrec_usd_minor==100
    assert rt.horizon_reachability('root',4).mrec_usd_minor==500
    assert rt.horizon_reachability('root',100).mrec_usd_minor==1000


def test_simple_path_cycles_cannot_manufacture_mrec():
    rt=AuthorityPhysicsRuntime([e('a','A','B',100),e('b','B','A',100),e('c','B','C',50)])
    assert rt.horizon_reachability('A',10).mrec_usd_minor==150


def test_risk_reducing_edge_excluded_from_default_mrec():
    rt=AuthorityPhysicsRuntime([e('a','A','B',100,risk=False)])
    assert rt.horizon_reachability('A',10).mrec_usd_minor==0
    assert rt.horizon_reachability('A',10,risk_adding_only=False).mrec_usd_minor==100


def test_authority_liquidity_is_horizon_specific():
    buckets=[AuthorityLiquidityBucket('now',100,0),AuthorityLiquidityBucket('later',400,5)]
    assert authority_liquidity(buckets,0)==100
    assert authority_liquidity(buckets,5)==500


def test_dependency_concentration_is_integer_basis_points():
    xs=[e('a','A','B',600,deps=frozenset({'oracle'})),e('b','A','C',400,deps=frozenset({'other'}))]
    assert dependency_concentration_bps(xs)=={'oracle':6000,'other':4000}


def test_parallel_path_gradient_detected_without_float():
    xs=[e('a','A','B',1000),e('b','A','B',250)]
    assert authority_gradient_bps(xs)==7500


def test_structural_entropy_grows_with_branching_and_dependencies():
    low=[e('a','A','B',100)]
    high=[e('a','A','B',100,deps=frozenset({'x'})),e('b','A','C',100,deps=frozenset({'y'}))]
    assert structural_entropy_index(high)>structural_entropy_index(low)


def test_min_cut_one_for_single_path():
    rt=AuthorityPhysicsRuntime([e('a','A','B',100),e('b','B','C',100)])
    assert rt.compromise_min_cut_size('A','C')==1


def test_min_cut_two_for_two_independent_paths():
    rt=AuthorityPhysicsRuntime([
        e('a','A','B',100),e('b','B','D',100),
        e('c','A','C',100),e('d','C','D',100),
    ])
    assert rt.compromise_min_cut_size('A','D')==2


def test_safety_envelope_passes_and_has_deterministic_proof():
    rt=AuthorityPhysicsRuntime([e('a','A','B',100,deps=frozenset({'x'}))])
    m=rt.metrics('A','B',10,[AuthorityLiquidityBucket('cash',200,0)])
    env=SafetyEnvelope(max_mrec_usd_minor=100,min_authority_liquidity_usd_minor=200,max_entropy_index=1000,max_dependency_concentration_bps=10000,max_authority_gradient_bps=10000,min_compromise_cut_size=1)
    p1=prove_safety_envelope(m,env); p2=prove_safety_envelope(m,env)
    assert p1.valid and p1.proof_digest==p2.proof_digest


def test_safety_envelope_fails_closed_on_multiple_dimensions():
    rt=AuthorityPhysicsRuntime([e('a','A','B',1000,deps=frozenset({'shared'}))])
    m=rt.metrics('A','B',10,[])
    env=SafetyEnvelope(max_mrec_usd_minor=100,min_authority_liquidity_usd_minor=1,max_dependency_concentration_bps=5000,min_compromise_cut_size=2)
    p=prove_safety_envelope(m,env)
    assert not p.valid
    assert {'MREC_EXCEEDED','AUTHORITY_LIQUIDITY_BELOW_MINIMUM','DEPENDENCY_CONCENTRATION_EXCEEDED','COMPROMISE_MIN_CUT_TOO_SMALL'} <= set(p.violations)


def test_metrics_digest_changes_when_field_changes():
    a=AuthorityPhysicsRuntime([e('a','A','B',100)]).metrics('A','B',10)
    b=AuthorityPhysicsRuntime([e('a','A','B',101)]).metrics('A','B',10)
    assert a.metrics_digest!=b.metrics_digest


def test_duplicate_edge_ids_rejected():
    with pytest.raises(ValueError):
        AuthorityPhysicsRuntime([e('a','A','B',1),e('a','A','C',1)])


def test_negative_physics_values_rejected():
    with pytest.raises(ValueError):
        e('a','A','B',-1)
