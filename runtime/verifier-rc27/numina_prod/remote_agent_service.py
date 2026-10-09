from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .deploy_provider import DeployError, DeploySpec, get_provider
from .remote_execution import (
    REMOTE_RECEIPT_TYPE,
    ReplayStore,
    digest_json,
    verify_remote_command,
)
from .signing import SigningIdentity, load_identity


class RemoteAgentConfig:
    def __init__(self):
        self.controller_public_key_b64=os.getenv("NUMINA_REMOTE_CONTROLLER_PUBLIC_KEY_B64","").strip()
        self.agent_signing_key_file=os.getenv("NUMINA_REMOTE_AGENT_SIGNING_KEY_FILE","").strip()
        self.workload_identity=os.getenv("NUMINA_REMOTE_AGENT_WORKLOAD_IDENTITY","").strip()
        self.trust_domain=os.getenv("NUMINA_REMOTE_AGENT_TRUST_DOMAIN","").strip()
        self.replay_store_path=Path(
            os.getenv("NUMINA_REMOTE_REPLAY_STORE","/var/lib/numina/remote-replay.json")
        )
        self.allowed_roles=tuple(
            x.strip() for x in os.getenv(
                "NUMINA_REMOTE_ALLOWED_ROLES","public-verifier"
            ).split(",") if x.strip()
        )
        self.allowed_providers=tuple(
            x.strip() for x in os.getenv(
                "NUMINA_REMOTE_ALLOWED_PROVIDERS","docker,kubernetes"
            ).split(",") if x.strip()
        )

    def validate(self):
        missing=[]
        if not self.controller_public_key_b64:
            missing.append("NUMINA_REMOTE_CONTROLLER_PUBLIC_KEY_B64")
        if not self.agent_signing_key_file:
            missing.append("NUMINA_REMOTE_AGENT_SIGNING_KEY_FILE")
        if not self.workload_identity:
            missing.append("NUMINA_REMOTE_AGENT_WORKLOAD_IDENTITY")
        if not self.trust_domain:
            missing.append("NUMINA_REMOTE_AGENT_TRUST_DOMAIN")
        if missing:
            raise RuntimeError("missing remote agent config: "+",".join(missing))
        if not self.workload_identity.startswith("spiffe://"):
            raise RuntimeError("remote agent workload identity must be a SPIFFE ID")


def _spec_from_payload(payload:dict)->DeploySpec:
    spec=payload.get("deployment_spec")
    if not isinstance(spec,dict):
        raise DeployError("REMOTE_DEPLOYMENT_SPEC_MISSING")
    return DeploySpec(**spec)


def create_remote_agent_app(
    config:RemoteAgentConfig|None=None,
    *,
    provider_factory:Callable[[str],object]=get_provider,
)->FastAPI:
    config=config or RemoteAgentConfig()
    config.validate()
    signer=load_identity(Path(config.agent_signing_key_file),allow_ephemeral=False)
    replay=ReplayStore(config.replay_store_path)

    app=FastAPI(
        title="Numina Remote Execution Agent",
        version="1.9.0-rc27",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/healthz")
    def healthz():
        return {
            "status":"ok",
            "role":"remote-execution-agent",
            "workload_identity":config.workload_identity,
        }

    @app.post("/v1/remote-execution")
    async def remote_execution(request:Request):
        envelope=await request.json()
        verification=verify_remote_command(
            envelope,
            trusted_public_key_b64=config.controller_public_key_b64,
            expected_workload_identity=config.workload_identity,
            expected_trust_domain=config.trust_domain,
            replay_store=replay,
            allowed_roles=config.allowed_roles,
        )
        if not verification.valid:
            raise HTTPException(
                status_code=403,
                detail={
                    "code":"REMOTE_COMMAND_DENIED",
                    "reasons":list(verification.reasons),
                },
            )

        command=verification.command or {}
        spec=_spec_from_payload(command)

        if spec.role not in config.allowed_roles:
            raise HTTPException(status_code=403,detail={"code":"REMOTE_ROLE_NOT_ALLOWED"})
        if spec.provider not in config.allowed_providers:
            raise HTTPException(status_code=403,detail={"code":"REMOTE_PROVIDER_NOT_ALLOWED"})

        provider=provider_factory(spec.provider)
        try:
            if command["action"]=="apply":
                result=provider.apply(spec)
            elif command["action"]=="status":
                result=provider.status(spec)
            elif command["action"]=="verify":
                result=provider.verify(spec)
            elif command["action"]=="rollback":
                result=provider.rollback(spec)
            else:
                raise DeployError("REMOTE_ACTION_NOT_ALLOWED")
        except DeployError as exc:
            raise HTTPException(
                status_code=409,
                detail={"code":"REMOTE_PROVIDER_FAILURE","reason":str(exc)},
            )

        payload={
            "command_digest":verification.command_digest,
            "agent_identity":config.workload_identity,
            "trust_domain":config.trust_domain,
            "deployment_id":spec.deployment_id,
            "provider":spec.provider,
            "status":result.status,
            "provider_ref":result.provider_ref,
            "artifact_sha256":spec.artifact_sha256,
        }
        receipt=signer.sign(payload,REMOTE_RECEIPT_TYPE)
        return JSONResponse({
            "status":result.status,
            "deployment_ref":result.provider_ref,
            "agent_identity":config.workload_identity,
            "receipt":receipt,
        })

    return app
