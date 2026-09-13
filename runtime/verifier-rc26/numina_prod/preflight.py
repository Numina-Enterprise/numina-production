from __future__ import annotations
import os,stat
from dataclasses import asdict
from .frozen import verify_frozen_core
from .conformance import load_result
from . import CORE_VERSION,PRODUCTION_VERSION
from .signing import load_identity


def run_preflight(settings)->dict:
    checks=[];failures=[]

    frozen=verify_frozen_core()
    checks.append({"name":"frozen-core","ok":frozen.valid,"checked":frozen.checked,"manifest_root":frozen.manifest_root})
    if not frozen.valid:failures.extend(frozen.failures)

    conf=load_result()
    conf_ok=(conf.get("valid") is True and conf.get("frozen_core_valid") is True
        and conf.get("core_version")==CORE_VERSION and conf.get("frozen_manifest_root")==frozen.manifest_root
        and frozen.valid and conf.get("return_code")==0 and int(conf.get("passing_tests",0) or 0)>=309)
    checks.append({"name":"core-conformance","ok":conf_ok,"passing_tests":int(conf.get("passing_tests",0) or 0),"captured_at":conf.get("captured_at"),"source_production_version":conf.get("production_version"),"scope":"historical frozen-core evidence; no rc26 execution result asserted"})
    if not conf_ok:failures.append("CORE_CONFORMANCE_UNHEALTHY")

    checks.append({
        "name":"runtime-control-state",
        "ok":True,
        "runtime_controls_configurable":bool(settings.runtime_controls_configurable),
        "real_funds_enabled":bool(settings.real_funds_enabled),
        "employer_ip_enabled":bool(settings.employer_ip_enabled),
        "public_execution_api_enabled":bool(settings.public_execution_api_enabled),
        "testnet_execution_enabled":bool(settings.testnet_execution_enabled),
        "circle_testnet_submit_enabled":bool(settings.circle_testnet_submit_enabled),
        "note":"configuration gates are operator-controlled; capability availability is evaluated separately",
    })

    key_ok=True;key_detail="ephemeral-test-key"
    if settings.production:
        if settings.signing_key_der_env:
            try:
                identity=load_identity(None,allow_ephemeral=False,der_env=settings.signing_key_der_env,expected_public_key_b64=settings.signing_public_key_b64)
                key_ok=True;key_detail="persistent-environment-key:"+identity.key_id
            except Exception:
                key_ok=False;key_detail="environment-key-invalid"
        elif settings.signing_key_file is not None and settings.signing_key_file.exists():
            mode=stat.S_IMODE(settings.signing_key_file.stat().st_mode)
            key_ok=(mode & 0o077)==0
            key_detail=f"mode={oct(mode)}"
        else:key_ok=False;key_detail="missing"
    circle_ok=True
    circle_detail="disabled"
    if settings.circle_testnet_submit_enabled:
        import shutil
        resolved=shutil.which(settings.circle_cli_path)
        circle_ok=bool(resolved)
        circle_detail=resolved or "circle cli unavailable"
    checks.append({"name":"circle-testnet-adapter","ok":circle_ok,"detail":circle_detail,"enabled":bool(settings.circle_testnet_submit_enabled)})
    if not circle_ok:failures.append("CIRCLE_TESTNET_ADAPTER_NOT_READY")

    checks.append({"name":"release-signing-key","ok":key_ok,"detail":key_detail})
    if not key_ok:failures.append("RELEASE_SIGNING_KEY_UNSAFE_OR_MISSING")

    if settings.production and settings.evidence_network_enabled:
        try:
            from .evidence_network import create_evidence_store
            store=create_evidence_store(path=settings.data_dir/"evidence-network.sqlite3",database_url=settings.evidence_database_url)
            durable=bool(getattr(store,"durable",False))
            evidence_ok=durable or not settings.evidence_require_durable
            backend=getattr(store,"backend","unknown")
        except Exception:
            evidence_ok=False;durable=False;backend="unavailable"
        checks.append({"name":"evidence-datastore","ok":evidence_ok,"backend":backend,"durable":durable})
        if not evidence_ok:failures.append("EVIDENCE_DATASTORE_NOT_READY")
        owner_ok=bool(settings.owner_access_url and settings.owner_root_hash)
        checks.append({"name":"evidence-owner-authentication","ok":owner_ok,"scope":"runtime:evidence","revocation_route_exposed":False})
        if not owner_ok:failures.append("OWNER_AUTHORITY_NOT_CONFIGURED")

    datastore=None
    if settings.role=="authority-node":
        try:
            from .commit_store import SQLAlchemyCommitStore
            store=SQLAlchemyCommitStore(
                settings.database_url,create_schema=False,
                max_retries=settings.database_max_retries,
                connect_timeout_seconds=settings.database_connect_timeout_seconds,
                statement_timeout_ms=settings.database_statement_timeout_ms,
                lock_timeout_ms=settings.database_lock_timeout_ms,
                production_version=PRODUCTION_VERSION,
            )
            datastore=store.datastore_status();store.close()
            ds_ok=bool(datastore.get("schema_compatible"))
            if settings.production:
                ds_ok=ds_ok and datastore.get("dialect")=="postgresql" and str(datastore.get("isolation_level","")).upper()=="SERIALIZABLE"
        except Exception as e:
            datastore={"ready":False,"error_type":type(e).__name__};ds_ok=False
        checks.append({"name":"authority-datastore","ok":ds_ok,"status":datastore})
        if not ds_ok:failures.append("AUTHORITY_DATASTORE_NOT_READY")

    return {
        "valid":not failures,
        "production_version":PRODUCTION_VERSION,
        "environment":settings.environment,
        "role":settings.role,
        "checks":checks,
        "failures":list(failures),
    }
