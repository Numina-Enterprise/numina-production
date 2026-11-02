from numina.control_mesh import ProofCarryingEndpointContract, EndpointDecision, MeshEdge, EconomicControlMesh
from numina.channels import AuthorityChannelPolicy, AuthoritySession, consume_session, reset_velocity_window, close_session
from numina.obligations import BilateralObligation, ObligationState, transition_obligation
from numina.peering import AuthorityPeeringPolicy
from numina.network_state import NetworkAuthorityNode, NetworkAuthorityEdge, continuous_network_reachability


def contract(endpoint='ep', domain='A', maxc=1000, age=100):
    return ProofCarryingEndpointContract(endpoint,domain,frozenset({'PAY'}),maxc,frozenset({'c1'}),frozenset({'i1'}),age)


def test_endpoint_contract_validates_full_authority_frame():
    d,r=contract().verify_request(authority_class='PAY',consequence_usd_minor=500,constitution_digest='c1',issuer='i1',status_age_ms=10)
    assert d==EndpointDecision.VALID_FOR_COMMIT and r=='OK'


def test_endpoint_contract_stale_status_requires_revalidation_not_allow():
    d,r=contract().verify_request(authority_class='PAY',consequence_usd_minor=500,constitution_digest='c1',issuer='i1',status_age_ms=101)
    assert d==EndpointDecision.REVALIDATION_REQUIRED and r=='STATUS_TOO_OLD'


def test_endpoint_contract_bound_is_fail_closed():
    assert contract().verify_request(authority_class='PAY',consequence_usd_minor=1001,constitution_digest='c1',issuer='i1',status_age_ms=1)[0]==EndpointDecision.INVALID


def test_control_mesh_requires_every_edge_to_cover_authority_class_and_bound():
    eps=[contract('a','A',1000),contract('b','B',1000),contract('c','C',1000)]
    mesh=EconomicControlMesh(eps,[MeshEdge('a','b',frozenset({'PAY'}),800),MeshEdge('b','c',frozenset({'PAY'}),600)])
    p=mesh.path('a','c','PAY',500)
    assert p.endpoints==('a','b','c') and p.limiting_consequence_usd_minor==600
    assert mesh.path('a','c','PAY',700) is None


def test_authority_session_consumes_aggregate_and_nonce_once():
    p=AuthorityChannelPolicy('ch','A','B',frozenset({'PAY'}),1000,600,800,50)
    s=AuthoritySession('s',p,1)
    s,r=consume_session(s,authority_class='PAY',consequence_usd_minor=500,operation_nonce='n1',current_sequence=2)
    assert r=='OK' and s.remaining_usd_minor==500
    s2,r=consume_session(s,authority_class='PAY',consequence_usd_minor=1,operation_nonce='n1',current_sequence=3)
    assert r=='SESSION_NONCE_REPLAY' and s2==s


def test_authority_session_velocity_is_independent_constraint():
    p=AuthorityChannelPolicy('ch','A','B',frozenset({'PAY'}),2000,1000,700,50)
    s=AuthoritySession('s',p,1)
    s,_=consume_session(s,authority_class='PAY',consequence_usd_minor=500,operation_nonce='n1',current_sequence=2)
    _,r=consume_session(s,authority_class='PAY',consequence_usd_minor=300,operation_nonce='n2',current_sequence=3)
    assert r=='SESSION_VELOCITY_BOUND_EXCEEDED'
    s=reset_velocity_window(s)
    _,r=consume_session(s,authority_class='PAY',consequence_usd_minor=300,operation_nonce='n2',current_sequence=4)
    assert r=='OK'


def test_closed_or_expired_session_cannot_commit():
    p=AuthorityChannelPolicy('ch','A','B',frozenset({'PAY'}),1000,1000,1000,5)
    s=AuthoritySession('s',p,1)
    assert consume_session(s,authority_class='PAY',consequence_usd_minor=1,operation_nonce='n',current_sequence=6)[1]=='SESSION_EXPIRED'
    assert consume_session(close_session(s),authority_class='PAY',consequence_usd_minor=1,operation_nonce='n',current_sequence=2)[1]=='SESSION_CLOSED'


def test_obligation_lifecycle_is_monotonic_and_final_immutable():
    o=BilateralObligation('o','B','A','USD',500,'auth','op')
    for state in (ObligationState.BILATERALLY_COMMITTED,ObligationState.EXECUTED,ObligationState.SETTLED,ObligationState.FINAL):
        o,r=transition_obligation(o,state,evidence_ref=state.value)
        assert r=='OK'
    o2,r=transition_obligation(o,ObligationState.DISPUTED)
    assert r=='FINAL_OBLIGATION_IMMUTABLE' and o2==o


def test_obligation_cannot_jump_from_recognized_to_settled():
    o=BilateralObligation('o','B','A','USD',500,'auth','op')
    assert transition_obligation(o,ObligationState.SETTLED)[1]=='INVALID_OBLIGATION_TRANSITION'


def test_dispute_preserves_obligation_instead_of_erasing_it():
    o=BilateralObligation('o','B','A','USD',500,'auth','op')
    d,r=transition_obligation(o,ObligationState.DISPUTED,evidence_ref='conflict')
    assert r=='OK' and d.amount_minor==500 and d.state==ObligationState.DISPUTED and 'conflict' in d.evidence_refs


def test_peering_is_explicit_intersection_not_ambient_trust():
    p=AuthorityPeeringPolicy('A','B',frozenset({'c1'}),frozenset({'PAY'}),frozenset({'i1'}),1000,50)
    assert p.recognizes(constitution_digest='c1',authority_class='PAY',issuer='i1',open_obligations_usd_minor=900,status_age_ms=10)
    assert not p.recognizes(constitution_digest='c1',authority_class='PAY',issuer='i2',open_obligations_usd_minor=900,status_age_ms=10)


def test_network_reachability_reports_conservative_mrec_and_occupancy():
    ns=[NetworkAuthorityNode('A',1000,100,50),NetworkAuthorityNode('B',0,200,0),NetworkAuthorityNode('C',0,0,25)]
    es=[NetworkAuthorityEdge('A','B',500),NetworkAuthorityEdge('B','C',250)]
    r=continuous_network_reachability(ns,es,'A')
    assert r['reachable_nodes']==frozenset({'A','B','C'})
    assert r['mrec_usd_minor']==1750
    assert r['occupied_usd_minor']==375
