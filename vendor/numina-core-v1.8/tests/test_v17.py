import pytest
from numina import *


def market():
    m=ConstitutionalMarketRuntime('CLEAR')
    for d in ('A','B','C'):
        m.add_member(ClearingMember(d,1_000_000,200_000,500_000))
    return m


def test_netting_requires_explicit_right():
    m=market(); m.add_obligation(ClearingObligation('O1','A','B','USD',100,True))
    with pytest.raises(ConstitutionalMarketError): m.compute_netting('NOPE')


def test_netting_compresses_bilateral_without_erasing_gross():
    m=market(); m.add_obligation(ClearingObligation('O1','A','B','USD',100,True)); m.add_obligation(ClearingObligation('O2','B','A','USD',40,True))
    m.add_netting_right(NettingRight('N','CLEAR','USD',('A','B'),200))
    r=m.compute_netting('N'); assert r.gross_open==140 and r.bilateral_net==( ('A','B',60), ) and r.net_abs_exposure==60


def test_non_nettable_obligation_preserved_outside_netting():
    m=market(); m.add_obligation(ClearingObligation('O1','A','B','USD',100,False)); m.add_netting_right(NettingRight('N','CLEAR','USD',('A','B'),200))
    assert m.compute_netting('N').gross_open==0


def test_netting_right_gross_ceiling_enforced():
    m=market(); m.add_obligation(ClearingObligation('O1','A','B','USD',300,True)); m.add_netting_right(NettingRight('N','CLEAR','USD',('A','B'),200))
    with pytest.raises(ConstitutionalMarketError): m.compute_netting('N')


def test_collateral_haircut_is_integer_and_conservative():
    l=CollateralLot('L','A','USD',1000,2500); assert l.eligible_after_haircut==750


def test_collateral_reservation_encumbers_source():
    m=market(); m.add_collateral_lot(CollateralLot('L','A','USD',1000,0)); r=m.reserve_collateral('R','A',400,'MARGIN')
    assert r.eligible_amount==400 and m.collateral['L'].encumbered==400


def test_collateral_cannot_be_double_reserved():
    m=market(); m.add_collateral_lot(CollateralLot('L','A','USD',100,0)); m.reserve_collateral('R1','A',80,'MARGIN')
    with pytest.raises(ConstitutionalMarketError): m.reserve_collateral('R2','A',30,'MARGIN')


def test_failed_collateral_reservation_is_non_mutating():
    m=market(); m.add_collateral_lot(CollateralLot('L','A','USD',100,0)); before=m.state_root()
    with pytest.raises(ConstitutionalMarketError): m.reserve_collateral('R','A',200,'MARGIN')
    assert m.state_root()==before


def test_default_assessment_preserves_deficiency():
    m=market(); m.members['A']=ClearingMember('A',1_000,50,0); m.add_obligation(ClearingObligation('O','A','B','USD',200)); a=m.assess_default('A')
    assert a.deficiency==150 and a.state==ClearingState.MARGIN_DEFICIENT


def test_closeout_requires_preauthorized_authority():
    m=market(); m.add_obligation(ClearingObligation('O','A','B','USD',200))
    with pytest.raises(ConstitutionalMarketError): m.plan_closeout(CloseoutAuthority('C','A',100,('USD',),False),'USD')


def test_closeout_never_exceeds_pre_authorized_bound():
    m=market(); m.add_obligation(ClearingObligation('O','A','B','USD',200)); p=m.plan_closeout(CloseoutAuthority('C','A',75,('USD',),True),'USD')
    assert p.closeout_amount==75 and p.residual_obligation==125


def test_systemic_stress_is_cycle_safe():
    m=market(); m.add_contagion_edge(ContagionEdge('A','B',100)); m.add_contagion_edge(ContagionEdge('B','A',100)); r=m.systemic_stress('A',80)
    assert r.affected_domains==('B',) and r.total_propagated_consequence==80


def test_systemic_stress_narrows_per_edge():
    m=market(); m.add_contagion_edge(ContagionEdge('A','B',100)); m.add_contagion_edge(ContagionEdge('B','C',30)); r=m.systemic_stress('A',80)
    assert r.total_propagated_consequence==110 and r.max_path_consequence==110


def test_interinstitution_settlement_is_replay_protected():
    m=market(); m.add_obligation(ClearingObligation('O','A','B','USD',100)); p=InterInstitutionSettlementProof('P','CLEAR','O','A','B',100,'USD','OPEN','SATISFIED',1,'E')
    m.apply_settlement_proof(p)
    with pytest.raises(ConstitutionalMarketError): m.apply_settlement_proof(p)


def test_settlement_identity_mismatch_is_non_mutating():
    m=market(); m.add_obligation(ClearingObligation('O','A','B','USD',100)); before=m.state_root(); p=InterInstitutionSettlementProof('P','CLEAR','O','A','C',100,'USD','OPEN','SATISFIED',1,'E')
    with pytest.raises(ConstitutionalMarketError): m.apply_settlement_proof(p)
    assert m.state_root()==before


def test_settled_obligation_exits_default_exposure():
    m=market(); m.members['A']=ClearingMember('A',1_000,0,0); m.add_obligation(ClearingObligation('O','A','B','USD',100)); assert m.assess_default('A').deficiency==100
    p=InterInstitutionSettlementProof('P','CLEAR','O','A','B',100,'USD','OPEN','FINAL',1,'E'); m.apply_settlement_proof(p); assert m.assess_default('A').deficiency==0


def test_state_root_deterministic():
    a=market(); b=market(); assert a.state_root()==b.state_root()


def test_netting_digest_deterministic():
    m=market(); m.add_obligation(ClearingObligation('O','A','B','USD',100,True)); m.add_netting_right(NettingRight('N','CLEAR','USD',('A','B'),100)); assert m.compute_netting('N').digest==m.compute_netting('N').digest


def test_settlement_proof_wrong_domain_rejected():
    m=market(); m.add_obligation(ClearingObligation('O','A','B','USD',100)); p=InterInstitutionSettlementProof('P','OTHER','O','A','B',100,'USD','OPEN','SATISFIED',1,'E')
    with pytest.raises(ConstitutionalMarketError): m.apply_settlement_proof(p)


def test_default_does_not_create_new_right_or_capacity():
    m=market(); before=m.members['A']; m.add_obligation(ClearingObligation('O','A','B','USD',2_000_000)); a=m.assess_default('A')
    assert a.deficiency>0 and m.members['A']==before
