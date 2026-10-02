from __future__ import annotations
import json,time
from hashlib import sha256
from pathlib import Path
from . import CORE_VERSION,PRODUCTION_VERSION
from .frozen import ROOT,verify_frozen_core
from .conformance import load_result
from .schema_contract import SCHEMA_VERSION,SCHEMA_NAME

def core_release_binding(settings)->dict:
    frozen=verify_frozen_core()
    return {
        "schema":"numina.rc27.core-binding.v1","product":"Numina","application_version":"4.0.0",
        "release":settings.release,"production_version":PRODUCTION_VERSION,"release_series":"rc27",
        "canonical_root_hash":"51116c98ae1c5a9f58a59ff5c801a6b99413a3ef773a01091042866d4ee55db2",
        "root_count":1,"lineage_count":1,"layers":["L1","L2","L3","L4","L5","L6","L7"],
        "core_version":CORE_VERSION,"frozen_core_manifest_root":frozen.manifest_root,
        "frozen_core_valid":frozen.valid,"frozen_core_checked_files":frozen.checked,
        "frozen_source_policy":"preserved_exact_bytes","historical_conformance_relabelled":False,
        "scope":"One rc27 release binds the preserved core and canonical Numina root; no financial execution or reserve verification is established."
    }


def _artifact_hash(name:str)->str|None:
    p=ROOT/"artifacts"/name
    return sha256(p.read_bytes()).hexdigest() if p.exists() else None


def production_files_root()->str:
    included=[]
    for base in ["numina_prod","deploy","site","tests_prod",".github/workflows"]:
        p=ROOT/base
        if not p.exists():continue
        for f in sorted(x for x in p.rglob("*") if x.is_file() and "__pycache__" not in x.parts):
            included.append((f.relative_to(ROOT).as_posix(),sha256(f.read_bytes()).hexdigest()))
    for name in ["Dockerfile","requirements.production.txt","requirements.public-verifier.txt","requirements.authority-node.txt","PRODUCTION.md"]:
        f=ROOT/name
        if f.exists():included.append((name,sha256(f.read_bytes()).hexdigest()))
    data="\n".join(f"{h} {p}" for p,h in sorted(included)).encode()
    return sha256(data).hexdigest()


def release_status(settings)->dict:
    frozen=verify_frozen_core();conf=load_result();descriptor=release_descriptor(settings)
    return {
        **descriptor,
        "environment":settings.environment,
        "role":settings.role,
        "frozen_core":{"valid":frozen.valid,"manifest_root":frozen.manifest_root,"checked_files":frozen.checked,"failures":list(frozen.failures)},
        "conformance":conf,
        "control_state":{
            "runtime_controls_configurable":bool(settings.runtime_controls_configurable),
            "real_funds_enabled":bool(settings.real_funds_enabled),
            "employer_ip_enabled":bool(settings.employer_ip_enabled),
            "public_execution_api_enabled":bool(settings.public_execution_api_enabled),
            "testnet_execution_enabled":bool(settings.testnet_execution_enabled),
            "circle_testnet_submit_enabled":bool(settings.circle_testnet_submit_enabled),
            "arc_verification_enabled":bool(settings.arc_verification_enabled),
            "evidence_network_enabled":bool(settings.evidence_network_enabled),
        },
        "generated_at":int(time.time()),
    }



def build_identity(settings)->dict:
    frozen=verify_frozen_core();conf=load_result();prod_root=production_files_root()
    stable={
        "product":"Numina Economic Authority Infrastructure",
        "core_release_binding":core_release_binding(settings),
        "core_version":CORE_VERSION,
        "production_version":PRODUCTION_VERSION,
        "release":settings.release,
        "frozen_core_manifest_root":frozen.manifest_root,
        "frozen_core_valid":frozen.valid,
        "frozen_core_checked_files":frozen.checked,
        "core_conformance_valid":bool(conf.get("valid",False)),
        "core_conformance_passing_tests":int(conf.get("passing_tests",0) or 0),
        "production_files_root":prod_root,
        "authority_store_schema_name":SCHEMA_NAME,
        "authority_store_schema_version":SCHEMA_VERSION,
        "production_postgres_isolation":"SERIALIZABLE",
        "runtime_controls_configurable":bool(settings.runtime_controls_configurable),
        "public_execution_api_enabled":bool(settings.public_execution_api_enabled),
        "testnet_execution_enabled":bool(settings.testnet_execution_enabled),
        "circle_testnet_submit_enabled":bool(settings.circle_testnet_submit_enabled),
        "arc_verification_enabled":bool(settings.arc_verification_enabled),
        "arc_chain_id":int(settings.arc_chain_id),
        "arc_required_confirmations":int(settings.arc_required_confirmations),
        "arc_rpc_quorum":int(settings.arc_rpc_quorum),
        "evidence_network_enabled":bool(settings.evidence_network_enabled),
        "evidence_job_ttl_seconds":int(settings.evidence_job_ttl_seconds),
        "real_funds_enabled":bool(settings.real_funds_enabled),
        "employer_ip_enabled":bool(settings.employer_ip_enabled),
    }
    stable["build_id"]=sha256(json.dumps(stable,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    return stable


def release_descriptor(settings)->dict:
    stable=build_identity(settings)
    return {
        **stable,
        "core_conformance_artifact_sha256":_artifact_hash("core-conformance.json"),
        "release_gate_artifact_sha256":_artifact_hash("release-gate.json"),
        "spdx_sbom_sha256":_artifact_hash("software-bom.spdx.json"),
        "slsa_provenance_sha256":_artifact_hash("build-provenance.intoto.json"),
        "slsa_predicate_type":"https://slsa.dev/provenance/v1",
        "slsa_level_claimed":None,
    }
