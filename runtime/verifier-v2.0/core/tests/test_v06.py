from numina.federation import SovereignDomain, RecognitionBridge, bridge_intersection
from numina.composition import AuthorityGrant, MultiPrincipalPolicy, CoalitionPolicy, authorize_multi_principal, coalition_authorized
from numina.routing import AuthorityRouteEdge, resolve_authority_route
from numina.systemic import DomainExposure, systemic_mrec, correlated_dependency_concentration, composition_emergence
from numina.reachability import ReachabilityEdge


def test_bridge_intersection_only_narrows():
    a=SovereignDomain('A','c',frozenset({'i1','i2'}),frozenset({'PAY','HEDGE'}),'US')
    b=SovereignDomain('B','c',frozenset({'i2','i3'}),frozenset({'PAY'}),'EU')
    br=RecognitionBridge('ab','A','B',frozenset({'i2'}),frozenset({'PAY'}),1000)
    issuers,classes=bridge_intersection(a,b,br)
    assert issuers==frozenset({'i2'}) and classes==frozenset({'PAY'})
    assert br.recognizes(issuer='i2',authority_class='PAY',consequence_usd_minor=999)
    assert not br.recognizes(issuer='i1',authority_class='PAY',consequence_usd_minor=999)

def test_multi_principal_threshold_and_bounds():
    gs=[AuthorityGrant('g1','p1',frozenset({'JV'}),1000),AuthorityGrant('g2','p2',frozenset({'JV'}),1000)]
    p=MultiPrincipalPolicy(frozenset({'p1','p2','p3'}),2,900)
    assert authorize_multi_principal(gs,p,authority_class='JV',consequence_usd_minor=800)[0]
    assert authorize_multi_principal(gs[:1],p,authority_class='JV',consequence_usd_minor=800)[1]=='MULTI_PRINCIPAL_THRESHOLD_NOT_MET'
    assert authorize_multi_principal(gs,p,authority_class='JV',consequence_usd_minor=950)[1]=='MULTI_PRINCIPAL_BOUND_EXCEEDED'

def test_coalition_requires_explicit_composition_right():
    p=CoalitionPolicy('c',frozenset({'a','b'}),frozenset({'PROCURE_AND_PAY'}),500)
    assert coalition_authorized(p,participants=['a','b'],joint_action='PROCURE_AND_PAY',aggregate_consequence_usd_minor=400)[0]
    assert not coalition_authorized(p,participants=['a','b'],joint_action='UNBOUNDED',aggregate_consequence_usd_minor=400)[0]

def test_route_nontransitive_default():
    edges=[AuthorityRouteEdge('A','B',frozenset({'PAY'}),1000,1,True),AuthorityRouteEdge('B','C',frozenset({'PAY'}),1000,1,True)]
    assert resolve_authority_route(edges,source='A',target='C',authority_class='PAY',consequence_usd_minor=100) is None
    r=resolve_authority_route(edges,source='A',target='C',authority_class='PAY',consequence_usd_minor=100,allow_multihop=True)
    assert r.nodes==('A','B','C') and r.total_cost==2

def test_route_respects_consequence_bound():
    edges=[AuthorityRouteEdge('A','B',frozenset({'PAY'}),100)]
    assert resolve_authority_route(edges,source='A',target='B',authority_class='PAY',consequence_usd_minor=101) is None

def test_systemic_mrec_is_conservative_sum():
    e=[DomainExposure('A',100,frozenset({'oracle'})),DomainExposure('B',250,frozenset({'oracle','issuer'}))]
    assert systemic_mrec(e)==350
    c=correlated_dependency_concentration(e)
    assert c['oracle']==1.0 and c['issuer']==250/350

def test_composition_emergence_detects_new_reachability():
    individual=[ReachabilityEdge('P','A',100)]
    composed=individual+[ReachabilityEdge('A','B',250)]
    r=composition_emergence(individual,composed,'P')
    assert r['individual_mrec']==100 and r['composed_mrec']==350 and r['emergent_delta']==250
