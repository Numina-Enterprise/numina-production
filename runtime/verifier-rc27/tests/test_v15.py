import pytest
from numina import *


def env():
    r=RightsRuntime()
    r.add_creation_authority(RightCreationAuthority('A_CRED','CRED','NUMINA',('CLAIM','ROOT','ASSET','CREDIT'),1_000_000,10_000_000,True))
    r.add_creation_authority(RightCreationAuthority('A_DEBT','DEBT','NUMINA',('CLAIM','ROOT'),1_000_000,10_000_000,True))
    f=RightsFoundry(r, governance_epoch=7)
    f.register_template(RightTemplate('T_CLAIM','CLAIM',RightKind.CLAIM,BackingKind.CONTRACTUAL,500_000,False,10,Exclusivity.NON_EXCLUSIVE))
    f.register_template(RightTemplate('T_ROOT','ROOT',RightKind.CONTROL,BackingKind.PROTOCOL_NATIVE,1_000_000,True))
    return r,f


def test_template_instantiation():
    r,f=env(); x=f.instantiate('T_ROOT','A_CRED','R','CRED',1000); assert x.capacity==1000

def test_template_capacity_bound():
    r,f=env()
    with pytest.raises(FoundryError): f.instantiate('T_CLAIM','A_CRED','X','CRED',500001)

def test_duplicate_template_rejected():
    r,f=env()
    with pytest.raises(FoundryError): f.register_template(f.templates['T_ROOT'])

def test_novel_type_requires_governance():
    r,f=env(); p=f.propose_right_type(RightTypeProposal('P','NOVEL','sem',1000))
    bad=RightTypeGovernanceProof(p.digest,('A',),2,7)
    with pytest.raises(FoundryError): f.approve_right_type('P',bad)

def test_novel_type_governance_epoch_bound():
    r,f=env(); p=f.propose_right_type(RightTypeProposal('P','NOVEL','sem',1000))
    with pytest.raises(FoundryError): f.approve_right_type('P',RightTypeGovernanceProof(p.digest,('A','B'),2,8))

def test_novel_type_approved():
    r,f=env(); p=f.propose_right_type(RightTypeProposal('P','NOVEL','sem',1000)); f.approve_right_type('P',RightTypeGovernanceProof(p.digest,('A','B'),2,7)); assert f.approved_right_types['NOVEL']=='sem'

def test_exclusive_right_blocks_second_instance():
    r,f=env(); f.register_template(RightTemplate('EX','EXCLUSIVE','USE' if False else RightKind.USE,BackingKind.PROTOCOL_NATIVE,100,False,0,Exclusivity.EXCLUSIVE)); r.creation_authorities['A_CRED']=RightCreationAuthority('A_CRED','CRED','NUMINA',('CLAIM','ROOT','EXCLUSIVE'),1_000_000,10_000_000,True)
    f.instantiate('EX','A_CRED','E1','CRED',10)
    with pytest.raises(FoundryError): f.instantiate('EX','A_CRED','E2','CRED',10)

def test_transformation_haircut_conserves_capacity():
    r,f=env(); f.instantiate('T_ROOT','A_CRED','R','CRED',1000); r.creation_authorities['A_CRED']=RightCreationAuthority('A_CRED','CRED','NUMINA',('CLAIM','ROOT','CREDIT'),1_000_000,10_000_000,True)
    f.register_transformation(RightsTransformationRule('X','ROOT','CREDIT',2,1,5000))
    x=f.transform('X','A_CRED','R','C','CRED'); assert x.capacity==1000

def test_transformation_cannot_exceed_max():
    r,f=env(); f.instantiate('T_ROOT','A_CRED','R','CRED',1000); r.creation_authorities['A_CRED']=RightCreationAuthority('A_CRED','CRED','NUMINA',('CLAIM','ROOT','CREDIT'),1_000_000,10_000_000,True); f.register_transformation(RightsTransformationRule('X','ROOT','CREDIT',1,1,0))
    with pytest.raises(FoundryError): f.transform('X','A_CRED','R','C','CRED',1001)

def contract_env():
    r,f=env(); c=AutonomousContract('K',(ContractParty('CRED','buyer','A_CRED'),ContractParty('DEBT','seller','A_DEBT')),(ContractTerm('RC','T_CLAIM','CRED','DEBT',250000),),('CRED','DEBT'),3); p=ContractCommitProof(c.digest,('CRED','DEBT'),3); return r,f,c,p

def test_atomic_contract_creates_right_and_obligation():
    r,f,c,p=contract_env(); out=f.execute_contract(c,p); assert out.created_right_ids==('RC',) and out.created_obligation_ids==('K:OBL:0',)

def test_contract_missing_approval_rejected():
    r,f,c,p=contract_env();
    with pytest.raises(FoundryError): f.execute_contract(c,ContractCommitProof(c.digest,('CRED',),3))

def test_contract_epoch_bound():
    r,f,c,p=contract_env();
    with pytest.raises(FoundryError): f.execute_contract(c,ContractCommitProof(c.digest,('CRED','DEBT'),4))

def test_contract_digest_bound():
    r,f,c,p=contract_env();
    with pytest.raises(FoundryError): f.execute_contract(c,ContractCommitProof('bad',('CRED','DEBT'),3))

def test_contract_rolls_back_on_second_term_failure():
    r,f=env(); c=AutonomousContract('K',(ContractParty('CRED','x','A_CRED'),ContractParty('DEBT','y','A_DEBT')),(ContractTerm('R1','T_CLAIM','CRED','DEBT',10),ContractTerm('R2','NOPE','CRED','DEBT',10)),('CRED','DEBT'),1); pre=r.state_root
    with pytest.raises(FoundryError): f.execute_contract(c,ContractCommitProof(c.digest,('CRED','DEBT'),1))
    assert not r.rights and not r.obligations and r.state_root==pre

def test_duplicate_contract_object_rolls_back():
    r,f,c,p=contract_env(); f.execute_contract(c,p); before=r.state_root
    with pytest.raises(FoundryError): f.execute_contract(c,p)
    assert r.state_root==before

def test_genesis_min_cut_counts_independent_creation_paths():
    r,f=env(); cut=f.rights_genesis_min_cut('CLAIM'); assert cut.cut_size==2 and set(cut.authority_ids)=={'A_CRED','A_DEBT'}

def test_priority_conflict_detects_overclaim():
    r,f=env(); f.instantiate('T_ROOT','A_CRED','ROOT','CRED',100); r.creation_authorities['A_CRED']=RightCreationAuthority('A_CRED','CRED','NUMINA',('CLAIM','ROOT'),1_000_000,10_000_000,True)
    f.register_template(RightTemplate('D','CLAIM',RightKind.CLAIM,BackingKind.RESOURCE_BACKED,100,False,1,allowed_source_classes=('ROOT',)))
    f.instantiate('D','A_CRED','A','CRED',60,('ROOT',))
    with pytest.raises(RightsError): f.instantiate('D','A_CRED','B','CRED',60,('ROOT',))

def test_source_class_constraint():
    r,f=env(); f.instantiate('T_ROOT','A_CRED','ROOT','CRED',100); f.register_template(RightTemplate('ONLY','CLAIM',RightKind.CLAIM,BackingKind.RESOURCE_BACKED,100,allowed_source_classes=('OTHER',)))
    with pytest.raises(FoundryError): f.instantiate('ONLY','A_CRED','C','CRED',10,('ROOT',))

def test_contract_right_is_claim_typed():
    r,f,c,p=contract_env(); f.execute_contract(c,p); assert r.rights['RC'].right_kind==RightKind.CLAIM

def test_right_type_proposal_digest_deterministic():
    assert RightTypeProposal('P','N','S',10).digest==RightTypeProposal('P','N','S',10).digest

def test_contract_digest_deterministic():
    _,_,c,_=contract_env(); _,_,d,_=contract_env(); assert c.digest==d.digest
