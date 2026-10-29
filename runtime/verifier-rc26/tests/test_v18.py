import pytest
from numina import *


def stability():
    m=ConstitutionalMarketRuntime('CLEAR')
    m.add_member(ClearingMember('A',2_000_000,100_000,1_000_000))
    m.add_member(ClearingMember('B',2_000_000,200_000,1_000_000))
    m.add_member(ClearingMember('C',2_000_000,50_000,1_000_000))
    m.add_obligation(ClearingObligation('O1','A','B','USD',1_000_000,True))
    m.add_obligation(ClearingObligation('O2','C','A','USD',400_000,True))
    m.add_collateral_lot(CollateralLot('CA','A','USD',500_000,2000))
    s=AutonomousClearingStabilityRuntime(m)
    s.set_margin_profile(MarginProfile('A',8000,1000,1_000_000,5))
    s.set_margin_profile(MarginProfile('B',8000,1000,1_000_000,5))
    s.set_margin_profile(MarginProfile('C',8000,1000,1_000_000,5))
    return s


def test_margin_assessment_is_deterministic():
    s=stability(); assert s.assess_margin('A').digest==s.assess_margin('A').digest


def test_margin_required_support_uses_integer_ceiling():
    s=stability(); a=s.assess_margin('A'); assert a.required_support==800_000


def test_margin_deficiency_preserved():
    s=stability(); a=s.assess_margin('A'); assert a.deficiency==300_000 and a.state==MarginState.CALL_REQUIRED


def test_margin_call_requires_actual_deficiency():
    s=stability();
    with pytest.raises(StabilityError): s.issue_margin_call('CB','B',1)


def test_margin_call_is_bounded_and_buffered():
    s=stability(); c=s.issue_margin_call('CA','A',10); assert c.amount==330_000 and c.deadline_sequence==15


def test_margin_call_replay_rejected():
    s=stability(); s.issue_margin_call('CA','A',10)
    with pytest.raises(StabilityError): s.issue_margin_call('CA','A',11)


def test_waterfall_uses_priority_order():
    s=stability(); s.add_waterfall_layer(WaterfallLayer('JUNIOR',300,2,'MUTUALIZED')); s.add_waterfall_layer(WaterfallLayer('DEFAULTER',100,1,'DEFAULTER'))
    r=s.allocate_waterfall(250); assert tuple(x.layer_id for x in r.uses)==('DEFAULTER','JUNIOR')


def test_waterfall_never_invents_capacity():
    s=stability(); s.add_waterfall_layer(WaterfallLayer('L1',100,1,'FUND')); r=s.allocate_waterfall(300); assert sum(x.amount for x in r.uses)==100 and r.residual_deficiency==200


def test_waterfall_preserves_source_root():
    s=stability(); s.add_waterfall_layer(WaterfallLayer('L1',100,1,'FUND')); assert s.allocate_waterfall(50).source_root==s.allocate_waterfall(50).source_root


def test_recovery_rejects_risk_adding_step():
    s=stability();
    with pytest.raises(StabilityError): s.build_recovery_plan('A',(RecoveryStep('X',1,'RISK_REDUCING',100,True),))


def test_recovery_rejects_unknown_action_class():
    s=stability();
    with pytest.raises(StabilityError): s.build_recovery_plan('A',(RecoveryStep('X',1,'SPECULATE',100,False),))


def test_recovery_can_reduce_deficiency_without_erasing_provenance():
    s=stability(); p=s.build_recovery_plan('A',(RecoveryStep('COL',1,'COLLATERALIZATION',100_000),RecoveryStep('PAY',2,'OBLIGATION_SATISFYING',50_000)))
    assert p.initial_deficiency==300_000 and p.projected_residual_deficiency==150_000


def test_systemic_envelope_counts_open_gross_obligations():
    s=stability(); e=s.systemic_envelope(); assert e.total_open_obligations==1_400_000


def test_systemic_envelope_identifies_deficient_domains():
    s=stability(); e=s.systemic_envelope(); assert 'A' in e.domains_in_deficiency and 'C' in e.domains_in_deficiency


def test_settled_obligation_reduces_systemic_open_obligations():
    s=stability(); before=s.systemic_envelope().total_open_obligations
    p=InterInstitutionSettlementProof('P','CLEAR','O2','C','A',400_000,'USD','OPEN','FINAL',1,'E'); s.market.apply_settlement_proof(p)
    assert s.systemic_envelope().total_open_obligations==before-400_000


def test_crisis_non_amplification_accepts_contraction():
    p=AutonomousClearingStabilityRuntime.prove_non_amplification(1000,600,500,500,True,'R'); assert p.valid


def test_crisis_non_amplification_rejects_risk_expansion():
    p=AutonomousClearingStabilityRuntime.prove_non_amplification(1000,1001,500,500,True,'R'); assert not p.valid


def test_crisis_non_amplification_requires_uncertainty_preservation():
    p=AutonomousClearingStabilityRuntime.prove_non_amplification(1000,500,500,0,False,'R'); assert not p.valid


def test_margin_state_changes_after_valid_settlement():
    s=stability(); assert s.assess_margin('C').deficiency>0
    p=InterInstitutionSettlementProof('P','CLEAR','O2','C','A',400_000,'USD','OPEN','FINAL',1,'E'); s.market.apply_settlement_proof(p)
    assert s.assess_margin('C').state==MarginState.HEALTHY


def test_stability_runtime_does_not_mutate_market_when_assessing():
    s=stability(); before=s.market.state_root(); s.assess_margin('A'); s.systemic_envelope(); assert s.market.state_root()==before
