from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .deploy_provider import DeployError, DeploySpec, spec_fingerprint
from .signing import SigningIdentity, verify_envelope


REMOTE_COMMAND_TYPE = "NUMINA_REMOTE_DEPLOY_COMMAND"
REMOTE_RECEIPT_TYPE = "NUMINA_REMOTE_DEPLOY_RECEIPT"


def canonical_bytes(value: dict) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


def digest_json(value: dict) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


@dataclass(frozen=True)
class RemoteAgentTarget:
    agent_url: str
    workload_identity: str
    trust_domain: str
    allowed_roles: tuple[str, ...] = ("public-verifier",)

    def __post_init__(self):
        if not self.agent_url.startswith("https://"):
            raise ValueError("remote agent URL must use https://")
        if not self.workload_identity.startswith("spiffe://"):
            raise ValueError("remote workload identity must be a SPIFFE ID")
        if not self.trust_domain:
            raise ValueError("remote trust domain is required")


@dataclass(frozen=True)
class RemoteDeployCommand:
    command_id: str
    action: str
    deployment_id: str
    deployment_fingerprint: str
    deployment_spec: dict
    artifact_sha256: str
    role: str
    environment: str
    target_workload_identity: str
    trust_domain: str
    issued_at: int
    expires_at: int
    nonce: str

    def __post_init__(self):
        if self.action not in {"apply", "status", "verify", "rollback"}:
            raise ValueError("unsupported remote action")
        if self.expires_at <= self.issued_at:
            raise ValueError("remote command expiry must follow issue time")


@dataclass(frozen=True)
class RemoteVerification:
    valid: bool
    reasons: tuple[str, ...]
    command: dict | None
    command_digest: str | None


def issue_remote_command(
    identity: SigningIdentity,
    spec: DeploySpec,
    target: RemoteAgentTarget,
    *,
    action: str,
    ttl_seconds: int = 120,
    now: int | None = None,
) -> dict:
    if spec.role not in target.allowed_roles:
        raise DeployError("REMOTE_ROLE_NOT_ALLOWED")
    now = int(time.time()) if now is None else int(now)
    command = RemoteDeployCommand(
        command_id=secrets.token_hex(16),
        action=action,
        deployment_id=spec.deployment_id,
        deployment_fingerprint=spec_fingerprint(spec),
        deployment_spec=asdict(spec),
        artifact_sha256=spec.artifact_sha256,
        role=spec.role,
        environment=spec.environment,
        target_workload_identity=target.workload_identity,
        trust_domain=target.trust_domain,
        issued_at=now,
        expires_at=now + ttl_seconds,
        nonce=secrets.token_hex(24),
    )
    return identity.sign(asdict(command), REMOTE_COMMAND_TYPE)


class ReplayStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def _load(self) -> dict:
        if not self.path.exists():
            return {"used_nonces": {}}
        try:
            return json.loads(self.path.read_text())
        except Exception as exc:
            raise DeployError("REMOTE_REPLAY_STORE_CORRUPT") from exc

    def _save(self, state: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        temp.write_text(json.dumps(state, sort_keys=True, indent=2) + "\n")
        os.replace(temp, self.path)

    def consume(self, nonce: str, expires_at: int, *, now: int) -> bool:
        state = self._load()
        fresh = {
            n: exp for n, exp in state["used_nonces"].items()
            if int(exp) >= now
        }
        if nonce in fresh:
            return False
        fresh[nonce] = int(expires_at)
        self._save({"used_nonces": fresh})
        return True


def _verify_signature(envelope: dict, trusted_public_key_b64: str) -> bool:
    return verify_envelope(
        envelope,
        expected_public_key_b64=trusted_public_key_b64,
        expected_type=REMOTE_COMMAND_TYPE,
    )


def verify_remote_command(
    envelope: dict,
    *,
    trusted_public_key_b64: str,
    expected_workload_identity: str,
    expected_trust_domain: str,
    replay_store: ReplayStore,
    allowed_roles: tuple[str, ...] = ("public-verifier",),
    now: int | None = None,
) -> RemoteVerification:
    now = int(time.time()) if now is None else int(now)
    reasons=[]

    if not _verify_signature(envelope, trusted_public_key_b64):
        reasons.append("REMOTE_SIGNATURE_INVALID")
        return RemoteVerification(False, tuple(reasons), None, None)

    command=envelope.get("payload", {})
    if int(command.get("issued_at", 0)) > now + 30:
        reasons.append("REMOTE_COMMAND_FROM_FUTURE")
    if int(command.get("expires_at", 0)) < now:
        reasons.append("REMOTE_COMMAND_EXPIRED")
    if command.get("target_workload_identity") != expected_workload_identity:
        reasons.append("REMOTE_WORKLOAD_IDENTITY_MISMATCH")
    if command.get("trust_domain") != expected_trust_domain:
        reasons.append("REMOTE_TRUST_DOMAIN_MISMATCH")
    if command.get("role") not in allowed_roles:
        reasons.append("REMOTE_ROLE_NOT_ALLOWED")

    try:
        signed_spec=DeploySpec(**command["deployment_spec"])
        if spec_fingerprint(signed_spec) != command.get("deployment_fingerprint"):
            reasons.append("REMOTE_DEPLOYMENT_FINGERPRINT_MISMATCH")
        if signed_spec.artifact_sha256 != command.get("artifact_sha256"):
            reasons.append("REMOTE_ARTIFACT_BINDING_MISMATCH")
        if signed_spec.deployment_id != command.get("deployment_id"):
            reasons.append("REMOTE_DEPLOYMENT_ID_MISMATCH")
        if signed_spec.role != command.get("role"):
            reasons.append("REMOTE_ROLE_BINDING_MISMATCH")
        if signed_spec.environment != command.get("environment"):
            reasons.append("REMOTE_ENVIRONMENT_BINDING_MISMATCH")
    except Exception:
        reasons.append("REMOTE_DEPLOYMENT_SPEC_INVALID")

    if reasons:
        return RemoteVerification(
            False, tuple(reasons), command, digest_json(command)
        )

    nonce=command.get("nonce")
    if not nonce or not replay_store.consume(
        nonce, int(command["expires_at"]), now=now
    ):
        reasons.append("REMOTE_COMMAND_REPLAY")

    return RemoteVerification(
        not reasons, tuple(reasons), command, digest_json(command)
    )


class HTTPSRemoteExecutionClient:
    """Controller-side client for a Numina Remote Execution Agent."""

    def __init__(self, target: RemoteAgentTarget, opener=urllib.request.urlopen):
        self.target=target
        self.opener=opener

    def invoke(self, signed_command: dict) -> dict:
        body=canonical_bytes(signed_command)
        request=urllib.request.Request(
            self.target.agent_url.rstrip("/") + "/v1/remote-execution",
            data=body,
            method="POST",
            headers={
                "Content-Type":"application/json",
                "Digest":"sha-256=" + base64.b64encode(
                    hashlib.sha256(body).digest()
                ).decode(),
                "User-Agent":"numina-prod-remote-controller",
            },
        )
        try:
            with self.opener(request, timeout=60) as response:
                raw=response.read().decode() or "{}"
                if getattr(response, "status", 200) >= 300:
                    raise DeployError("REMOTE_AGENT_HTTP_FAILURE")
                return json.loads(raw)
        except DeployError:
            raise
        except Exception as exc:
            raise DeployError(
                f"REMOTE_AGENT_UNREACHABLE:{type(exc).__name__}"
            ) from exc


def verify_remote_receipt(
    receipt: dict,
    *,
    expected_command_digest: str,
    expected_agent_identity: str,
) -> bool:
    try:
        return (
            receipt.get("type") == REMOTE_RECEIPT_TYPE
            and receipt["payload"]["command_digest"] == expected_command_digest
            and receipt["payload"]["agent_identity"] == expected_agent_identity
            and receipt["payload"]["status"] in {
                "accepted", "deployed", "running", "verified", "rolled-back"
            }
        )
    except Exception:
        return False
