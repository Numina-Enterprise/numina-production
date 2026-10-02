import os
from pathlib import Path
from numina_prod.preflight import run_preflight
from numina_prod.config import Settings
from numina_prod.signing import load_identity
from numina_prod.commit_store import SQLAlchemyCommitStore


def settings(tmp_path,environment="test",role="public-verifier",db=None,key=None):
    return Settings(environment,role,"core-v1.8+prod-v1.9.0-rc3",tmp_path,key,environment!="production",True,None,db,False,False,("testserver",))


def test_test_environment_preflight_is_green(tmp_path):
    out=run_preflight(settings(tmp_path))
    assert out["valid"] is True,out
    assert any(x["name"]=="frozen-core" and x["ok"] for x in out["checks"])


def test_production_key_permissions_fail_closed(tmp_path):
    key=tmp_path/'release.pem'
    load_identity(key,allow_ephemeral=True)
    key.chmod(0o644)
    out=run_preflight(settings(tmp_path,"production","public-verifier",key=key))
    assert out["valid"] is False
    assert "RELEASE_SIGNING_KEY_UNSAFE_OR_MISSING" in out["failures"]


def test_authority_node_preflight_checks_schema(tmp_path):
    url=f"sqlite+pysqlite:///{tmp_path/'node.db'}"
    SQLAlchemyCommitStore(url).close()
    out=run_preflight(settings(tmp_path,"test","authority-node",db=url))
    assert out["valid"] is True,out
    ds=next(x for x in out["checks"] if x["name"]=="authority-datastore")
    assert ds["status"]["schema_compatible"] is True
