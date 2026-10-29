import os
import pytest
from sqlalchemy import update
from sqlalchemy.exc import OperationalError
from numina_prod.commit_store import SQLAlchemyCommitStore,schema_versions,_retryable
from numina_prod.schema_contract import SCHEMA_VERSION,SCHEMA_NAME
from numina_prod.config import load_settings


def test_schema_version_is_initialized_and_reported(tmp_path):
    s=SQLAlchemyCommitStore(f"sqlite+pysqlite:///{tmp_path/'schema.db'}")
    st=s.datastore_status()
    assert st["schema_name"]==SCHEMA_NAME
    assert st["schema_version"]==SCHEMA_VERSION
    assert st["schema_compatible"] is True
    s.close()


def test_unknown_database_schema_fails_closed(tmp_path):
    url=f"sqlite+pysqlite:///{tmp_path/'schema.db'}"
    s=SQLAlchemyCommitStore(url)
    with s.engine.begin() as c:
        c.execute(update(schema_versions).where(schema_versions.c.schema_name==SCHEMA_NAME).values(version=999))
    s.close()
    with pytest.raises(RuntimeError,match="schema is not compatible"):
        SQLAlchemyCommitStore(url,create_schema=False)


def test_retryable_sqlite_lock_is_bounded_and_observable(tmp_path,monkeypatch):
    s=SQLAlchemyCommitStore(f"sqlite+pysqlite:///{tmp_path/'retry.db'}",max_retries=3)
    calls={"n":0}
    def fake(**kwargs):
        calls["n"]+=1
        if calls["n"]<3:
            raise OperationalError("commit",{},Exception("database is locked"))
        return "COMMITTED","digest"
    monkeypatch.setattr(s,"_commit_once",fake)
    assert s.commit_execution(eac=None,session_id="s",route_id="r",route_epoch=1,current_sequence=1,
        authority_class="PAY",consequence_usd_minor=1,health=None,risk_adding=True,obligation_id="o",
        creditor_domain="B",debtor_domain="A",payload={}) == ("COMMITTED","digest")
    st=s.datastore_status()
    assert calls["n"]==3 and st["serialization_retries"]==2 and st["serialization_retry_exhausted"]==0


def test_retry_exhaustion_fails_closed_without_exception_leak(tmp_path,monkeypatch):
    s=SQLAlchemyCommitStore(f"sqlite+pysqlite:///{tmp_path/'retry.db'}",max_retries=2)
    def fake(**kwargs):raise OperationalError("commit",{},Exception("database is locked"))
    monkeypatch.setattr(s,"_commit_once",fake)
    assert s.commit_execution(eac=None,session_id="s",route_id="r",route_epoch=1,current_sequence=1,
        authority_class="PAY",consequence_usd_minor=1,health=None,risk_adding=True,obligation_id="o",
        creditor_domain="B",debtor_domain="A",payload={}) == ("SERIALIZATION_RETRY_EXHAUSTED",None)
    assert s.datastore_status()["serialization_retry_exhausted"]==1


def test_production_authority_node_requires_verified_postgres_tls(monkeypatch,tmp_path):
    monkeypatch.setenv("NUMINA_ENV","production")
    monkeypatch.setenv("NUMINA_ROLE","authority-node")
    monkeypatch.setenv("NUMINA_SIGNING_KEY_FILE",str(tmp_path/'k.pem'))
    monkeypatch.setenv("NUMINA_ALLOW_EPHEMERAL_KEY","false")
    monkeypatch.setenv("NUMINA_DATABASE_URL","postgresql+psycopg://u:p@db:5432/n")
    monkeypatch.delenv("NUMINA_REAL_FUNDS_ENABLED",raising=False)
    monkeypatch.delenv("NUMINA_EMPLOYER_IP_ENABLED",raising=False)
    with pytest.raises(RuntimeError,match="verified PostgreSQL TLS"):
        load_settings()
    monkeypatch.setenv("NUMINA_DATABASE_URL","postgresql+psycopg://u:p@db:5432/n?sslmode=verify-full")
    settings=load_settings()
    assert settings.database_tls_required is True
