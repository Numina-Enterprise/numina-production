import pytest
from numina import *


def runtime_env():
    r = RightsRuntime()
    r.add_creation_authority(RightCreationAuthority('A','P','D0',('ROOT','CLAIM'),1_000_000,10_000_000,True))
    r.create_right('A', RightGenesisRequest('R','P','ROOT',RightKind.CONTROL,BackingKind.PROTOCOL_NATIVE,1_000,(),True,0))
    r.add_recognition_budget(RecognitionBudget('B1','D1','D0','ROOT',800))
    r.add_recognition_budget(RecognitionBudget('B2','D2','D0','ROOT',500))
    r.recognize_right('R','B1',800)
    r.recognize_right('R','B2',500)
    return r, InstitutionalRightsNetwork(r)


def test_recognition_surface_is_deterministic_and_explicit():
    r,n=runtime_env(); s=n.recognition_surface('R')
    assert s.domains==('D1','D2') and s.total_recognized_capacity==1300 and s.max_single_domain_capacity==800


def test_direct_propagation_cannot_widen_intrinsic_available():
    r,n=runtime_env(); p=n.propagation_proof('R','D1')
    assert p.effective_capacity==800 and p.effective_capacity <= r.rights['R'].available


def test_explicit_route_propagation_narrows_each_hop():
    r,n=runtime_env(); n.add_propagation_edge(RightPropagationEdge('D0','X','ROOT',700,True)); n.add_propagation_edge(RightPropagationEdge('X','Y','ROOT',300,True))
    p=n.propagation_proof('R','Y'); assert p.route==('D0','X','Y') and p.effective_capacity==300


def test_non_transitive_intermediate_blocks_propagation():
    r,n=runtime_env(); n.add_propagation_edge(RightPropagationEdge('D0','X','ROOT',700,False)); n.add_propagation_edge(RightPropagationEdge('X','Y','ROOT',300,True))
    with pytest.raises(InstitutionNetworkError): n.propagation_proof('R','Y')


def test_priority_waterfall_senior_claims_first():
    claims=(PriorityClaim('J','junior',70,10),PriorityClaim('S','senior',60,1))
    w=InstitutionalRightsNetwork.allocate_priority(100,claims)
    assert [(x.claim_id,x.allocated,x.deficiency) for x in w]==[('S',60,0),('J',40,30)]


def test_priority_waterfall_is_deterministic_on_tie():
    claims=(PriorityClaim('B','b',70,1),PriorityClaim('A','a',70,1))
    assert InstitutionalRightsNetwork.allocate_priority(80,claims)[0].claim_id=='A'


def test_solvency_assessment():
    a=InstitutionalRightsNetwork.assess_insolvency(100,(PriorityClaim('A','x',40,1),PriorityClaim('B','y',50,2)))
    assert a.state==InsolvencyState.SOLVENT and a.deficiency==0


def test_overcommit_assessment_preserves_deficiency():
    a=InstitutionalRightsNetwork.assess_insolvency(50,(PriorityClaim('A','x',80,1),))
    assert a.state==InsolvencyState.OVER_COMMITTED and a.deficiency==30


def test_zero_capacity_with_claims_is_insolvent():
    a=InstitutionalRightsNetwork.assess_insolvency(0,(PriorityClaim('A','x',1,1),))
    assert a.state==InsolvencyState.INSOLVENT


def test_contract_network_reachability_tracks_chain_consequence():
    r,n=runtime_env(); n.add_contract_edge(ContractNetworkEdge('O1','A','B',100)); n.add_contract_edge(ContractNetworkEdge('O2','B','C',200))
    x=n.network_reachability('A'); assert x.reachable_domains==('B','C') and x.gross_open_obligation==300 and x.max_path_consequence==300


def test_contract_network_cycles_do_not_inflate_reachability():
    r,n=runtime_env(); n.add_contract_edge(ContractNetworkEdge('O1','A','B',100)); n.add_contract_edge(ContractNetworkEdge('O2','B','A',900))
    x=n.network_reachability('A'); assert x.gross_open_obligation==100 and x.max_path_consequence==100


def settlement_env():
    r,n=runtime_env(); r.obligations['O']=RightsObligation('O','DEBT','CRED',250,'USD_MINOR','OPEN'); n.add_contract_edge(ContractNetworkEdge('O','DEBT','CRED',250,'OPEN'))
    p=SettlementProof('O','DEBT','CRED',250,'SETTLE-1',7,'OPEN')
    return r,n,p


def test_settlement_proof_satisfies_both_runtime_and_network_obligation():
    r,n,p=settlement_env(); n.apply_settlement_proof(p)
    assert r.obligations['O'].state=='SATISFIED' and n.contract_edges['O'].state=='SATISFIED'


def test_settlement_proof_replay_rejected():
    r,n,p=settlement_env(); n.apply_settlement_proof(p)
    with pytest.raises(InstitutionNetworkError): n.apply_settlement_proof(p)


def test_settlement_identity_mismatch_rejected_without_mutation():
    r,n,p=settlement_env(); before=r.obligations['O']
    bad=SettlementProof('O','DEBT','WRONG',250,'SETTLE-1',7,'OPEN')
    with pytest.raises(InstitutionNetworkError): n.apply_settlement_proof(bad)
    assert r.obligations['O']==before and n.contract_edges['O'].state=='OPEN'


def test_settled_edges_exit_open_reachability():
    r,n,p=settlement_env(); assert n.network_reachability('DEBT').gross_open_obligation==250; n.apply_settlement_proof(p); assert n.network_reachability('DEBT').gross_open_obligation==0


def test_authority_synthesis_is_bounded_by_recognition():
    r,n=runtime_env(); s=n.synthesize_authority('R','D2',900); assert s.synthesized_ceiling==500


def test_authority_synthesis_is_bounded_by_right_availability():
    r,n=runtime_env(); r.add_uncertainty('R',700); s=n.synthesize_authority('R','D1',800); assert s.synthesized_ceiling==300


def test_authority_synthesis_requires_recognition():
    r,n=runtime_env()
    with pytest.raises(InstitutionNetworkError): n.synthesize_authority('R','NOPE',100)


def test_authority_synthesis_digest_deterministic():
    r,n=runtime_env(); a=n.synthesize_authority('R','D1',100); b=n.synthesize_authority('R','D1',100); assert a.digest==b.digest


def test_propagation_proof_digest_deterministic():
    r,n=runtime_env(); assert n.propagation_proof('R','D1').digest==n.propagation_proof('R','D1').digest
