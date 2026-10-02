from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from numina.vm import AuthorityVM,AuthorityProgram,Instruction,Op
from numina.program import sign_program
from numina.status import StatusWitness,sign_witness
from numina.live_conformance import LiveConformanceState
from numina.eac import EAC,RecognitionProfile,sign as sign_eac
from numina.control_mesh import ProofCarryingEndpointContract
from numina.channels import AuthorityChannelPolicy
from numina.route_fencing import AuthorityRouteFence
from numina.mesh_health import MeshHealth,MeshHealthState
from numina_prod.commit_store import SQLAlchemyCommitStore
from numina_prod.runtime import ProductionContinuousRuntime

def fixture(tmp_path):
    constitution='c'*64;compiler='d'*64;dep='e'*64
    prog_sk=Ed25519PrivateKey.generate();witness_sk=Ed25519PrivateKey.generate();issuer_sk=Ed25519PrivateKey.generate()
    program=AuthorityProgram('pay-v1',constitution,(Instruction(Op.CHECK_EQ,'asset','ETH'),Instruction(Op.CHECK_LE,'notional',1000),Instruction(Op.DECIDE_ALLOW),))
    pc=sign_program(program,semantic_source_digest='s'*64,compiler_digest=compiler,reachable_authority_digest='r'*64,approval_digest='a'*64,sk=prog_sk)
    w=StatusWitness('A',10,dep,'CURRENT','0'*64,50,'W');sw=sign_witness(w,witness_sk)
    conf=LiveConformanceState('b'*64,constitution,'m'*64,program.program_digest(),w.status_root,'t'*64,100,0)
    store=SQLAlchemyCommitStore(f"sqlite+pysqlite:///{tmp_path/'portable.db'}")
    rt=ProductionContinuousRuntime(store=store,vm=AuthorityVM(),eac_public_keys={'issuer':issuer_sk.public_key()},program_public_key=prog_sk.public_key(),witness_public_key=witness_sk.public_key(),required_constitution_digest=constitution,expected_compiler_digest=compiler)
    rt.open_session('sess',AuthorityChannelPolicy('ch','A','B',frozenset({'PAY'}),2000,1000,1500,40),1);rt.set_route_fence(AuthorityRouteFence('route','A','B',7,True))
    endpoint=ProofCarryingEndpointContract('ep','B',frozenset({'PAY'}),1000,frozenset({constitution}),frozenset({'issuer'}),500)
    profile=RecognitionProfile('rp',('issuer',),(constitution,),('SIM_A',),32)
    def signed(auth='auth1',op='op1',nonce='n1',maxn=1000,dependency=dep):return sign_eac(EAC(auth,op,'principal','agent','mandate','ETH','BUY','SIM_A',10**18,300000,maxn,nonce,dependency,'pre',constitution,'issuer',10,40),issuer_sk)
    common=dict(recognition_profile=profile,endpoint=endpoint,authority_class='PAY',consequence_usd_minor=500,status_age_ms=10,proof_program=pc,witness=sw,conformance=conf,current_sequence=11,highest_seen_witness=9,expected_prev_witness=None,context={'asset':'ETH','notional':500},session_id='sess',route_id='route',route_epoch=7,obligation_id='obl1',creditor_domain='B',debtor_domain='A',risk_adding=True,health=MeshHealthState('A',MeshHealth.NORMAL,10_000))
    return rt,signed,common

def test_production_runtime_preserves_v18_atomic_commit_behavior(tmp_path):
    rt,signed,k=fixture(tmp_path);status,receipt=rt.execute(signed_eac=signed(),**k);assert status=='COMMITTED' and receipt.receipt_digest;assert rt.session_state('sess')==(500,500,0)

def test_production_runtime_replay_is_non_amplifying(tmp_path):
    rt,signed,k=fixture(tmp_path);assert rt.execute(signed_eac=signed(),**k)[0]=='COMMITTED';k2={**k,'obligation_id':'obl2'};assert rt.execute(signed_eac=signed(),**k2)[0]=='NONCE_ALREADY_CONSUMED';assert rt.session_state('sess')[0]==500

def test_production_runtime_fail_closed_on_stale_route(tmp_path):
    rt,signed,k=fixture(tmp_path);assert rt.execute(signed_eac=signed(),**{**k,'route_epoch':6})[0]=='STALE_ROUTE_EPOCH';assert rt.session_state('sess')[0]==0

def test_production_runtime_preserves_health_contraction(tmp_path):
    rt,signed,k=fixture(tmp_path);k={**k,'consequence_usd_minor':600,'context':{'asset':'ETH','notional':600},'health':MeshHealthState('A',MeshHealth.DEGRADED,5_000)};assert rt.execute(signed_eac=signed(),**k)[0]=='HEALTH_CONTRACTION_DENY';assert rt.session_state('sess')[0]==0
