import os,pytest
from numina.channels import AuthorityChannelPolicy
from numina.route_fencing import AuthorityRouteFence
from numina.mesh_health import MeshHealth,MeshHealthState
from numina_prod.commit_store import SQLAlchemyCommitStore

URL=os.getenv("NUMINA_TEST_POSTGRES_URL")
pytestmark=pytest.mark.skipif(not URL,reason="NUMINA_TEST_POSTGRES_URL not configured")

class E:
    nonce="pg-nonce";authorization_id="pg-auth";operation_id="pg-op"

def test_postgres_atomic_commit_and_replay_fail_closed():
    s=SQLAlchemyCommitStore(URL)
    # Isolate with unique IDs because CI may retry the test against the same service.
    import uuid
    x=uuid.uuid4().hex[:10];session=f"sess-{x}";route=f"route-{x}";ob=f"obl-{x}"
    e=type("E",(),{"nonce":f"nonce-{x}","authorization_id":f"auth-{x}","operation_id":f"op-{x}"})()
    s.open_session(session,AuthorityChannelPolicy('ch','A','B',frozenset({'PAY'}),2000,1000,1500,40),1)
    s.set_route_fence(AuthorityRouteFence(route,'A','B',7,True))
    args=dict(eac=e,session_id=session,route_id=route,route_epoch=7,current_sequence=11,
        authority_class='PAY',consequence_usd_minor=500,
        health=MeshHealthState('A',MeshHealth.NORMAL,10_000),risk_adding=True,
        obligation_id=ob,creditor_domain='B',debtor_domain='A',payload={'operation_id':e.operation_id})
    status,digest=s.commit_execution(**args)
    assert status=='COMMITTED' and digest
    assert s.session_state(session)==(500,500,0)
    assert s.commit_execution(**args)[0]=='NONCE_ALREADY_CONSUMED'



def test_postgres_schema_and_serializable_contract():
    s=SQLAlchemyCommitStore(URL)
    st=s.datastore_status()
    assert st["schema_compatible"] is True
    assert st["schema_version"]==1
    assert str(st["isolation_level"]).upper()=="SERIALIZABLE"
    s.close()


def test_postgres_concurrent_session_aggregate_cannot_oversubscribe():
    import uuid
    from concurrent.futures import ThreadPoolExecutor
    x=uuid.uuid4().hex[:10]
    s=SQLAlchemyCommitStore(URL,max_retries=6)
    session=f"sess-cap-{x}";route=f"route-cap-{x}"
    s.open_session(session,AuthorityChannelPolicy('ch','A','B',frozenset({'PAY'}),1000,1000,1000,40),1)
    s.set_route_fence(AuthorityRouteFence(route,'A','B',7,True))
    def attempt(i):
        worker=SQLAlchemyCommitStore(URL,create_schema=False,max_retries=6)
        e=type("E",(),{"nonce":f"nonce-{x}-{i}","authorization_id":f"auth-{x}-{i}","operation_id":f"op-{x}-{i}"})()
        out=worker.commit_execution(eac=e,session_id=session,route_id=route,route_epoch=7,current_sequence=11,
            authority_class='PAY',consequence_usd_minor=600,
            health=MeshHealthState('A',MeshHealth.NORMAL,10_000),risk_adding=True,
            obligation_id=f"obl-{x}-{i}",creditor_domain='B',debtor_domain='A',payload={'operation_id':e.operation_id})
        worker.close();return out[0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes=list(pool.map(attempt,[1,2]))
    assert outcomes.count('COMMITTED')==1,outcomes
    assert any(x in {'SESSION_AGGREGATE_BOUND_EXCEEDED','SESSION_VELOCITY_BOUND_EXCEEDED','SERIALIZATION_RETRY_EXHAUSTED'} for x in outcomes if x!='COMMITTED')
    assert s.session_state(session)[0]==600
    s.close()
