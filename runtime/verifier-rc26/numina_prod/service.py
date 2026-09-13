from __future__ import annotations
import base64,json,time,uuid
from decimal import Decimal
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI,HTTPException,Request
from fastapi.responses import JSONResponse,FileResponse,PlainTextResponse
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel
from prometheus_client import Counter,Histogram,generate_latest,CONTENT_TYPE_LATEST
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .config import load_settings
from .frozen import ROOT,verify_frozen_core
from .signing import load_identity,verify_envelope
from .release import release_status,release_descriptor
from .supply_chain import verify_supply_chain_artifacts
from .preflight import run_preflight
from .control_gateway import evaluate_control_request
from .execution_adapters import provider_catalog,prepare_execution_handoff,bind_external_evidence
from .circle_agent_adapter import CircleTestnetAdapter,CircleTestnetConfig,PROVIDER_SUBMISSION_TYPE,PROVIDER_RECONCILIATION_TYPE
from .arc_verification import ArcExternalVerifier,ArcVerificationConfig,EXECUTION_VERIFIED_TYPE
from .evidence_network import create_evidence_store,normalize_intelligence_evidence,build_evidence_bundle,INTELLIGENCE_EVIDENCE_TYPE,EVIDENCE_BUNDLE_TYPE
from .owner_access import require_owner_access
from numina.status import StatusWitness,SignedStatusWitness,verify_witness
from numina.checkpoints import ConstitutionalCheckpoint,SignedCheckpoint,verify_checkpoint

REQUESTS=Counter("numina_http_requests_total","HTTP requests",["method","path","status"])
LATENCY=Histogram("numina_http_request_seconds","HTTP request latency",["method","path"])

class Envelope(BaseModel):
    artifact_type:str;key_id:str;payload:dict;algorithm:str;public_key:str;signature:str
class WitnessVerifyRequest(BaseModel):
    witness:dict;signature_hex:str;public_key_b64:str;current_sequence:int;highest_seen:int=-1;expected_prev:str|None=None
class CheckpointVerifyRequest(BaseModel):
    checkpoint:dict;signature_hex:str;public_key_b64:str;highest_sequence:int=-1;expected_previous:str|None=None;required_constitution:str|None=None
class ControlEvaluateRequest(BaseModel):
    action:str
    observations:list[dict]=[]
    policy:dict={}
class ExecutionPrepareRequest(BaseModel):
    provider:str
    intent:dict
    control_receipt:dict
class ExternalEvidenceRequest(BaseModel):
    provider:str
    handoff_receipt:dict
    evidence:dict
class CircleSubmitRequest(BaseModel):
    handoff_receipt:dict
class CircleReconcileRequest(BaseModel):
    submission_receipt:dict
class ArcVerifyRequest(BaseModel):
    control_receipt:dict
    handoff_receipt:dict
    submission_receipt:dict
class IntelligenceEvidenceRequest(BaseModel):
    provider:str
    subject:dict
    evidence:dict
class EvidenceBundleRequest(BaseModel):
    control_receipt:dict
    handoff_receipt:dict
    submission_receipt:dict
    verification_receipt:dict
    intelligence_receipts:list[dict]=[]
class VerificationJobRequest(BaseModel):
    control_receipt:dict
    handoff_receipt:dict
    submission_receipt:dict


def create_app(settings=None, *, arc_rpc_transport=None)->FastAPI:
    settings=settings or load_settings()
    if settings.role != "public-verifier":
        settings.data_dir.mkdir(parents=True,exist_ok=True)
    identity=load_identity(settings.signing_key_file,allow_ephemeral=settings.allow_ephemeral_key,der_env=settings.signing_key_der_env,expected_public_key_b64=settings.signing_public_key_b64)
    circle_adapter=CircleTestnetAdapter(CircleTestnetConfig(
        enabled=bool(settings.circle_testnet_submit_enabled),
        cli_path=settings.circle_cli_path,
        timeout_seconds=settings.circle_submit_timeout_seconds,
        max_usdc=Decimal(settings.circle_testnet_max_usdc),
        journal_dir=settings.data_dir/"circle-submissions",
        allowed_chains=settings.circle_allowed_testnet_chains,
    ))
    evidence_store=create_evidence_store(path=settings.data_dir/"evidence-network.sqlite3",database_url=settings.evidence_database_url)
    if settings.production and settings.evidence_network_enabled and settings.evidence_require_durable and not getattr(evidence_store,"durable",False):
        raise RuntimeError("production evidence store is not durable")
    arc_verifier=ArcExternalVerifier(ArcVerificationConfig(
        enabled=bool(settings.arc_verification_enabled),
        rpc_urls=settings.arc_rpc_urls,
        rpc_quorum=settings.arc_rpc_quorum,
        timeout_seconds=settings.arc_rpc_timeout_seconds,
        chain_id=settings.arc_chain_id,
        usdc_system_contract=settings.arc_usdc_system_contract,
        required_confirmations=settings.arc_required_confirmations,
    ), transport=arc_rpc_transport)

    @asynccontextmanager
    async def lifespan(app):
        frozen=verify_frozen_core()
        app.state.frozen=frozen
        app.state.ready=(frozen.valid or not settings.require_frozen_core)
        yield

    app=FastAPI(
        title="Numina Public Verification Plane",
        version="1.9.0-rc26",
        description="Public verification, control, settlement-evidence, and build-attestation surface for Numina Core v1.8. rc26 makes hosted runtime state reconstructible from explicit signing and durable-storage configuration.",
        lifespan=lifespan,
        docs_url=None if settings.production else "/docs",
        redoc_url=None if settings.production else "/redoc",
        openapi_url=None if settings.production else "/openapi.json",
    )
    app.state.settings=settings;app.state.identity=identity
    if settings.trusted_hosts:
        app.add_middleware(TrustedHostMiddleware,allowed_hosts=list(settings.trusted_hosts)+([settings.public_url.split('://',1)[-1].split('/')[0]] if settings.public_url else []))

    @app.middleware("http")
    async def controls(request:Request,call_next):
        rid=request.headers.get("x-request-id") or uuid.uuid4().hex
        started=time.monotonic()
        try:
            await require_owner_access(request,settings)
            response=await call_next(request)
        except HTTPException as exc:
            response=JSONResponse({"detail":exc.detail,"request_id":rid},status_code=exc.status_code)
        except Exception:
            response=JSONResponse({"detail":"internal error","request_id":rid},status_code=500)
        response.headers["X-Request-ID"]=rid
        response.headers["X-Content-Type-Options"]="nosniff"
        response.headers["X-Frame-Options"]="DENY"
        response.headers["Referrer-Policy"]="no-referrer"
        response.headers["Permissions-Policy"]="camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        response.headers["Cross-Origin-Opener-Policy"]="same-origin"
        response.headers["Cross-Origin-Resource-Policy"]="same-origin"
        response.headers["X-Permitted-Cross-Domain-Policies"]="none"
        if settings.production: response.headers["Strict-Transport-Security"]="max-age=31536000; includeSubDomains"
        duration=time.monotonic()-started
        path=request.url.path
        if path.startswith(("/v1/status","/v1/control/state","/v1/release/","/v1/preflight","/readyz","/status")):
            response.headers["Cache-Control"]="no-store"
        REQUESTS.labels(request.method,path,str(response.status_code)).inc();LATENCY.labels(request.method,path).observe(duration)
        return response

    @app.get("/healthz",include_in_schema=False)
    def healthz():return {"status":"ok","service":"numina-public-verifier"}

    @app.get("/v1/bootstrap/attestation")
    def bootstrap_attestation():
        payload={
            "schema":"numina.bootstrap-attestation.v1",
            "release":"1.9.0-rc26",
            "core_version":"1.8.0",
            "signing_key_id":identity.key_id,
            "evidence_store_backend":getattr(evidence_store,"backend","unknown"),
            "evidence_store_durable":bool(getattr(evidence_store,"durable",False)),
            "evidence_durable_required":bool(settings.evidence_require_durable),
            "public_execution_api_enabled":bool(settings.public_execution_api_enabled),
            "real_funds_enabled":bool(settings.real_funds_enabled),
            "employer_ip_enabled":bool(settings.employer_ip_enabled),
            "frozen_core_valid":bool(verify_frozen_core().valid),
            "generated_at":int(time.time()),
        }
        return {"bootstrap":payload,"receipt":identity.sign(payload,"NUMINA_BOOTSTRAP_ATTESTATION")}

    @app.get("/readyz",include_in_schema=False)
    def readyz():
        pf=run_preflight(settings)
        if not pf["valid"]:
            raise HTTPException(503,"production preflight failed")
        response={"status":"ready","frozen_core":True,"conformance":next(x["passing_tests"] for x in pf["checks"] if x["name"]=="core-conformance")}
        ds=next((x.get("status") for x in pf["checks"] if x["name"]=="authority-datastore"),None)
        if ds:
            response["datastore"]={k:ds.get(k) for k in ("dialect","schema_version","supported_schema_version","schema_compatible","isolation_level")}
        return response

    @app.get("/v1/preflight")
    def preflight_status():
        pf=run_preflight(settings)
        # The preflight response contains no secrets or database URL.
        return pf

    @app.get("/v1/status")
    def status():return release_status(settings)

    @app.get("/v1/capabilities")
    def capabilities():
        return {
          "category":"Economic Authority Infrastructure",
          "core":"v1.8 deterministic constitutional runtime",
          "production_plane":"v1.9.0-rc26",
          "planes":["authority","control","evidence"],
          "implemented":["EAC verification","proof-carrying authority programs","status witnesses","witness quorum","federation","continuous constitutional runtime","rights runtime","institutional compiler","constitutional market","clearing stability","public build verification","governed datastore schema","serializable transaction retry contract","SPDX software bill of materials","SLSA-format build provenance","reproducible release packaging","operator-side deploy provider","provider-neutral control gateway","signed policy-decision receipts","capability-scoped execution adapter kernel","signed execution-handoff receipts","external evidence bindings","Circle Agent Wallet testnet submission adapter","provider reconciliation receipts","independent Arc RPC quorum verifier","signed execution-verification receipts"],
          "runtime_control_model":"operator-configurable",
          "configured_controls":{
              "real_funds_enabled":bool(settings.real_funds_enabled),
              "employer_ip_enabled":bool(settings.employer_ip_enabled),
              "public_execution_api_enabled":bool(settings.public_execution_api_enabled),
              "testnet_execution_enabled":bool(settings.testnet_execution_enabled),
              "circle_testnet_submit_enabled":bool(settings.circle_testnet_submit_enabled),
              "arc_verification_enabled":bool(settings.arc_verification_enabled),
              "evidence_network_enabled":bool(settings.evidence_network_enabled),
          },
          "not_exposed_by_public_verifier":["custody","broker execution","private keys","mainnet wallet signing"],
          "circle_testnet_adapter":circle_adapter.capability(),
          "arc_independent_verifier":arc_verifier.capability(),
          "evidence_store":{"backend":getattr(evidence_store,"backend","unknown"),"durable":bool(getattr(evidence_store,"durable",False))},
        }

    @app.get("/v1/control/state")
    def control_state():
        payload={
            "schema":"numina.control-state.v1",
            "release":"1.9.0-rc26",
            "runtime_controls_configurable":bool(settings.runtime_controls_configurable),
            "real_funds_enabled":bool(settings.real_funds_enabled),
            "employer_ip_enabled":bool(settings.employer_ip_enabled),
            "public_execution_api_enabled":bool(settings.public_execution_api_enabled),
            "public_execution_route_exposed":True,
            "testnet_execution_enabled":bool(settings.testnet_execution_enabled),
            "circle_testnet_submit_enabled":bool(settings.circle_testnet_submit_enabled),
            "arc_verification_enabled":bool(settings.arc_verification_enabled),
              "evidence_network_enabled":bool(settings.evidence_network_enabled),
        }
        return {"state":payload,"receipt":identity.sign(payload,"NUMINA_CONTROL_STATE")}

    @app.post("/v1/control/evaluate")
    def control_evaluate(body:ControlEvaluateRequest):
        decision=evaluate_control_request(
            action=body.action,observations=body.observations,policy=body.policy,
            execution_controls={
                "real_funds_enabled":bool(settings.real_funds_enabled),
                "public_execution_api_enabled":bool(settings.public_execution_api_enabled),
              "testnet_execution_enabled":bool(settings.testnet_execution_enabled),
              "circle_testnet_submit_enabled":bool(settings.circle_testnet_submit_enabled),
            },
        )
        payload={
            "schema":"numina.control-decision.v1",
            "release":"1.9.0-rc26",
            **decision.as_dict(),
        }
        return {
            "decision":payload,
            "receipt":identity.sign(payload,"NUMINA_CONTROL_DECISION"),
            "external_execution_performed":False,
        }


    @app.get("/v1/execution/providers")
    def execution_providers():
        return {
            "schema":"numina.execution-provider-catalog.v1",
            "release":"1.9.0-rc26",
            "providers":provider_catalog(),
            "live_submission_route_exposed":True,
            "circle_testnet_adapter":circle_adapter.capability(),
          "arc_independent_verifier":arc_verifier.capability(),
        }

    @app.post("/v1/execution/prepare")
    def execution_prepare(body:ExecutionPrepareRequest):
        try:
            payload=prepare_execution_handoff(
                provider=body.provider,
                intent=body.intent,
                control_receipt=body.control_receipt,
                trusted_numina_public_key_b64=identity.public_key_b64,
            )
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
        return {
            "handoff":payload,
            "receipt":identity.sign(payload,"NUMINA_EXECUTION_HANDOFF"),
            "external_execution_performed":False,
        }

    @app.post("/v1/execution/submit/circle-testnet")
    def execution_submit_circle_testnet(body:CircleSubmitRequest):
        if not settings.public_execution_api_enabled or not settings.testnet_execution_enabled:
            raise HTTPException(403,"TESTNET_EXECUTION_CONTROL_GATE_CLOSED")
        try:
            payload=circle_adapter.submit(
                handoff_receipt=body.handoff_receipt,
                trusted_numina_public_key_b64=identity.public_key_b64,
            )
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
        return {
            "submission":payload,
            "receipt":identity.sign(payload,PROVIDER_SUBMISSION_TYPE),
        }

    @app.post("/v1/execution/reconcile/circle-testnet")
    def execution_reconcile_circle_testnet(body:CircleReconcileRequest):
        if not settings.public_execution_api_enabled or not settings.testnet_execution_enabled:
            raise HTTPException(403,"TESTNET_EXECUTION_CONTROL_GATE_CLOSED")
        try:
            payload=circle_adapter.reconcile(
                submission_receipt=body.submission_receipt,
                trusted_numina_public_key_b64=identity.public_key_b64,
            )
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
        return {
            "reconciliation":payload,
            "receipt":identity.sign(payload,PROVIDER_RECONCILIATION_TYPE),
        }


    @app.post("/v1/execution/verify/arc-testnet")
    def execution_verify_arc_testnet(body:ArcVerifyRequest):
        try:
            payload=arc_verifier.verify(
                control_receipt=body.control_receipt,
                handoff_receipt=body.handoff_receipt,
                submission_receipt=body.submission_receipt,
                trusted_numina_public_key_b64=identity.public_key_b64,
            )
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
        receipt=identity.sign(payload,EXECUTION_VERIFIED_TYPE)
        record=None
        if settings.evidence_network_enabled:
            record=evidence_store.put_artifact(state="VERIFIED",artifact_type=EXECUTION_VERIFIED_TYPE,artifact=receipt,tx_hash=payload.get("tx_hash"),handoff_id=payload.get("handoff_id"))
        return {"verification":payload,"receipt":receipt,"record":record}

    @app.post("/v1/intelligence/evidence")
    def intelligence_evidence(body:IntelligenceEvidenceRequest):
        if not settings.evidence_network_enabled: raise HTTPException(503,"EVIDENCE_NETWORK_DISABLED")
        try: payload=normalize_intelligence_evidence(provider=body.provider,subject=body.subject,evidence=body.evidence)
        except ValueError as exc: raise HTTPException(400,str(exc)) from exc
        receipt=identity.sign(payload,INTELLIGENCE_EVIDENCE_TYPE)
        record=evidence_store.put_artifact(state="INTELLIGENCE",artifact_type=INTELLIGENCE_EVIDENCE_TYPE,artifact=receipt)
        return {"evidence":payload,"receipt":receipt,"record":record}

    @app.post("/v1/evidence/bundles")
    def evidence_bundle(body:EvidenceBundleRequest):
        if not settings.evidence_network_enabled: raise HTTPException(503,"EVIDENCE_NETWORK_DISABLED")
        try:
            payload=build_evidence_bundle(control_receipt=body.control_receipt,handoff_receipt=body.handoff_receipt,submission_receipt=body.submission_receipt,verification_receipt=body.verification_receipt,intelligence_receipts=body.intelligence_receipts,trusted_numina_public_key_b64=identity.public_key_b64)
        except ValueError as exc: raise HTTPException(400,str(exc)) from exc
        receipt=identity.sign(payload,EVIDENCE_BUNDLE_TYPE)
        record=evidence_store.put_artifact(state="BUNDLED",artifact_type=EVIDENCE_BUNDLE_TYPE,artifact=receipt,tx_hash=payload.get("tx_hash"),handoff_id=payload.get("handoff_id"))
        return {"bundle":payload,"receipt":receipt,"record":record}

    @app.post("/v1/evidence/jobs")
    def create_verification_job(body:VerificationJobRequest):
        if not settings.evidence_network_enabled: raise HTTPException(503,"EVIDENCE_NETWORK_DISABLED")
        if not settings.arc_verification_enabled: raise HTTPException(503,"VERIFICATION_PROVIDER_DISABLED")
        for receipt,kind in ((body.control_receipt,"NUMINA_CONTROL_DECISION"),(body.handoff_receipt,"NUMINA_EXECUTION_HANDOFF"),(body.submission_receipt,PROVIDER_SUBMISSION_TYPE)):
            if not verify_envelope(receipt,expected_public_key_b64=identity.public_key_b64,expected_type=kind):
                raise HTTPException(400,"INVALID_RECEIPT_CHAIN")
        sub=dict(body.submission_receipt.get("payload") or {}); hand=dict(body.handoff_receipt.get("payload") or {})
        tx=str(sub.get("tx_hash") or ""); hid=str(hand.get("handoff_id") or "")
        if not tx or not hid: raise HTTPException(400,"TX_HASH_AND_HANDOFF_REQUIRED")
        request_payload=body.model_dump()
        try: job=evidence_store.create_job(tx_hash=tx,handoff_id=hid,request_payload=request_payload,ttl_seconds=settings.evidence_job_ttl_seconds)
        except ValueError as exc: raise HTTPException(400,str(exc)) from exc
        return job

    @app.post("/v1/evidence/jobs/{job_id}/run")
    def run_verification_job(job_id:str):
        if not settings.evidence_network_enabled: raise HTTPException(503,"EVIDENCE_NETWORK_DISABLED")
        job=evidence_store.get_job(job_id)
        if not job: raise HTTPException(404,"VERIFICATION_JOB_NOT_FOUND")
        if job["status"]=="VERIFIED": return job
        if int(time.time())>=job["expires_at"]:
            failed=evidence_store.mark_job_failure(job_id,"VERIFICATION_JOB_EXPIRED")
            return failed
        req=job["request"]
        try:
            payload=arc_verifier.verify(control_receipt=req["control_receipt"],handoff_receipt=req["handoff_receipt"],submission_receipt=req["submission_receipt"],trusted_numina_public_key_b64=identity.public_key_b64)
            receipt=identity.sign(payload,EXECUTION_VERIFIED_TYPE)
            record=evidence_store.put_artifact(state="VERIFIED",artifact_type=EXECUTION_VERIFIED_TYPE,artifact=receipt,tx_hash=payload.get("tx_hash"),handoff_id=payload.get("handoff_id"))
            return evidence_store.mark_job_success(job_id,record["record_id"])
        except Exception as exc:
            return evidence_store.mark_job_failure(job_id,str(exc))

    @app.get("/v1/evidence/transactions/{tx_hash}")
    def transaction_evidence(tx_hash:str):
        return {"tx_hash":tx_hash.lower(),"records":evidence_store.records_for_tx(tx_hash)}

    @app.post("/v1/verify/evidence-bundle")
    def verify_evidence_bundle(envelope:Envelope):
        return {"valid":verify_envelope(envelope.model_dump(),expected_public_key_b64=identity.public_key_b64,expected_type=EVIDENCE_BUNDLE_TYPE),"trusted_key_id":identity.key_id}

    @app.post("/v1/execution/evidence/bind")
    def execution_evidence_bind(body:ExternalEvidenceRequest):
        try:
            payload=bind_external_evidence(
                provider=body.provider,
                handoff_receipt=body.handoff_receipt,
                evidence=body.evidence,
                trusted_numina_public_key_b64=identity.public_key_b64,
            )
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
        return {
            "binding":payload,
            "receipt":identity.sign(payload,"NUMINA_EXTERNAL_EVIDENCE_BINDING"),
        }

    @app.get("/v1/release/manifest")
    def release_manifest():
        return release_descriptor(settings)

    @app.get("/v1/release/supply-chain")
    def release_supply_chain():
        descriptor=release_descriptor(settings)
        check=verify_supply_chain_artifacts(
            build_id=descriptor["build_id"],
            production_files_root=descriptor["production_files_root"],
        )
        return {
            **check,
            "spdx_version":"SPDX-2.3",
            "slsa_predicate_type":"https://slsa.dev/provenance/v1",
            "slsa_level_claimed":None,
            "hosted_attestation_required_for_level_claim":True,
        }

    @app.get("/v1/release/sbom")
    def release_sbom():
        path=ROOT/"artifacts/software-bom.spdx.json"
        if not path.exists():raise HTTPException(404,"SBOM unavailable")
        return JSONResponse(json.loads(path.read_text()))

    @app.get("/v1/release/build-provenance")
    def release_build_provenance():
        path=ROOT/"artifacts/build-provenance.intoto.json"
        if not path.exists():raise HTTPException(404,"build provenance unavailable")
        return JSONResponse(json.loads(path.read_text()))

    @app.get("/v1/release/attestation")
    def release_attestation():
        payload=release_status(settings)
        return identity.sign(payload,"NUMINA_RELEASE_ATTESTATION")

    @app.post("/v1/verify/release-attestation")
    def verify_release_attestation(envelope:Envelope):
        valid=verify_envelope(envelope.model_dump(),expected_public_key_b64=identity.public_key_b64,expected_type="NUMINA_RELEASE_ATTESTATION")
        return {"valid":valid,"trusted_key_id":identity.key_id}

    @app.get("/v1/keys/release-verification")
    def release_key():return {"algorithm":"Ed25519","key_id":identity.key_id,"public_key":identity.public_key_b64}

    @app.post("/v1/verify/status-witness")
    def verify_status_witness(body:WitnessVerifyRequest):
        try:
            w=StatusWitness(**body.witness)
            sw=SignedStatusWitness(w,body.signature_hex)
            pk=Ed25519PublicKey.from_public_bytes(base64.b64decode(body.public_key_b64))
            ok,reason=verify_witness(sw,pk,body.current_sequence,body.highest_seen,body.expected_prev)
            return {"valid":ok,"reason":reason,"trust_asserted":False,"status_root":w.status_root}
        except Exception as e:
            return {"valid":False,"reason":"INVALID_INPUT","trust_asserted":False}

    @app.post("/v1/verify/checkpoint")
    def verify_checkpoint_endpoint(body:CheckpointVerifyRequest):
        try:
            cp=ConstitutionalCheckpoint(**body.checkpoint)
            sc=SignedCheckpoint(cp,body.signature_hex)
            pk=Ed25519PublicKey.from_public_bytes(base64.b64decode(body.public_key_b64))
            ok,reason=verify_checkpoint(sc,pk,highest_sequence=body.highest_sequence,expected_previous=body.expected_previous,required_constitution=body.required_constitution)
            return {"valid":ok,"reason":reason,"trust_asserted":False,"checkpoint_digest":cp.checkpoint_digest}
        except Exception:
            return {"valid":False,"reason":"INVALID_INPUT","trust_asserted":False}

    @app.get("/metrics",include_in_schema=False)
    def metrics():return PlainTextResponse(generate_latest().decode(),media_type=CONTENT_TYPE_LATEST)

    site=ROOT/"site"
    @app.get("/",include_in_schema=False)
    def home():return FileResponse(site/"index.html")
    @app.get("/status",include_in_schema=False)
    def status_page():return FileResponse(site/"status.html")
    @app.get("/site.css",include_in_schema=False)
    def css():return FileResponse(site/"site.css",media_type="text/css")
    @app.get("/site.js",include_in_schema=False)
    def js():return FileResponse(site/"site.js",media_type="application/javascript")
    @app.get("/.well-known/security.txt",include_in_schema=False)
    def security_txt():
        base=(settings.public_url or "https://www.numinalabs.xyz").rstrip("/")
        contact=base+"/status"
        return PlainTextResponse(
            "Contact: "+contact+"\nPolicy: "+contact+"\nCanonical: "+base+"/.well-known/security.txt\nExpires: 2027-09-10T00:00:00Z\n"
        )

    @app.get("/sitemap.xml",include_in_schema=False)
    def sitemap():
        base=(settings.public_url or "https://www.numinalabs.xyz").rstrip("/")
        xml=(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<url><loc>'+base+'/</loc></url>'
            '<url><loc>'+base+'/status</loc></url>'
            '</urlset>\n'
        )
        return PlainTextResponse(xml,media_type="application/xml")

    @app.get("/site.webmanifest",include_in_schema=False)
    def webmanifest():
        return JSONResponse({
            "name":"Numina Labs",
            "short_name":"Numina",
            "start_url":"/",
            "display":"standalone",
            "description":"Economic Authority Infrastructure"
        })

    @app.get("/robots.txt",include_in_schema=False)
    def robots():return PlainTextResponse("User-agent: *\nAllow: /\n")
    return app

app=create_app()
