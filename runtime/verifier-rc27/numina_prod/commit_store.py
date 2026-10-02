from __future__ import annotations
import json,random,time,threading
from dataclasses import asdict
from typing import Any
from sqlalchemy import (
    MetaData,Table,Column,String,Integer,LargeBinary,Text,Boolean,UniqueConstraint,
    create_engine,select,insert,update,text
)
from sqlalchemy.exc import IntegrityError,OperationalError,DBAPIError
from sqlalchemy.engine import Engine
from numina.canonical import canonical_bytes,digest
from numina.channels import AuthorityChannelPolicy
from numina.route_fencing import AuthorityRouteFence
from .schema_contract import SCHEMA_VERSION,SCHEMA_NAME,MIGRATION_LOCK_KEY,SchemaStatus

metadata=MetaData()
schema_versions=Table("schema_versions",metadata,
    Column("schema_name",String,primary_key=True),Column("version",Integer,nullable=False),
    Column("production_version",String,nullable=False),Column("applied_at",Integer,nullable=False))
sessions=Table("sessions",metadata,
    Column("session_id",String,primary_key=True),Column("policy_json",Text,nullable=False),
    Column("opened_sequence",Integer,nullable=False),Column("consumed",Integer,nullable=False,default=0),
    Column("velocity_consumed",Integer,nullable=False,default=0),Column("closed",Boolean,nullable=False,default=False))
session_nonces=Table("session_nonces",metadata,
    Column("session_id",String,primary_key=True),Column("nonce",String,primary_key=True))
eac_nonces=Table("eac_nonces",metadata,
    Column("nonce",String,primary_key=True),Column("authorization_id",String,nullable=False))
operations=Table("operations",metadata,
    Column("operation_id",String,primary_key=True),Column("authorization_id",String,nullable=False,unique=True),
    Column("session_id",String,nullable=False),Column("route_id",String,nullable=False),Column("route_epoch",Integer,nullable=False),
    Column("payload",LargeBinary,nullable=False),Column("digest",String,nullable=False))
obligations=Table("obligations",metadata,
    Column("obligation_id",String,primary_key=True),Column("creditor_domain",String,nullable=False),
    Column("debtor_domain",String,nullable=False),Column("resource",String,nullable=False),Column("amount_minor",Integer,nullable=False),
    Column("authorization_id",String,nullable=False),Column("operation_id",String,nullable=False,unique=True),
    Column("state",String,nullable=False),Column("evidence_json",Text,nullable=False))
route_fences=Table("route_fences",metadata,
    Column("route_id",String,primary_key=True),Column("source_domain",String,nullable=False),
    Column("destination_domain",String,nullable=False),Column("epoch",Integer,nullable=False),Column("active",Boolean,nullable=False))


def create_database_engine(
    url:str,*,connect_timeout_seconds:int=5,statement_timeout_ms:int=5000,lock_timeout_ms:int=2000
)->Engine:
    kwargs={"future":True,"pool_pre_ping":True}
    if url.startswith("sqlite"):
        kwargs["connect_args"]={"check_same_thread":False,"timeout":30}
    if url.startswith("postgresql"):
        kwargs["isolation_level"]="SERIALIZABLE"
        # psycopg/libpq parameters are applied per connection. The URL owns TLS
        # verification (sslmode=verify-full); these bound connection and lock waits.
        kwargs["connect_args"]={
            "connect_timeout":int(connect_timeout_seconds),
            "options":f"-c statement_timeout={int(statement_timeout_ms)} -c lock_timeout={int(lock_timeout_ms)}",
        }
    return create_engine(url,**kwargs)


def _retryable(exc:BaseException)->bool:
    if isinstance(exc,OperationalError) and "locked" in str(exc).lower(): return True
    if isinstance(exc,DBAPIError):
        orig=getattr(exc,"orig",None)
        state=getattr(orig,"sqlstate",None) or getattr(orig,"pgcode",None)
        return state in {"40001","40P01"}
    return False

class SQLAlchemyCommitStore:
    """Production persistence contract for the frozen v1.8 commit semantics.

    PostgreSQL is the production target. SQLite is retained only for local equivalence tests.
    The store performs state-dependent session/fence checks inside the same DB transaction as
    nonce consumption, operation creation, and obligation creation.
    """
    def __init__(
        self,database_url:str,*,create_schema:bool=True,max_retries:int=4,
        connect_timeout_seconds:int=5,statement_timeout_ms:int=5000,lock_timeout_ms:int=2000,
        production_version:str="1.9.0-rc27"
    ):
        self.database_url=database_url
        self.engine=create_database_engine(
            database_url,connect_timeout_seconds=connect_timeout_seconds,
            statement_timeout_ms=statement_timeout_ms,lock_timeout_ms=lock_timeout_ms
        )
        self.max_retries=max(1,int(max_retries))
        self.production_version=production_version
        self._stats_lock=threading.Lock()
        self._serialization_retries=0
        self._serialization_exhausted=0
        if create_schema:
            self.ensure_schema()
        else:
            self.assert_schema_compatible()

    @property
    def dialect(self): return self.engine.dialect.name

    def ensure_schema(self):
        # One migration transaction. PostgreSQL gets an advisory xact lock so
        # multiple replicas cannot race schema initialization/promotion.
        with self.engine.begin() as c:
            if self.dialect == "postgresql":
                c.execute(text("SELECT pg_advisory_xact_lock(:k)"),{"k":MIGRATION_LOCK_KEY})
            metadata.create_all(c)
            row=c.execute(
                select(schema_versions).where(schema_versions.c.schema_name==SCHEMA_NAME).with_for_update()
            ).mappings().first()
            if row is None:
                c.execute(insert(schema_versions).values(
                    schema_name=SCHEMA_NAME,version=SCHEMA_VERSION,
                    production_version=self.production_version,applied_at=int(time.time())
                ))
            elif int(row["version"]) != SCHEMA_VERSION:
                raise RuntimeError(
                    f"database schema version {row['version']} is incompatible with supported {SCHEMA_VERSION}"
                )
        return self.schema_status()

    def schema_status(self)->SchemaStatus:
        with self.engine.connect() as c:
            try:
                row=c.execute(
                    select(schema_versions.c.version).where(schema_versions.c.schema_name==SCHEMA_NAME)
                ).first()
                db_version=None if row is None else int(row[0])
            except Exception:
                db_version=None
            try:isolation=c.get_isolation_level()
            except Exception:isolation=None
        return SchemaStatus(
            schema_name=SCHEMA_NAME,supported_version=SCHEMA_VERSION,
            database_version=db_version,compatible=(db_version==SCHEMA_VERSION),
            dialect=self.dialect,isolation_level=isolation
        )

    def assert_schema_compatible(self):
        status=self.schema_status()
        if not status.compatible:
            raise RuntimeError(
                f"database schema is not compatible: expected {SCHEMA_VERSION}, got {status.database_version}"
            )
        return status

    def datastore_status(self)->dict:
        status=self.schema_status()
        with self._stats_lock:
            retries=self._serialization_retries;exhausted=self._serialization_exhausted
        return {
            "dialect":status.dialect,
            "schema_name":status.schema_name,
            "schema_version":status.database_version,
            "supported_schema_version":status.supported_version,
            "schema_compatible":status.compatible,
            "isolation_level":status.isolation_level,
            "serialization_retries":retries,
            "serialization_retry_exhausted":exhausted,
        }

    def open_session(self,session_id:str,policy:AuthorityChannelPolicy,opened_sequence:int):
        pdata={**asdict(policy),"authority_classes":sorted(policy.authority_classes)}
        with self.engine.begin() as c:
            c.execute(insert(sessions).values(session_id=session_id,policy_json=json.dumps(pdata,sort_keys=True),opened_sequence=opened_sequence,consumed=0,velocity_consumed=0,closed=False))

    def set_route_fence(self,fence:AuthorityRouteFence):
        with self.engine.begin() as c:
            current=c.execute(select(route_fences).where(route_fences.c.route_id==fence.route_id).with_for_update()).mappings().first()
            if current and fence.epoch < current["epoch"]: raise ValueError("ROUTE_EPOCH_ROLLBACK")
            if current:
                c.execute(update(route_fences).where(route_fences.c.route_id==fence.route_id).values(source_domain=fence.source_domain,destination_domain=fence.destination_domain,epoch=fence.epoch,active=fence.active))
            else:
                c.execute(insert(route_fences).values(route_id=fence.route_id,source_domain=fence.source_domain,destination_domain=fence.destination_domain,epoch=fence.epoch,active=fence.active))

    def close_session(self,session_id:str):
        with self.engine.begin() as c: c.execute(update(sessions).where(sessions.c.session_id==session_id).values(closed=True))

    def consumed_nonces(self)->set[str]:
        with self.engine.connect() as c: return set(c.execute(select(eac_nonces.c.nonce)).scalars())

    def session_state(self,session_id:str):
        with self.engine.connect() as c:
            r=c.execute(select(sessions.c.consumed,sessions.c.velocity_consumed,sessions.c.closed).where(sessions.c.session_id==session_id)).first()
            return None if r is None else (r[0],r[1],int(bool(r[2])))

    def obligation_state(self,obligation_id:str):
        with self.engine.connect() as c:
            r=c.execute(select(obligations.c.state,obligations.c.amount_minor,obligations.c.evidence_json).where(obligations.c.obligation_id==obligation_id)).first()
            return None if r is None else (r[0],r[1],r[2])

    def count_operations(self)->int:
        from sqlalchemy import func
        with self.engine.connect() as c: return int(c.execute(select(func.count()).select_from(operations)).scalar_one())

    def reconcile_obligation(self,obligation_id:str,*,target_state:str,evidence_ref:str):
        order={"BILATERALLY_COMMITTED":0,"EXECUTED":1,"SETTLED":2,"FINAL":3}
        with self.engine.begin() as c:
            row=c.execute(select(obligations).where(obligations.c.obligation_id==obligation_id).with_for_update()).mappings().first()
            if not row:return False,"OBLIGATION_NOT_FOUND"
            state=row["state"]
            if state=="FINAL":return False,"FINAL_OBLIGATION_IMMUTABLE"
            ev=set(json.loads(row["evidence_json"]));ev.add(evidence_ref)
            if target_state=="DISPUTED":
                c.execute(update(obligations).where(obligations.c.obligation_id==obligation_id).values(state="DISPUTED",evidence_json=json.dumps(sorted(ev))))
                return True,"OK"
            if state=="DISPUTED":return False,"DISPUTE_REQUIRES_RECONCILIATION"
            if target_state not in order or order.get(target_state)!=order.get(state,-99)+1:return False,"INVALID_OBLIGATION_TRANSITION"
            c.execute(update(obligations).where(obligations.c.obligation_id==obligation_id).values(state=target_state,evidence_json=json.dumps(sorted(ev))))
            return True,"OK"

    def commit_execution(self,*,eac,session_id:str,route_id:str,route_epoch:int,current_sequence:int,
                         authority_class:str,consequence_usd_minor:int,health,risk_adding:bool,
                         obligation_id:str,creditor_domain:str,debtor_domain:str,payload:dict):
        for attempt in range(self.max_retries):
            try:
                return self._commit_once(eac=eac,session_id=session_id,route_id=route_id,route_epoch=route_epoch,
                    current_sequence=current_sequence,authority_class=authority_class,consequence_usd_minor=consequence_usd_minor,
                    health=health,risk_adding=risk_adding,obligation_id=obligation_id,creditor_domain=creditor_domain,
                    debtor_domain=debtor_domain,payload=payload)
            except (OperationalError,DBAPIError) as exc:
                if not _retryable(exc):
                    raise
                if attempt+1>=self.max_retries:
                    with self._stats_lock:self._serialization_exhausted += 1
                    return "SERIALIZATION_RETRY_EXHAUSTED",None
                with self._stats_lock:self._serialization_retries += 1
                time.sleep((2**attempt)*0.01+random.random()*0.005)
        return "SERIALIZATION_RETRY_EXHAUSTED",None

    def _commit_once(self,*,eac,session_id,route_id,route_epoch,current_sequence,authority_class,
                     consequence_usd_minor,health,risk_adding,obligation_id,creditor_domain,debtor_domain,payload):
        try:
            with self.engine.begin() as c:
                fence=c.execute(select(route_fences).where(route_fences.c.route_id==route_id).with_for_update()).mappings().first()
                if not fence or not fence["active"]: return "ROUTE_FENCED",None
                if fence["epoch"]!=route_epoch:return "STALE_ROUTE_EPOCH",None
                if fence["source_domain"]!=debtor_domain or fence["destination_domain"]!=creditor_domain:return "ROUTE_DOMAIN_MISMATCH",None

                row=c.execute(select(sessions).where(sessions.c.session_id==session_id).with_for_update()).mappings().first()
                if not row:return "SESSION_NOT_FOUND",None
                pdata=json.loads(row["policy_json"])
                if row["closed"]:return "SESSION_CLOSED",None
                if current_sequence>pdata["expiry_sequence"]:return "SESSION_EXPIRED",None
                if authority_class not in pdata["authority_classes"]:return "SESSION_AUTHORITY_CLASS_DENIED",None
                if consequence_usd_minor<0:return "NEGATIVE_CONSEQUENCE",None
                if consequence_usd_minor>pdata["per_operation_limit_usd_minor"]:return "SESSION_PER_OPERATION_BOUND_EXCEEDED",None
                health_limit=health.effective_limit(pdata["per_operation_limit_usd_minor"],risk_adding=risk_adding)
                if consequence_usd_minor>health_limit:return "HEALTH_CONTRACTION_DENY",None
                if pdata["source_domain"]!=debtor_domain or pdata["destination_domain"]!=creditor_domain:return "SESSION_DOMAIN_MISMATCH",None
                if row["consumed"]+consequence_usd_minor>pdata["aggregate_limit_usd_minor"]:return "SESSION_AGGREGATE_BOUND_EXCEEDED",None
                if row["velocity_consumed"]+consequence_usd_minor>pdata["velocity_limit_usd_minor_per_window"]:return "SESSION_VELOCITY_BOUND_EXCEEDED",None
                if c.execute(select(eac_nonces.c.nonce).where(eac_nonces.c.nonce==eac.nonce)).first():return "NONCE_ALREADY_CONSUMED",None
                if c.execute(select(session_nonces.c.nonce).where(session_nonces.c.session_id==session_id,session_nonces.c.nonce==eac.nonce)).first():return "SESSION_NONCE_REPLAY",None

                b=canonical_bytes(payload);cd=digest(payload)
                c.execute(insert(eac_nonces).values(nonce=eac.nonce,authorization_id=eac.authorization_id))
                c.execute(insert(session_nonces).values(session_id=session_id,nonce=eac.nonce))
                c.execute(update(sessions).where(sessions.c.session_id==session_id).values(consumed=row["consumed"]+consequence_usd_minor,velocity_consumed=row["velocity_consumed"]+consequence_usd_minor))
                c.execute(insert(operations).values(operation_id=eac.operation_id,authorization_id=eac.authorization_id,session_id=session_id,route_id=route_id,route_epoch=route_epoch,payload=b,digest=cd))
                c.execute(insert(obligations).values(obligation_id=obligation_id,creditor_domain=creditor_domain,debtor_domain=debtor_domain,resource="USD",amount_minor=consequence_usd_minor,authorization_id=eac.authorization_id,operation_id=eac.operation_id,state="BILATERALLY_COMMITTED",evidence_json="[]"))
                return "COMMITTED",cd
        except IntegrityError:
            return "ATOMIC_UNIQUENESS_VIOLATION",None

    def close(self): self.engine.dispose()
