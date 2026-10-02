from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request

from .convergence_journal import CONVERGENCE_CHECKPOINT_TYPE
from .deploy_provider import DeployError
from .signing import load_identity, verify_envelope
from .witness_network import create_witness_attestation


class WitnessLedger:
    def __init__(self,path:Path):
        self.path=Path(path)

    def _load(self)->dict:
        if not self.path.exists():
            return {"deployments":{}}
        try:
            data=json.loads(self.path.read_text())
        except Exception as exc:
            raise DeployError("WITNESS_LEDGER_CORRUPT") from exc
        if not isinstance(data,dict) or not isinstance(data.get("deployments"),dict):
            raise DeployError("WITNESS_LEDGER_CORRUPT")
        return data

    def _save(self,state:dict):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        tmp=self.path.with_suffix(self.path.suffix+".tmp")
        tmp.write_text(json.dumps(state,sort_keys=True,indent=2)+"\n")
        os.replace(tmp,self.path)

    def observe(self,*,deployment_id:str,journal_head_digest:str|None,checkpoint_digest:str)->dict:
        state=self._load()
        current=state["deployments"].get(deployment_id)

        if current is None:
            state["deployments"][deployment_id]={
                "journal_head_digest":journal_head_digest,
                "checkpoint_digests":[checkpoint_digest],
            }
            self._save(state)
            return {"accepted":True,"equivocation":False}

        if current["journal_head_digest"] != journal_head_digest:
            return {
                "accepted":False,
                "equivocation":True,
                "previous_journal_head_digest":current["journal_head_digest"],
                "observed_journal_head_digest":journal_head_digest,
            }

        if checkpoint_digest not in current["checkpoint_digests"]:
            current["checkpoint_digests"].append(checkpoint_digest)
            self._save(state)

        return {"accepted":True,"equivocation":False}

    def snapshot(self)->dict:
        return self._load()


class WitnessServiceConfig:
    def __init__(self):
        self.witness_id=os.getenv("NUMINA_WITNESS_ID","").strip()
        self.signing_key_file=os.getenv("NUMINA_WITNESS_SIGNING_KEY_FILE","").strip()
        self.controller_public_key_b64=os.getenv("NUMINA_WITNESS_CONTROLLER_PUBLIC_KEY_B64","").strip()
        self.ledger_path=Path(os.getenv("NUMINA_WITNESS_LEDGER","/var/lib/numina/witness-ledger.json"))

    def validate(self):
        missing=[]
        if not self.witness_id: missing.append("NUMINA_WITNESS_ID")
        if not self.signing_key_file: missing.append("NUMINA_WITNESS_SIGNING_KEY_FILE")
        if not self.controller_public_key_b64: missing.append("NUMINA_WITNESS_CONTROLLER_PUBLIC_KEY_B64")
        if missing:
            raise RuntimeError("missing witness config: "+",".join(missing))


def create_witness_app(config:WitnessServiceConfig|None=None)->FastAPI:
    config=config or WitnessServiceConfig()
    config.validate()

    signer=load_identity(Path(config.signing_key_file),allow_ephemeral=False)
    ledger=WitnessLedger(config.ledger_path)

    app=FastAPI(
        title="Numina Independent Witness",
        version="1.9.0-rc27",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/healthz")
    def healthz():
        return {
            "status":"ok",
            "role":"independent-witness",
            "witness_id":config.witness_id,
        }

    @app.get("/v1/witness/state")
    def witness_state():
        return {
            "witness_id":config.witness_id,
            "state":ledger.snapshot(),
        }

    @app.post("/v1/witness")
    async def witness(request:Request):
        checkpoint=await request.json()

        if not verify_envelope(
            checkpoint,
            expected_public_key_b64=config.controller_public_key_b64,
            expected_type=CONVERGENCE_CHECKPOINT_TYPE,
        ):
            raise HTTPException(
                status_code=403,
                detail={"code":"CHECKPOINT_SIGNATURE_INVALID"},
            )

        payload=checkpoint.get("payload",{})
        deployment_id=payload.get("deployment_id")
        if not deployment_id:
            raise HTTPException(
                status_code=400,
                detail={"code":"CHECKPOINT_DEPLOYMENT_ID_MISSING"},
            )

        from .witness_network import digest_json
        checkpoint_digest=digest_json(checkpoint)
        observed=ledger.observe(
            deployment_id=deployment_id,
            journal_head_digest=payload.get("journal_head_digest"),
            checkpoint_digest=checkpoint_digest,
        )
        if observed["equivocation"]:
            raise HTTPException(
                status_code=409,
                detail={
                    "code":"CHECKPOINT_EQUIVOCATION_DETECTED",
                    **observed,
                },
            )

        attestation=create_witness_attestation(
            signer,
            witness_id=config.witness_id,
            checkpoint=checkpoint,
        )
        return {
            "accepted":True,
            "witness_id":config.witness_id,
            "attestation":attestation,
        }

    return app
