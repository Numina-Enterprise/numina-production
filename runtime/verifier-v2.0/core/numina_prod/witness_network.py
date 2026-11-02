from __future__ import annotations

import hashlib
import json
import urllib.request
from dataclasses import asdict, dataclass
from typing import Callable

from .deploy_provider import DeployError
from .signing import SigningIdentity, verify_envelope

WITNESS_ATTESTATION_TYPE="NUMINA_CONVERGENCE_WITNESS_ATTESTATION"
WITNESS_QUORUM_RECEIPT_TYPE="NUMINA_CONVERGENCE_WITNESS_QUORUM"


def _canonical(v:dict)->bytes:
    return json.dumps(v,sort_keys=True,separators=(",",":")).encode()


def digest_json(v:dict)->str:
    return hashlib.sha256(_canonical(v)).hexdigest()


@dataclass(frozen=True)
class Witness:
    witness_id:str
    endpoint:str
    expected_public_key_b64:str
    required:bool=True

    def __post_init__(self):
        if not self.witness_id:
            raise ValueError("witness_id is required")
        if not self.endpoint.startswith("https://"):
            raise ValueError("witness endpoint must use https://")
        if not self.expected_public_key_b64:
            raise ValueError("expected witness public key is required")


@dataclass(frozen=True)
class WitnessPolicy:
    minimum_valid_witnesses:int=1
    require_all_required_witnesses:bool=True

    def __post_init__(self):
        if self.minimum_valid_witnesses < 1:
            raise ValueError("minimum_valid_witnesses must be >= 1")


class HTTPSWitnessClient:
    def __init__(self,opener=urllib.request.urlopen):
        self.opener=opener

    def publish(self,witness:Witness,checkpoint:dict)->dict:
        body=_canonical(checkpoint)
        req=urllib.request.Request(
            witness.endpoint.rstrip("/")+"/v1/witness",
            data=body,
            method="POST",
            headers={
                "Content-Type":"application/json",
                "User-Agent":"numina-prod-witness-client",
            },
        )
        try:
            with self.opener(req,timeout=30) as response:
                if getattr(response,"status",200) >= 300:
                    raise DeployError("WITNESS_HTTP_FAILURE")
                return json.loads(response.read().decode() or "{}")
        except DeployError:
            raise
        except Exception as exc:
            raise DeployError(
                f"WITNESS_UNREACHABLE:{type(exc).__name__}"
            ) from exc


def verify_witness_attestation(
    attestation:dict,
    *,
    witness:Witness,
    expected_checkpoint_digest:str,
    expected_journal_head_digest:str|None,
)->bool:
    if not verify_envelope(
        attestation,
        expected_public_key_b64=witness.expected_public_key_b64,
        expected_type=WITNESS_ATTESTATION_TYPE,
    ):
        return False
    payload=attestation.get("payload",{})
    return (
        payload.get("witness_id")==witness.witness_id
        and payload.get("checkpoint_digest")==expected_checkpoint_digest
        and payload.get("journal_head_digest")==expected_journal_head_digest
    )


class WitnessCoordinator:
    def __init__(
        self,
        identity:SigningIdentity,
        *,
        client:HTTPSWitnessClient|None=None,
    ):
        self.identity=identity
        self.client=client or HTTPSWitnessClient()

    def corroborate(
        self,
        *,
        checkpoint:dict,
        witnesses:tuple[Witness,...],
        policy:WitnessPolicy,
    )->dict:
        if not witnesses:
            raise DeployError("NO_WITNESSES_CONFIGURED")
        ids=[w.witness_id for w in witnesses]
        if len(ids)!=len(set(ids)):
            raise DeployError("DUPLICATE_WITNESS_ID")

        checkpoint_digest=digest_json(checkpoint)
        journal_head=checkpoint.get("payload",{}).get("journal_head_digest")

        valid=[]
        failures=[]
        required_failures=[]

        for witness in witnesses:
            try:
                response=self.client.publish(witness,checkpoint)
                attestation=response.get("attestation",response)
                ok=verify_witness_attestation(
                    attestation,
                    witness=witness,
                    expected_checkpoint_digest=checkpoint_digest,
                    expected_journal_head_digest=journal_head,
                )
                if ok:
                    valid.append({
                        "witness_id":witness.witness_id,
                        "endpoint":witness.endpoint,
                        "attestation_digest":digest_json(attestation),
                    })
                else:
                    failures.append({
                        "witness_id":witness.witness_id,
                        "reason":"WITNESS_ATTESTATION_INVALID",
                    })
                    if witness.required:
                        required_failures.append(witness.witness_id)
            except Exception as exc:
                failures.append({
                    "witness_id":witness.witness_id,
                    "reason":f"{type(exc).__name__}:{exc}",
                })
                if witness.required:
                    required_failures.append(witness.witness_id)

        allowed=len(valid) >= policy.minimum_valid_witnesses
        if policy.require_all_required_witnesses and required_failures:
            allowed=False

        payload={
            "checkpoint_digest":checkpoint_digest,
            "journal_head_digest":journal_head,
            "policy":asdict(policy),
            "valid_witnesses":valid,
            "failures":failures,
            "required_failures":required_failures,
            "allowed":allowed,
        }
        receipt=self.identity.sign(payload,WITNESS_QUORUM_RECEIPT_TYPE)

        if not allowed:
            raise DeployError(
                "WITNESS_QUORUM_FAILED:"+
                json.dumps({
                    "valid":len(valid),
                    "minimum":policy.minimum_valid_witnesses,
                    "required_failures":required_failures,
                },sort_keys=True)
            )

        return {
            "allowed":True,
            "valid_witnesses":valid,
            "failures":failures,
            "quorum_receipt":receipt,
            "quorum_digest":digest_json(payload),
        }


def create_witness_attestation(
    identity:SigningIdentity,
    *,
    witness_id:str,
    checkpoint:dict,
)->dict:
    return identity.sign(
        {
            "witness_id":witness_id,
            "checkpoint_digest":digest_json(checkpoint),
            "journal_head_digest":checkpoint.get("payload",{}).get(
                "journal_head_digest"
            ),
        },
        WITNESS_ATTESTATION_TYPE,
    )
