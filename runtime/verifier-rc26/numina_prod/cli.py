from __future__ import annotations
import argparse,json,subprocess,sys
from .config import load_settings
from .frozen import verify_frozen_core
from .conformance import write_result
from .release import release_status
from .signing import load_identity,verify_envelope
from .deploy_provider import (
    DeploySpec,DeployError,get_provider,enforce_role_boundary,
    write_plan,read_plan,deployment_receipt,verify_deployment_receipt,
    DeploymentJournal,DeploymentManager
)
from . import PRODUCTION_VERSION
from .deploy_policy import DeployAdmissionPolicy,evaluate_admission
from pathlib import Path


def main():
    p=argparse.ArgumentParser(prog="numina-prod")
    sub=p.add_subparsers(dest="cmd",required=True)
    sub.add_parser("verify-core")
    sub.add_parser("conformance")
    sub.add_parser("status")
    sub.add_parser("preflight")
    sub.add_parser("migrate-schema")
    sub.add_parser("database-status")
    serve=sub.add_parser("serve");serve.add_argument("--host",default="0.0.0.0");serve.add_argument("--port",type=int,default=8080)

    deploy=sub.add_parser("deploy")
    deploy_sub=deploy.add_subparsers(dest="deploy_cmd",required=True)

    verify_att=deploy_sub.add_parser("verify-attestation")
    verify_att.add_argument("--bundle",required=True)
    verify_att.add_argument("--backend",choices=["cosign","reference"],default="cosign")
    verify_att.add_argument("--backend",choices=["cosign","reference"],default="cosign")
    verify_att.add_argument("--artifact-sha256",required=True)
    verify_att.add_argument("--identity",action="append",default=[])
    verify_att.add_argument("--oidc-issuer",action="append",default=[])
    verify_att.add_argument("--predicate",action="append",default=["https://slsa.dev/provenance/v1"])
    verify_att.add_argument("--builder",action="append",default=[])
    verify_att.add_argument("--allow-no-transparency-log",action="store_true")

    plan=deploy_sub.add_parser("plan")
    plan.add_argument("--provider",required=True,choices=["docker","oci","kubernetes","k8s","https","remote"])
    plan.add_argument("--artifact",required=True)
    plan.add_argument("--artifact-sha256",required=True)
    plan.add_argument("--deployment-id",required=True)
    plan.add_argument("--role",default="public-verifier",choices=["public-verifier","authority-node","witness"])
    plan.add_argument("--environment",default="production",choices=["staging","production"])
    plan.add_argument("--target",default="")
    plan.add_argument("--image",default="")
    plan.add_argument("--namespace",default="numina")
    plan.add_argument("--service-name",default="numina-public-verifier")
    plan.add_argument("--public-url")
    plan.add_argument("--metadata-json",default="{}")
    plan.add_argument("--output",required=True)

    for name in ("apply","status","verify","rollback","policy-check"):
        q=deploy_sub.add_parser(name)
        q.add_argument("--plan",required=True)
        q.add_argument("--allow-authority-node",action="store_true")
        if name=="apply":
            q.add_argument("--receipt-out")
            q.add_argument("--policy")
            q.add_argument("--hosted-attestations",type=int,default=0)
            q.add_argument("--hosted-attestation",action="append",default=[])
        if name=="verify":
            q.add_argument("--receipt")
        if name=="policy-check":
            q.add_argument("--policy",required=True)
            q.add_argument("--hosted-attestations",type=int,default=0)
            q.add_argument("--hosted-attestation",action="append",default=[])

    args=p.parse_args();settings=load_settings()
    if args.cmd=="verify-core":
        r=verify_frozen_core();print(json.dumps(r.__dict__,indent=2,default=list));raise SystemExit(0 if r.valid else 1)
    if args.cmd=="conformance":
        from .frozen import ROOT
        r=write_result(ROOT/"artifacts/core-conformance.json");raise SystemExit(0 if r.valid else 1)
    if args.cmd=="status":print(json.dumps(release_status(settings),indent=2));return
    if args.cmd=="preflight":
        from .preflight import run_preflight
        out=run_preflight(settings);print(json.dumps(out,indent=2));raise SystemExit(0 if out["valid"] else 1)
    if args.cmd in {"migrate-schema","database-status"}:
        if not settings.database_url:raise SystemExit("NUMINA_DATABASE_URL is required")
        from .commit_store import SQLAlchemyCommitStore
        store=SQLAlchemyCommitStore(
            settings.database_url,create_schema=(args.cmd=="migrate-schema"),
            max_retries=settings.database_max_retries,
            connect_timeout_seconds=settings.database_connect_timeout_seconds,
            statement_timeout_ms=settings.database_statement_timeout_ms,
            lock_timeout_ms=settings.database_lock_timeout_ms,
            production_version=PRODUCTION_VERSION
        )
        print(json.dumps(store.datastore_status(),indent=2));store.close();return
    if args.cmd=="deploy":
        if args.deploy_cmd=="verify-attestation":
            from .hosted_attestation import verifier_for_backend,load_bundle
            bundle_path=Path(args.bundle)
            r=verifier_for_backend(args.backend).verify(
                load_bundle(bundle_path),
                descriptor_path=bundle_path,
                accepted_identities=tuple(args.identity),
                accepted_oidc_issuers=tuple(args.oidc_issuer),
                expected_artifact_sha256=args.artifact_sha256,
                accepted_predicate_types=tuple(args.predicate),
                accepted_builder_ids=tuple(args.builder),
                require_transparency_log=not args.allow_no_transparency_log,
            )
            print(json.dumps({
                "valid":r.valid,"backend":r.backend,"reasons":list(r.reasons),
                "identity":r.identity,"oidc_issuer":r.oidc_issuer,
                "artifact_sha256":r.artifact_sha256,
                "predicate_type":r.predicate_type,
                "builder_id":r.builder_id,
                "transparency_included":r.transparency_included,
                "evidence_digest":r.evidence_digest,
            },indent=2))
            raise SystemExit(0 if r.valid else 2)

        if args.deploy_cmd=="plan":
            metadata=json.loads(args.metadata_json)
            spec=DeploySpec(
                deployment_id=args.deployment_id,
                provider=args.provider,
                artifact=args.artifact,
                artifact_sha256=args.artifact_sha256,
                role=args.role,
                environment=args.environment,
                target=args.target,
                image=args.image,
                namespace=args.namespace,
                service_name=args.service_name,
                public_url=args.public_url,
                metadata=metadata,
            )
            write_plan(spec,Path(args.output))
            print(json.dumps({"valid":True,"plan":args.output,"role":spec.role,"provider":spec.provider},indent=2))
            return

        spec=read_plan(Path(args.plan))
        identity=load_identity(
            settings.signing_key_file,
            allow_ephemeral=settings.allow_ephemeral_key
        )
        journal=DeploymentJournal(settings.data_dir/"deployments.json")
        manager=DeploymentManager(journal,identity)

        if args.deploy_cmd=="policy-check":
            policy=DeployAdmissionPolicy.from_json(Path(args.policy))
            decision=evaluate_admission(
                spec,policy,
                signing_key_persistent=(settings.signing_key_file is not None and settings.signing_key_file.exists()),
                hosted_attestation_count=args.hosted_attestations,
                hosted_attestation_paths=tuple(args.hosted_attestation),
            )
            print(json.dumps({
                "allowed":decision.allowed,
                "policy_id":decision.policy_id,
                "policy_digest":decision.policy_digest,
                "reasons":list(decision.reasons),
                "evidence":decision.evidence,
            },indent=2))
            raise SystemExit(0 if decision.allowed else 2)

        if args.deploy_cmd=="apply":
            policy=DeployAdmissionPolicy.from_json(Path(args.policy)) if args.policy else None
            try:
                result,receipt,idempotent=manager.apply(
                    spec,
                    allow_authority_node=args.allow_authority_node,
                    admission_policy=policy,
                    signing_key_persistent=(settings.signing_key_file is not None and settings.signing_key_file.exists()),
                    hosted_attestation_count=args.hosted_attestations,
                    hosted_attestation_paths=tuple(args.hosted_attestation),
                )
            except DeployError as e:
                raise SystemExit(str(e))
            out={"result":result.__dict__,"idempotent":idempotent}
            if args.receipt_out:
                Path(args.receipt_out).write_text(
                    json.dumps(receipt,indent=2,sort_keys=True)+"\n"
                )
                out["receipt"]=args.receipt_out
                out["receipt_key_id"]=identity.key_id
            print(json.dumps(out,indent=2))
            return

        if args.deploy_cmd=="status":
            try:
                result=manager.status(spec)
            except DeployError as e:
                raise SystemExit(str(e))
            print(json.dumps(result.__dict__,indent=2))
            return

        if args.deploy_cmd=="verify":
            try:
                result,new_receipt=manager.verify(spec)
            except DeployError as e:
                raise SystemExit(str(e))
            out={"result":result.__dict__}
            if args.receipt:
                env=json.loads(Path(args.receipt).read_text())
                out["receipt_valid"]=verify_deployment_receipt(
                    env,expected_public_key_b64=identity.public_key_b64
                )
                if not out["receipt_valid"]:
                    raise SystemExit(1)
            out["verification_receipt"]=new_receipt
            print(json.dumps(out,indent=2))
            return

        if args.deploy_cmd=="rollback":
            try:
                result,receipt=manager.rollback(
                    spec,allow_authority_node=args.allow_authority_node
                )
            except DeployError as e:
                raise SystemExit(str(e))
            print(json.dumps(
                {"result":result.__dict__,"receipt":receipt},
                indent=2
            ))
            return

    if args.cmd=="serve":
        import uvicorn
        uvicorn.run("numina_prod.service:app",host=args.host,port=args.port,proxy_headers=True,forwarded_allow_ips="*")
if __name__=="__main__":main()
