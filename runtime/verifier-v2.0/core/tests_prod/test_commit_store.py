import tempfile
from numina_prod.commit_store import SQLAlchemyCommitStore
from numina.channels import AuthorityChannelPolicy
from numina.route_fencing import AuthorityRouteFence
from numina.mesh_health import MeshHealth,MeshHealthState

class E:
    nonce="n1";authorization_id="a1";operation_id="o1"

def make(tmp_path):
    s=SQLAlchemyCommitStore(f"sqlite+pysqlite:///{tmp_path/'prod.db'}")
    p=AuthorityChannelPolicy('ch','A','B',frozenset({'PAY'}),2000,1000,1500,40)
    s.open_session('sess',p,1);s.set_route_fence(AuthorityRouteFence('route','A','B',7,True));return s

def args(e=E(),ob='obl1',amount=500):
    return dict(eac=e,session_id='sess',route_id='route',route_epoch=7,current_sequence=11,authority_class='PAY',consequence_usd_minor=amount,health=MeshHealthState('A',MeshHealth.NORMAL,10_000),risk_adding=True,obligation_id=ob,creditor_domain='B',debtor_domain='A',payload={'operation_id':e.operation_id,'amount':amount})

def test_atomic_commit_store_commits_all_coupled_state(tmp_path):
    s=make(tmp_path);status,d=s.commit_execution(**args());assert status=='COMMITTED' and d
    assert s.session_state('sess')==(500,500,0);assert s.obligation_state('obl1')[:2]==('BILATERALLY_COMMITTED',500);assert s.count_operations()==1

def test_nonce_replay_fails_closed(tmp_path):
    s=make(tmp_path);assert s.commit_execution(**args())[0]=='COMMITTED'
    class E2(E):
        operation_id='o2'
        authorization_id='a2'
    assert s.commit_execution(**args(E2(),ob='obl2'))[0]=='NONCE_ALREADY_CONSUMED'
    assert s.session_state('sess')[0]==500

def test_duplicate_obligation_rolls_back_second_transaction(tmp_path):
    s=make(tmp_path);assert s.commit_execution(**args())[0]=='COMMITTED'
    class E2: nonce='n2';authorization_id='a2';operation_id='o2'
    assert s.commit_execution(**args(E2(),ob='obl1'))[0]=='ATOMIC_UNIQUENESS_VIOLATION'
    assert s.session_state('sess')[0]==500;assert s.count_operations()==1

def test_route_epoch_and_session_limits_are_inside_transaction(tmp_path):
    s=make(tmp_path)
    bad=args();bad['route_epoch']=6;assert s.commit_execution(**bad)[0]=='STALE_ROUTE_EPOCH';assert s.session_state('sess')[0]==0
    high=args(amount=1001);assert s.commit_execution(**high)[0]=='SESSION_PER_OPERATION_BOUND_EXCEEDED';assert s.session_state('sess')[0]==0

def test_obligation_reconciliation_monotonic(tmp_path):
    s=make(tmp_path);assert s.commit_execution(**args())[0]=='COMMITTED'
    for state in ('EXECUTED','SETTLED','FINAL'):assert s.reconcile_obligation('obl1',target_state=state,evidence_ref=state)[0]
    assert s.reconcile_obligation('obl1',target_state='DISPUTED',evidence_ref='x')[1]=='FINAL_OBLIGATION_IMMUTABLE'


def test_health_contraction_is_derived_from_session_policy_inside_transaction(tmp_path):
    s=make(tmp_path)
    a=args(amount=600)
    a['health']=MeshHealthState('A',MeshHealth.DEGRADED,5_000)
    # Session per-operation ceiling is 1000, so 50% degraded health limit is 500.
    assert s.commit_execution(**a)[0]=='HEALTH_CONTRACTION_DENY'
    assert s.session_state('sess')[0]==0
