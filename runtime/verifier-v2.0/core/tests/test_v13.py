import pytest
from numina_core import (
    ConstitutionalError, InstitutionalRight, InstitutionalAuthorityDomain,
    InstitutionalObligation, InstitutionalRecognitionEdge, InstitutionalRecoveryPath,
    InstitutionIR, InstitutionalCompiler, InstitutionBuildClass, InstitutionLifecycle,
)


def base_ir(**overrides):
    data=dict(
        institution_id='NUMINA-INST-1', constitution_digest='constitution-x', semantics_digest='semantics-x',
        principals=('P', 'C'),
        rights=(InstitutionalRight('R','P','CAPITAL',1_000_000),),
        authority_domains=(InstitutionalAuthorityDomain('D','P','R',600_000,100_000,50_000,600_000,1),),
        obligations=(InstitutionalObligation('O','P','C',100_000),),
        recognition_edges=(),
        recovery_paths=(InstitutionalRecoveryPath('REC',('D',)),),
        child_build_digests=(),
    )
    data.update(overrides)
    return InstitutionIR(**data)


def test_compile_is_deterministic():
    a=InstitutionalCompiler.compile(base_ir()); b=InstitutionalCompiler.compile(base_ir())
    assert a.build_digest==b.build_digest


def test_base_institution_viable():
    b=InstitutionalCompiler.compile(base_ir())
    assert b.viability.viable
    assert b.total_active_authority_usd_minor==600_000


def test_authority_cannot_exceed_supporting_right():
    ir=base_ir(authority_domains=(InstitutionalAuthorityDomain('D','P','R',1_100_000),))
    b=InstitutionalCompiler.compile(ir)
    assert not b.viability.authority_conserved
    assert 'AUTHORITY_EXCEEDS_RIGHT:R' in b.viability.violations


def test_derived_right_cannot_expand_parent():
    rights=(InstitutionalRight('R','P','ROOT',1_000),InstitutionalRight('C','P','CHILD',2_000,('R',)))
    b=InstitutionalCompiler.compile(base_ir(rights=rights,authority_domains=(InstitutionalAuthorityDomain('D','P','C',500),)))
    assert not b.viability.rights_valid


def test_missing_right_source_detected():
    rights=(InstitutionalRight('C','P','CHILD',500,('MISSING',)),)
    b=InstitutionalCompiler.compile(base_ir(rights=rights,authority_domains=(InstitutionalAuthorityDomain('D','P','C',100),)))
    assert any(v.startswith('MISSING_SOURCE_RIGHT') for v in b.viability.violations)


def test_right_cycle_detected():
    rights=(InstitutionalRight('A','P','X',100,('B',)),InstitutionalRight('B','P','X',100,('A',)))
    b=InstitutionalCompiler.compile(base_ir(rights=rights,authority_domains=()))
    assert any(v.startswith('RIGHT_LINEAGE_CYCLE') for v in b.viability.violations)


def test_recognition_cannot_widen_source():
    rec=(InstitutionalRecognitionEdge('D','D2',700_000),)
    ds=(InstitutionalAuthorityDomain('D','P','R',600_000),InstitutionalAuthorityDomain('D2','P','R',100_000))
    b=InstitutionalCompiler.compile(base_ir(authority_domains=ds,recognition_edges=rec,recovery_paths=(InstitutionalRecoveryPath('REC',('D','D2')),)))
    assert not b.viability.recognition_bounded


def test_recovery_may_not_expand_risk():
    rp=(InstitutionalRecoveryPath('REC',('D',),True,True),)
    b=InstitutionalCompiler.compile(base_ir(recovery_paths=rp))
    assert not b.viability.recovery_reachable


def test_recovery_must_cover_domains():
    b=InstitutionalCompiler.compile(base_ir(recovery_paths=()))
    assert not b.viability.recovery_reachable


def test_unknown_obligation_principal_detected():
    obs=(InstitutionalObligation('O','P','OUTSIDE',100),)
    b=InstitutionalCompiler.compile(base_ir(obligations=obs))
    assert not b.viability.obligations_preserved


def test_institution_mrec_preserves_open_obligations():
    b=InstitutionalCompiler.compile(base_ir())
    assert b.mrec_usd_minor==700_000


def test_behavior_preserving_diff():
    d=InstitutionalCompiler.diff(base_ir(),base_ir())
    assert d.build_class==InstitutionBuildClass.BEHAVIOR_PRESERVING


def test_authority_expansive_diff():
    old=base_ir()
    new=base_ir(authority_domains=(InstitutionalAuthorityDomain('D','P','R',700_000,100_000,50_000,700_000,1),))
    d=InstitutionalCompiler.diff(old,new)
    assert d.build_class==InstitutionBuildClass.AUTHORITY_EXPANSIVE


def test_rights_expansive_diff():
    old=base_ir()
    rights=old.rights+(InstitutionalRight('R2','P','OTHER',50_000),)
    new=base_ir(rights=rights)
    assert InstitutionalCompiler.diff(old,new).build_class==InstitutionBuildClass.RIGHTS_EXPANSIVE


def test_contractive_diff():
    old=base_ir()
    new=base_ir(authority_domains=(InstitutionalAuthorityDomain('D','P','R',500_000,100_000,50_000,500_000,1),))
    assert InstitutionalCompiler.diff(old,new).build_class==InstitutionBuildClass.CONTRACTIVE


def test_launch_requires_viable_build():
    bad=InstitutionalCompiler.compile(base_ir(recovery_paths=()))
    proof=InstitutionalCompiler.make_launch_proof(bad,1,('a','b'),2)
    with pytest.raises(ConstitutionalError): InstitutionalCompiler.launch(bad,proof,1,1)


def test_launch_threshold_and_epoch():
    b=InstitutionalCompiler.compile(base_ir())
    p=InstitutionalCompiler.make_launch_proof(b,3,('a',),2)
    with pytest.raises(ConstitutionalError): InstitutionalCompiler.launch(b,p,3,1)
    p2=InstitutionalCompiler.make_launch_proof(b,3,('a','b'),2)
    with pytest.raises(ConstitutionalError): InstitutionalCompiler.launch(b,p2,4,1)


def test_launch_build_binding():
    b1=InstitutionalCompiler.compile(base_ir())
    b2=InstitutionalCompiler.compile(base_ir(institution_id='OTHER'))
    p=InstitutionalCompiler.make_launch_proof(b1,1,('a','b'),2)
    with pytest.raises(ConstitutionalError): InstitutionalCompiler.launch(b2,p,1,1)


def test_valid_lifecycle_wind_down_chain():
    b=InstitutionalCompiler.compile(base_ir(obligations=()))
    p=InstitutionalCompiler.make_launch_proof(b,1,('a','b'),2)
    x=InstitutionalCompiler.launch(b,p,1,1)
    x=InstitutionalCompiler.transition_lifecycle(x,InstitutionLifecycle.WIND_DOWN,2)
    x=InstitutionalCompiler.transition_lifecycle(x,InstitutionLifecycle.OBLIGATION_ONLY,3)
    x=InstitutionalCompiler.transition_lifecycle(x,InstitutionLifecycle.RECONCILIATION_ONLY,4)
    x=InstitutionalCompiler.transition_lifecycle(x,InstitutionLifecycle.DISSOLVED,5)
    assert x.lifecycle==InstitutionLifecycle.DISSOLVED


def test_cannot_dissolve_with_open_obligations():
    b=InstitutionalCompiler.compile(base_ir())
    p=InstitutionalCompiler.make_launch_proof(b,1,('a','b'),2)
    x=InstitutionalCompiler.launch(b,p,1,1)
    x=InstitutionalCompiler.transition_lifecycle(x,InstitutionLifecycle.WIND_DOWN,2)
    x=InstitutionalCompiler.transition_lifecycle(x,InstitutionLifecycle.OBLIGATION_ONLY,3)
    x=InstitutionalCompiler.transition_lifecycle(x,InstitutionLifecycle.RECONCILIATION_ONLY,4)
    with pytest.raises(ConstitutionalError): InstitutionalCompiler.transition_lifecycle(x,InstitutionLifecycle.DISSOLVED,5)
