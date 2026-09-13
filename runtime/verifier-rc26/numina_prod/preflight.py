from __future__ import annotations
import os,stat
from dataclasses import asdict
from .frozen import verify_frozen_core
from .conformance import load_result
from . import PRODUCTION_VERSION


def run_preflight(settings)->dict:
    checks=[];failures=[]

    frozen=verify_frozen_core()
    checks.append({"name":"frozen-core","ok":frozen.valid,"checked":frozen.checked,"manifest_root":frozen.manifest_root})
    if not frozen.valid:failures.extend(frozen.failures)

    conf=load_result()
    conf_ok=bool(conf.get("valid")) and int(conf.get("passing_tests",0) or 0)>=309
    checks.append({"name":"core-conformance","ok":conf_ok,"passing_tests":int(conf.get("passing_tests",0) or 0)})
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
        key_ok=settings.signing_key_file is not None and settings.signing_key_file.exists()
        if key_ok:
            mode=stat.S_IMODE(settings.signing_key_file.stat().st_mode)
            key_ok=(mode & 0o077)==0
            key_detail=f"mode={oct(mode)}"
        else:key_detail="missing"
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
