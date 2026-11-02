import pytest
from dataclasses import replace
from numina import (
    RightsError, RightLifecycle, RightRecognitionState, RightKind, BackingKind,
    RightsOccupancy, RightCreationAuthority, RightGenesisRequest, RecognitionBudget,
    RightsVMInstruction, RightsVMOp, RightsProgram, RightsRuntime,
)
from numina_core import InstitutionIR, InstitutionalAuthorityDomain, InstitutionalRecoveryPath, InstitutionalCompiler


def runtime(root=True):
    r=RightsRuntime()
    r.add_creation_authority(RightCreationAuthority(
        'CA','P','NUMINA',('ROOT','CHILD','CLAIM'),1_000_000,3_000_000,
        allow_root_genesis=root,
    ))
    return r


def root_right(r, rid='R', cap=1_000_000, transferable=True):
    return r.create_right('CA',RightGenesisRequest(rid,'P','ROOT',RightKind.CONTROL,
        BackingKind.PROTOCOL_NATIVE,cap,(),transferable))


def test_root_genesis_requires_explicit_creation_authority():
    r=runtime(False)
    with pytest.raises(RightsError): root_right(r)


def test_root_genesis_with_authority():
    r=runtime(); x=root_right(r)
    assert x.capacity==1_000_000 and x.lifecycle==RightLifecycle.ACTIVE


def test_creation_authority_per_right_bound():
    r=runtime()
    with pytest.raises(RightsError): root_right(r,cap=1_000_001)


def test_creation_authority_aggregate_bound():
    r=runtime(); root_right(r,'A'); root_right(r,'B'); root_right(r,'C')
    with pytest.raises(RightsError): root_right(r,'D',1)


def test_derived_right_encumbers_source():
    r=runtime(); root_right(r)
    c=r.create_right('CA',RightGenesisRequest('C','P','CHILD',RightKind.USE,
        BackingKind.RESOURCE_BACKED,400_000,('R',)))
    assert c.capacity==400_000
    assert r.rights['R'].occupancy.encumbered==400_000
    assert r.rights['R'].available==600_000


def test_derived_right_cannot_exceed_source_available():
    r=runtime(); root_right(r)
    r.create_right('CA',RightGenesisRequest('C1','P','CHILD',RightKind.USE,BackingKind.RESOURCE_BACKED,700_000,('R',)))
    with pytest.raises(RightsError):
        r.create_right('CA',RightGenesisRequest('C2','P','CHILD',RightKind.USE,BackingKind.RESOURCE_BACKED,400_000,('R',)))


def test_creation_failure_does_not_mutate_source():
    r=runtime(); root_right(r); pre=r.state_root
    with pytest.raises(RightsError):
        r.create_right('CA',RightGenesisRequest('X','P','CHILD',RightKind.USE,BackingKind.RESOURCE_BACKED,1_000_001,('R',)))
    assert r.state_root==pre and r.rights['R'].occupancy.encumbered==0


def test_reciprocal_claim_creates_right_and_obligation_atomically():
    r=runtime(); p=r.create_reciprocal_claim('CA','PAIR','RC','O','CRED','DEBT',250_000)
    assert p.right_id in r.rights and p.obligation_id in r.obligations
    assert r.obligations['O'].amount==250_000


def test_reciprocal_duplicate_rejected_without_partial_objects():
    r=runtime(); r.create_reciprocal_claim('CA','PAIR','RC','O','CRED','DEBT',10)
    before=(len(r.rights),len(r.obligations),len(r.reciprocal_pairs))
    with pytest.raises(RightsError): r.create_reciprocal_claim('CA','PAIR','RC2','O2','C','D',10)
    assert before==(len(r.rights),len(r.obligations),len(r.reciprocal_pairs))


def test_recognition_cannot_widen_intrinsic_right():
    r=runtime(); root_right(r)
    r.add_recognition_budget(RecognitionBudget('B','BANK','NUMINA','ROOT',2_000_000))
    with pytest.raises(RightsError): r.recognize_right('R','B',1_000_001)


def test_recognition_budget_is_occupied():
    r=runtime(); root_right(r,'A',600_000); root_right(r,'B',600_000)
    r.add_recognition_budget(RecognitionBudget('RB','BANK','NUMINA','ROOT',1_000_000))
    r.recognize_right('A','RB',600_000)
    with pytest.raises(RightsError): r.recognize_right('B','RB',500_000)


def test_disputed_recognition_frees_recognition_budget_but_not_right():
    r=runtime(); root_right(r,'A',600_000); root_right(r,'B',600_000)
    r.add_recognition_budget(RecognitionBudget('RB','BANK','NUMINA','ROOT',600_000))
    r.recognize_right('A','RB',600_000)
    r.set_recognition_state('A','BANK',RightRecognitionState.DISPUTED)
    r.recognize_right('B','RB',600_000)
    assert r.rights['A'].capacity==600_000


def test_uncertainty_consumes_right_liquidity():
    r=runtime(); root_right(r)
    r.add_uncertainty('R',300_000)
    assert r.rights['R'].available==700_000
    r.narrow_uncertainty('R',100_000)
    assert r.rights['R'].available==800_000


def test_suspended_right_has_zero_available():
    r=runtime(); root_right(r); r.suspend_right('R')
    assert r.rights['R'].available==0
    r.activate_right('R')
    assert r.rights['R'].available==1_000_000


def test_occupied_right_cannot_transfer():
    r=runtime(); root_right(r); r.add_uncertainty('R',1)
    with pytest.raises(RightsError): r.transfer_right('R','P2')


def test_transfer_requires_transferable_right():
    r=runtime(); root_right(r,transferable=False)
    with pytest.raises(RightsError): r.transfer_right('R','P2')


def test_parent_cannot_extinguish_with_active_child():
    r=runtime(); root_right(r)
    r.create_right('CA',RightGenesisRequest('C','P','CHILD',RightKind.USE,BackingKind.RESOURCE_BACKED,100_000,('R',)))
    with pytest.raises(RightsError): r.extinguish_right('R')


def test_child_extinguish_releases_parent_backing():
    r=runtime(); root_right(r)
    r.create_right('CA',RightGenesisRequest('C','P','CHILD',RightKind.USE,BackingKind.RESOURCE_BACKED,100_000,('R',)))
    r.extinguish_right('C')
    assert r.rights['R'].occupancy.encumbered==0


def test_mrrc_is_conservative_over_descendants():
    r=runtime(); root_right(r,cap=500_000)
    r.create_right('CA',RightGenesisRequest('C','P','CHILD',RightKind.USE,BackingKind.RESOURCE_BACKED,200_000,('R',)))
    assert r.mr_rc('R')==700_000


def test_rights_vm_is_deterministic():
    def run():
        r=runtime()
        p=RightsProgram('P',(RightsVMInstruction.build(RightsVMOp.CREATE_RIGHT,
            right_id='R',principal_id='P',right_class='ROOT',right_kind='CONTROL',backing_kind='PROTOCOL_NATIVE',capacity=1000),))
        x=r.execute(p,'CA'); return x.program_digest,x.post_root
    assert run()==run()


def test_rights_vm_lifecycle_program():
    r=runtime(); root_right(r)
    p=RightsProgram('P',(
        RightsVMInstruction.build(RightsVMOp.SUSPEND_RIGHT,right_id='R'),
        RightsVMInstruction.build(RightsVMOp.ACTIVATE_RIGHT,right_id='R'),
    ))
    out=r.execute(p,'CA')
    assert out.event_count==2 and r.rights['R'].lifecycle==RightLifecycle.ACTIVE


def test_projection_feeds_institutional_compiler():
    r=runtime(); root_right(r)
    rights, obligations=r.to_institutional_components()
    ir=InstitutionIR('I','C','S',('P',),rights,(InstitutionalAuthorityDomain('D','P','R',500_000),),
        obligations,(),(InstitutionalRecoveryPath('REC',('D',)),),())
    build=InstitutionalCompiler.compile(ir)
    assert build.viability.viable and build.total_rights_capacity_usd_minor==1_000_000


def test_state_root_changes_monotonically_with_events():
    r=runtime(); a=r.state_root; root_right(r); b=r.state_root; r.suspend_right('R'); c=r.state_root
    assert len({a,b,c})==3 and [e.sequence for e in r.events]==[1,2]


def test_recognition_state_does_not_change_intrinsic_capacity():
    r=runtime(); root_right(r)
    r.add_recognition_budget(RecognitionBudget('RB','BANK','NUMINA','ROOT',1_000_000))
    r.recognize_right('R','RB',500_000)
    cap=r.rights['R'].capacity
    r.set_recognition_state('R','BANK',RightRecognitionState.REJECTED)
    assert r.rights['R'].capacity==cap
