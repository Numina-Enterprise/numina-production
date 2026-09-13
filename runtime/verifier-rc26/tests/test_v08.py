import os, tempfile
from dataclasses import replace
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from numina.vm import AuthorityVM, AuthorityProgram, Instruction, Op
from numina.program import sign_program
from numina.status import StatusWitness, sign_witness
from numina.live_conformance import LiveConformanceState
from numina.eac import EAC, RecognitionProfile, sign as sign_eac
from numina.control_mesh import ProofCarryingEndpointContract
from numina.channels import AuthorityChannelPolicy
from numina.continuous_runtime import ContinuousConstitutionalRuntime
from numina.route_fencing import AuthorityRouteFence
from numina.mesh_health import MeshHealth, MeshHealthState
from numina.discovery import EndpointAdvertisement, discover_endpoint


def setup_runtime(path):
    constitution='c'*64; compiler='d'*64; dep='e'*64
    prog_sk=Ed25519PrivateKey.generate(); witness_sk=Ed25519PrivateKey.generate(); issuer_sk=Ed25519PrivateKey.generate()
    program=AuthorityProgram('pay-v1',constitution,(
        Instruction(Op.CHECK_EQ,'asset','ETH'),
        Instruction(Op.CHECK_LE,'notional',1000),
        Instruction(Op.DECIDE_ALLOW),))
    pc=sign_program(program,semantic_source_digest='s'*64,compiler_digest=compiler,
                    reachable_authority_digest='r'*64,approval_digest='a'*64,sk=prog_sk)
    w=StatusWitness('A',10,dep,'CURRENT','0'*64,50,'W')
    sw=sign_witness(w,witness_sk)
    conf=LiveConformanceState('b'*64,constitution,'m'*64,program.program_digest(),w.status_root,'t'*64,100,0)
    rt=ContinuousConstitutionalRuntime(path,vm=AuthorityVM(),eac_public_keys={'issuer':issuer_sk.public_key()},
        program_public_key=prog_sk.public_key(),witness_public_key=witness_sk.public_key(),
        required_constitution_digest=constitution,expected_compiler_digest=compiler)
    policy=AuthorityChannelPolicy('ch','A','B',frozenset({'PAY'}),2000,1000,1500,40)
    rt.open_session('sess',policy,1)
    rt.set_route_fence(AuthorityRouteFence('route','A','B',7,True))
    endpoint=ProofCarryingEndpointContract('ep','B',frozenset({'PAY'}),1000,frozenset({constitution}),frozenset({'issuer'}),500)
    profile=RecognitionProfile('rp',('issuer',),(constitution,),('SIM_A',),32)
    def signed(auth='auth1',op='op1',nonce='n1',maxn=1000,dependency=dep):
        return sign_eac(EAC(auth,op,'principal','agent','mandate','ETH','BUY','SIM_A',10**18,300000,maxn,nonce,
            dependency,'pre',constitution,'issuer',10,40),issuer_sk)
    common=dict(recognition_profile=profile,endpoint=endpoint,authority_class='PAY',consequence_usd_minor=500,
        status_age_ms=10,proof_program=pc,witness=sw,conformance=conf,current_sequence=11,highest_seen_witness=9,
        expected_prev_witness=None,context={'asset':'ETH','notional':500},session_id='sess',route_id='route',route_epoch=7,
        obligation_id='obl1',creditor_domain='B',debtor_domain='A',risk_adding=True,
        health=MeshHealthState('A',MeshHealth.NORMAL,10_000))
    return rt,signed,common,dep


def test_endpoint_discovery_chooses_smallest_sufficient_envelope_deterministically():
    xs=[
      EndpointAdvertisement('z','B','https://z',frozenset({'c'}),frozenset({'PAY'}),frozenset({'i'}),5000,100,1),
      EndpointAdvertisement('a','B','https://a',frozenset({'c'}),frozenset({'PAY'}),frozenset({'i'}),1000,100,1),
    ]
    x=discover_endpoint(xs,constitution_digest='c',authority_class='PAY',issuer_id='i',consequence_usd_minor=500,status_age_ms=10)
    assert x.endpoint_id=='a'


def test_atomic_network_commit_consumes_session_nonce_and_creates_obligation():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        status,receipt=rt.execute(signed_eac=signed(),**k)
        assert status=='COMMITTED' and receipt.receipt_digest
        assert rt.session_state('sess')==(500,500,0)
        assert rt.obligation_state('obl1')[0:2]==('BILATERALLY_COMMITTED',500)
        rt.close()


def test_eac_replay_cannot_double_consume_session():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        assert rt.execute(signed_eac=signed(),**k)[0]=='COMMITTED'
        k2={**k,'obligation_id':'obl2'}
        assert rt.execute(signed_eac=signed(),**k2)[0]=='NONCE_ALREADY_CONSUMED'
        assert rt.session_state('sess')[0]==500
        rt.close()


def test_stale_route_epoch_blocks_before_any_economic_mutation():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        status,_=rt.execute(signed_eac=signed(),**{**k,'route_epoch':6})
        assert status=='STALE_ROUTE_EPOCH' and rt.session_state('sess')[0]==0
        rt.close()


def test_route_epoch_rollback_is_rejected():
    with tempfile.TemporaryDirectory() as d:
        rt,_,_,_=setup_runtime(os.path.join(d,'n.db'))
        try:
            rt.set_route_fence(AuthorityRouteFence('route','A','B',6,True))
            assert False
        except ValueError as e:
            assert str(e)=='ROUTE_EPOCH_ROLLBACK'
        rt.close()


def test_health_contraction_reduces_risk_adding_per_operation_limit():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        k={**k,'consequence_usd_minor':600,'context':{'asset':'ETH','notional':600},
           'health':MeshHealthState('A',MeshHealth.DEGRADED,5_000)}
        status,_=rt.execute(signed_eac=signed(),**k)
        assert status=='HEALTH_CONTRACTION_DENY' and rt.session_state('sess')[0]==0
        rt.close()


def test_disputed_health_preserves_non_risk_adding_path():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        k={**k,'risk_adding':False,'health':MeshHealthState('A',MeshHealth.DISPUTED,0)}
        assert rt.execute(signed_eac=signed(),**k)[0]=='COMMITTED'
        rt.close()


def test_dependency_root_mismatch_is_fail_closed():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        status,_=rt.execute(signed_eac=signed(dependency='wrong'),**k)
        assert status=='DEPENDENCY_ROOT_MISMATCH' and rt.session_state('sess')[0]==0
        rt.close()


def test_endpoint_staleness_cannot_consume_authority():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        status,_=rt.execute(signed_eac=signed(),**{**k,'status_age_ms':501})
        assert status=='STATUS_TOO_OLD' and rt.session_state('sess')[0]==0
        rt.close()


def test_obligation_reconciliation_is_persistent_and_monotonic():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        assert rt.execute(signed_eac=signed(),**k)[0]=='COMMITTED'
        for state in ('EXECUTED','SETTLED','FINAL'):
            assert rt.reconcile_obligation('obl1',target_state=state,evidence_ref=state)[0]
        assert rt.obligation_state('obl1')[0]=='FINAL'
        assert rt.reconcile_obligation('obl1',target_state='DISPUTED',evidence_ref='x')[1]=='FINAL_OBLIGATION_IMMUTABLE'
        rt.close()


def test_duplicate_obligation_rolls_back_all_coupled_mutations():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        assert rt.execute(signed_eac=signed(),**k)[0]=='COMMITTED'
        # fresh EAC/operation but duplicate obligation id: whole second transaction must roll back.
        k2={**k,'obligation_id':'obl1'}
        status,_=rt.execute(signed_eac=signed(auth='auth2',op='op2',nonce='n2'),**k2)
        assert status=='ATOMIC_UNIQUENESS_VIOLATION'
        assert rt.session_state('sess')[0]==500
        assert rt.db.execute("SELECT COUNT(*) FROM operations").fetchone()[0]==1
        rt.close()


def test_session_aggregate_limit_is_enforced_atomically_across_operations():
    with tempfile.TemporaryDirectory() as d:
        rt,signed,k,_=setup_runtime(os.path.join(d,'n.db'))
        k1={**k,'consequence_usd_minor':1000,'context':{'asset':'ETH','notional':1000}}
        assert rt.execute(signed_eac=signed(maxn=1000),**k1)[0]=='COMMITTED'
        k2={**k,'obligation_id':'obl2','consequence_usd_minor':1000,'context':{'asset':'ETH','notional':1000}}
        status,_=rt.execute(signed_eac=signed(auth='auth2',op='op2',nonce='n2',maxn=1000),**k2)
        # velocity is 1500, so second op is denied before aggregate 2000 boundary is crossed.
        assert status=='SESSION_VELOCITY_BOUND_EXCEEDED'
        assert rt.session_state('sess')[0]==1000
        rt.close()
