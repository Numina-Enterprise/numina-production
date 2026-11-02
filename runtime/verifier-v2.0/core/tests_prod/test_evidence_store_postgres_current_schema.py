from numina_prod.evidence_store_postgres import PostgresEvidenceStore


class FakeConnection:
    def __init__(self):
        self.queries = []
        self.params = []
        self._row = None
        self._rows = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.queries.append(sql)
        self.params.append(params)
        self._row = None
        self._rows = []
        if "INSERT INTO public.numina_evidence_records" in sql:
            self._row = {
                "record_id": "rid",
                "source_commit": "0xabc",
                "related_record_id": "handoff",
                "status": "REPORTED",
                "artifact_type": "TEST",
                "artifact_root": "root",
                "artifact_json": {"ok": True},
                "created_at": 1,
                "revoked": False,
                "revocation_json": None,
            }
        return self

    def fetchone(self):
        return self._row

    def fetchall(self):
        return self._rows


def test_record_maps_canonical_postgres_columns_to_runtime_api():
    row = {
        "record_id": "rid",
        "source_commit": "0xabc",
        "related_record_id": "handoff",
        "status": "VERIFIED",
        "artifact_type": "TEST",
        "artifact_root": "root",
        "artifact_json": {"ok": True},
        "created_at": 1,
        "revoked": False,
        "revocation_json": None,
    }
    assert PostgresEvidenceStore._record(row) == {
        "record_id": "rid",
        "tx_hash": "0xabc",
        "handoff_id": "handoff",
        "state": "VERIFIED",
        "artifact_type": "TEST",
        "artifact_root": "root",
        "artifact": {"ok": True},
        "created_at": 1,
        "revoked": False,
        "revocation": None,
    }


def test_constructor_checks_current_canonical_evidence_schema(monkeypatch):
    fake = FakeConnection()
    monkeypatch.setattr(PostgresEvidenceStore, "_connect", lambda self: fake)
    PostgresEvidenceStore("postgresql://u:p@db/numina?sslmode=require")
    assert "source_commit" in fake.queries[0]
    assert "related_record_id" in fake.queries[0]
    assert "status" in fake.queries[0]
    assert "tx_hash" not in fake.queries[0]
    assert "handoff_id" not in fake.queries[0]


def test_records_for_tx_queries_source_commit(monkeypatch):
    store = object.__new__(PostgresEvidenceStore)
    fake = FakeConnection()
    monkeypatch.setattr(store, "_connect", lambda: fake)
    assert store.records_for_tx("0xABC") == []
    assert "WHERE source_commit=%s" in fake.queries[-1]
    assert fake.params[-1] == ("0xabc",)


def test_put_artifact_writes_current_canonical_columns(monkeypatch):
    store = object.__new__(PostgresEvidenceStore)
    fake = FakeConnection()
    monkeypatch.setattr(store, "_connect", lambda: fake)

    result = store.put_artifact(
        state="REPORTED",
        artifact_type="TEST",
        artifact={"ok": True},
        tx_hash="0xABC",
        handoff_id="handoff",
    )

    insert_sql = next(q for q in fake.queries if q.startswith("INSERT INTO public.numina_evidence_records"))
    assert "(record_id,source_commit,related_record_id,status," in insert_sql
    assert result["tx_hash"] == "0xabc"
    assert result["handoff_id"] == "handoff"
    assert result["state"] == "REPORTED"
