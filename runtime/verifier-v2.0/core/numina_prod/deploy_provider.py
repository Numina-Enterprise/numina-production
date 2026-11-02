from __future__ import annotations

import hashlib
import json
import os
import shlex
import subprocess
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Callable, Protocol

from .signing import SigningIdentity, verify_envelope
from .supply_chain import sha256_file


class DeployError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeploySpec:
    deployment_id: str
    provider: str
    artifact: str
    artifact_sha256: str
    role: str = "public-verifier"
    environment: str = "production"
    target: str = ""
    image: str = ""
    namespace: str = "NUMINA"
    service_name: str = "numina-public-verifier"
    public_url: str | None = None
    metadata: dict | None = None

    def __post_init__(self):
        if self.role not in {"public-verifier", "authority-node", "witness"}:
            raise ValueError("unsupported deployment role")
        if self.environment not in {"staging", "production"}:
            raise ValueError("deployment environment must be staging or production")


@dataclass(frozen=True)
class DeployResult:
    deployment_id: str
    provider: str
    role: str
    environment: str
    target: str
    status: str
    artifact_sha256: str
    provider_ref: str | None = None
    detail: dict | None = None


class DeployProvider(Protocol):
    name: str

    def preflight(self, spec: DeploySpec) -> dict: ...
    def apply(self, spec: DeploySpec) -> DeployResult: ...
    def status(self, spec: DeploySpec) -> DeployResult: ...
    def verify(self, spec: DeploySpec) -> DeployResult: ...
    def rollback(self, spec: DeploySpec) -> DeployResult: ...


def _artifact_ok(spec: DeploySpec) -> None:
    path = Path(spec.artifact)
    if not path.exists() or not path.is_file():
        raise DeployError(f"artifact not found: {path}")
    actual = sha256_file(path)
    if actual != spec.artifact_sha256:
        raise DeployError(
            f"artifact checksum mismatch: expected {spec.artifact_sha256}, got {actual}"
        )


def verify_sidecars(spec: DeploySpec) -> dict:
    _artifact_ok(spec)
    path = Path(spec.artifact)
    checksum = path.with_suffix(path.suffix + ".sha256")
    provenance = path.with_suffix(path.suffix + ".intoto.json")

    if not checksum.exists():
        raise DeployError("release checksum sidecar missing")
    first = checksum.read_text().strip().split()
    if not first or first[0] != spec.artifact_sha256:
        raise DeployError("release checksum sidecar does not bind artifact")

    if not provenance.exists():
        raise DeployError("release provenance sidecar missing")
    doc = json.loads(provenance.read_text())
    subjects = doc.get("subject", [])
    if not any(
        item.get("name") == path.name
        and item.get("digest", {}).get("sha256") == spec.artifact_sha256
        for item in subjects
    ):
        raise DeployError("release provenance does not bind artifact")

    return {
        "artifact_valid": True,
        "checksum_sidecar": str(checksum),
        "provenance_sidecar": str(provenance),
    }


def deployment_receipt(
    identity: SigningIdentity,
    spec: DeploySpec,
    result: DeployResult,
    admission: dict | None = None,
) -> dict:
    payload = {
        "deployment": asdict(spec),
        "result": asdict(result),
        "admission": admission,
    }
    return identity.sign(payload, "NUMINA_DEPLOYMENT_RECEIPT")


def verify_deployment_receipt(
    envelope: dict,
    *,
    expected_public_key_b64: str | None = None,
) -> bool:
    return verify_envelope(
        envelope,
        expected_public_key_b64=expected_public_key_b64,
        expected_type="NUMINA_DEPLOYMENT_RECEIPT",
    )


class DockerOCIProvider:
    name = "docker"

    def __init__(
        self,
        runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    ):
        self.runner = runner

    @staticmethod
    def _binary() -> str:
        return os.getenv("NUMINA_DOCKER_BIN", "docker")

    def preflight(self, spec: DeploySpec) -> dict:
        verify_sidecars(spec)
        if not spec.image:
            raise DeployError("docker deployment requires image")
        if not spec.target:
            raise DeployError("docker deployment requires target/container name")
        cmd = [self._binary(), "version", "--format", "{{.Server.Version}}"]
        try:
            cp = self.runner(cmd, text=True, capture_output=True, timeout=15)
        except FileNotFoundError as exc:
            raise DeployError("docker/oci runtime unavailable") from exc
        if cp.returncode != 0:
            raise DeployError("docker/oci runtime preflight failed")
        return {"valid": True, "provider": self.name, "server_version": cp.stdout.strip()}

    def apply(self, spec: DeploySpec) -> DeployResult:
        self.preflight(spec)
        cmd = [
            self._binary(), "run", "-d", "--restart", "unless-stopped",
            "--name", spec.target,
            "-e", f"NUMINA_ENV={spec.environment}",
            "-e", f"NUMINA_ROLE={spec.role}",
        ]
        if spec.public_url:
            cmd += ["-e", f"NUMINA_PUBLIC_URL={spec.public_url}"]
        cmd += [spec.image]
        cp = self.runner(cmd, text=True, capture_output=True, timeout=120)
        if cp.returncode != 0:
            raise DeployError(f"docker deploy failed: {cp.stderr.strip()}")
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, "deployed", spec.artifact_sha256,
            provider_ref=cp.stdout.strip() or spec.target,
        )

    def status(self, spec: DeploySpec) -> DeployResult:
        cmd = [
            self._binary(), "inspect", "-f",
            "{{.State.Status}}", spec.target
        ]
        try:
            cp = self.runner(cmd, text=True, capture_output=True, timeout=30)
        except FileNotFoundError as exc:
            raise DeployError("docker/oci runtime unavailable") from exc
        if cp.returncode != 0:
            raise DeployError("docker deployment not found")
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, cp.stdout.strip(), spec.artifact_sha256,
            provider_ref=spec.target,
        )

    def verify(self, spec: DeploySpec) -> DeployResult:
        result = self.status(spec)
        if result.status != "running":
            raise DeployError(f"docker deployment is not running: {result.status}")
        return DeployResult(**{**asdict(result), "status": "verified"})

    def rollback(self, spec: DeploySpec) -> DeployResult:
        cmd = [self._binary(), "rm", "-f", spec.target]
        try:
            cp = self.runner(cmd, text=True, capture_output=True, timeout=60)
        except FileNotFoundError as exc:
            raise DeployError("docker/oci runtime unavailable") from exc
        if cp.returncode != 0:
            raise DeployError(f"docker rollback failed: {cp.stderr.strip()}")
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, "rolled-back", spec.artifact_sha256,
            provider_ref=spec.target,
        )


class KubernetesProvider:
    name = "kubernetes"

    def __init__(
        self,
        runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    ):
        self.runner = runner

    @staticmethod
    def _binary() -> str:
        return os.getenv("NUMINA_KUBECTL_BIN", "kubectl")

    def _base(self, spec: DeploySpec) -> list[str]:
        cmd = [self._binary()]
        if spec.target:
            cmd += ["--context", spec.target]
        return cmd

    def preflight(self, spec: DeploySpec) -> dict:
        verify_sidecars(spec)
        manifest = (spec.metadata or {}).get("manifest")
        if not manifest:
            raise DeployError("kubernetes deployment requires metadata.manifest")
        if not Path(manifest).exists():
            raise DeployError("kubernetes manifest not found")
        try:
            cp = self.runner(
                self._base(spec) + ["version", "--client=true", "-o", "json"],
                text=True, capture_output=True, timeout=20
            )
        except FileNotFoundError as exc:
            raise DeployError("kubectl unavailable") from exc
        if cp.returncode != 0:
            raise DeployError("kubectl preflight failed")
        return {"valid": True, "provider": self.name}

    def apply(self, spec: DeploySpec) -> DeployResult:
        self.preflight(spec)
        manifest = (spec.metadata or {})["manifest"]
        cp = self.runner(
            self._base(spec) + [
                "-n", spec.namespace, "apply", "-f", manifest
            ],
            text=True, capture_output=True, timeout=120
        )
        if cp.returncode != 0:
            raise DeployError(f"kubernetes apply failed: {cp.stderr.strip()}")
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, "deployed", spec.artifact_sha256,
            provider_ref=f"{spec.namespace}/{spec.service_name}",
            detail={"output": cp.stdout.strip()},
        )

    def status(self, spec: DeploySpec) -> DeployResult:
        cp = self.runner(
            self._base(spec) + [
                "-n", spec.namespace, "get", "deployment",
                spec.service_name, "-o", "json"
            ],
            text=True, capture_output=True, timeout=30
        )
        if cp.returncode != 0:
            raise DeployError("kubernetes deployment not found")
        data = json.loads(cp.stdout)
        desired = int(data.get("spec", {}).get("replicas", 0))
        available = int(data.get("status", {}).get("availableReplicas", 0))
        status = "running" if desired > 0 and available >= desired else "degraded"
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, status, spec.artifact_sha256,
            provider_ref=f"{spec.namespace}/{spec.service_name}",
            detail={"desired": desired, "available": available},
        )

    def verify(self, spec: DeploySpec) -> DeployResult:
        result = self.status(spec)
        if result.status != "running":
            raise DeployError("kubernetes deployment not fully available")
        return DeployResult(**{**asdict(result), "status": "verified"})

    def rollback(self, spec: DeploySpec) -> DeployResult:
        cp = self.runner(
            self._base(spec) + [
                "-n", spec.namespace, "rollout", "undo",
                f"deployment/{spec.service_name}"
            ],
            text=True, capture_output=True, timeout=60
        )
        if cp.returncode != 0:
            raise DeployError(f"kubernetes rollback failed: {cp.stderr.strip()}")
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, "rolled-back", spec.artifact_sha256,
            provider_ref=f"{spec.namespace}/{spec.service_name}",
        )


class HTTPSDeployProvider:
    name = "https"

    def __init__(self, opener=urllib.request.urlopen):
        self.opener = opener

    @staticmethod
    def _token() -> str:
        token = os.getenv("NUMINA_DEPLOY_BEARER_TOKEN", "").strip()
        if not token:
            raise DeployError("NUMINA_DEPLOY_BEARER_TOKEN is required")
        return token

    def _request(self, spec: DeploySpec, action: str, body: dict | None = None):
        if not spec.target.startswith("https://"):
            raise DeployError("HTTPS deploy target must use https://")
        token = self._token()
        url = spec.target.rstrip("/") + f"/{action}"
        payload = json.dumps(body or {"deployment_id": spec.deployment_id}).encode()
        req = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "numina-prod-deployer",
            },
        )
        try:
            with self.opener(req, timeout=60) as resp:
                raw = resp.read().decode() or "{}"
                return json.loads(raw), getattr(resp, "status", 200)
        except Exception as exc:
            raise DeployError(f"https deploy request failed: {type(exc).__name__}") from exc

    def preflight(self, spec: DeploySpec) -> dict:
        verify_sidecars(spec)
        self._token()
        if not spec.target.startswith("https://"):
            raise DeployError("HTTPS deploy target must use https://")
        return {"valid": True, "provider": self.name, "target": spec.target}

    def apply(self, spec: DeploySpec) -> DeployResult:
        self.preflight(spec)
        body = {
            "deployment_id": spec.deployment_id,
            "artifact_sha256": spec.artifact_sha256,
            "role": spec.role,
            "environment": spec.environment,
            "public_url": spec.public_url,
            "metadata": spec.metadata or {},
        }
        data, status = self._request(spec, "deploy", body)
        if status >= 300:
            raise DeployError(f"https deploy failed with status {status}")
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, data.get("status", "deployed"), spec.artifact_sha256,
            provider_ref=data.get("deployment_ref"),
            detail=data,
        )

    def status(self, spec: DeploySpec) -> DeployResult:
        data, status = self._request(spec, "status")
        if status >= 300:
            raise DeployError(f"https status failed with status {status}")
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, data.get("status", "unknown"), spec.artifact_sha256,
            provider_ref=data.get("deployment_ref"),
            detail=data,
        )

    def verify(self, spec: DeploySpec) -> DeployResult:
        data, status = self._request(spec, "verify")
        if status >= 300 or not data.get("valid", False):
            raise DeployError("https deployment verification failed")
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, "verified", spec.artifact_sha256,
            provider_ref=data.get("deployment_ref"),
            detail=data,
        )

    def rollback(self, spec: DeploySpec) -> DeployResult:
        data, status = self._request(spec, "rollback")
        if status >= 300:
            raise DeployError(f"https rollback failed with status {status}")
        return DeployResult(
            spec.deployment_id, self.name, spec.role, spec.environment,
            spec.target, data.get("status", "rolled-back"), spec.artifact_sha256,
            provider_ref=data.get("deployment_ref"),
            detail=data,
        )


class RemoteAgentProvider:
    name = "remote"

    @staticmethod
    def _target(spec: DeploySpec):
        from .remote_execution import RemoteAgentTarget
        meta=spec.metadata or {}
        agent_url=meta.get("agent_url") or spec.target
        workload_identity=meta.get("workload_identity")
        trust_domain=meta.get("trust_domain")
        if not agent_url or not workload_identity or not trust_domain:
            raise DeployError(
                "remote deployment requires agent_url, workload_identity, and trust_domain"
            )
        return RemoteAgentTarget(
            agent_url=agent_url,
            workload_identity=workload_identity,
            trust_domain=trust_domain,
            allowed_roles=tuple(meta.get("allowed_roles", ["public-verifier"])),
        )

    @staticmethod
    def _identity():
        from .signing import load_identity
        key=os.getenv("NUMINA_REMOTE_CONTROLLER_KEY_FILE","").strip()
        if not key:
            raise DeployError("NUMINA_REMOTE_CONTROLLER_KEY_FILE is required")
        path=Path(key)
        if not path.is_file():
            raise DeployError("remote controller signing key not found")
        return load_identity(path, allow_ephemeral=False)

    def preflight(self, spec: DeploySpec) -> dict:
        verify_sidecars(spec)
        target=self._target(spec)
        identity=self._identity()
        return {
            "valid": True,
            "provider": self.name,
            "agent_url": target.agent_url,
            "workload_identity": target.workload_identity,
            "trust_domain": target.trust_domain,
            "controller_key_id": identity.key_id,
        }

    def _invoke(self, spec: DeploySpec, action: str) -> DeployResult:
        from .remote_execution import (
            HTTPSRemoteExecutionClient,
            issue_remote_command,
            digest_json,
        )
        target=self._target(spec)
        identity=self._identity()
        command=issue_remote_command(identity, spec, target, action=action)
        response=HTTPSRemoteExecutionClient(target).invoke(command)
        status=response.get("status")
        if status not in {"accepted","deployed","running","verified","rolled-back"}:
            raise DeployError("REMOTE_AGENT_REJECTED")
        return DeployResult(
            deployment_id=spec.deployment_id,
            provider=self.name,
            role=spec.role,
            environment=spec.environment,
            target=target.agent_url,
            status=status,
            artifact_sha256=spec.artifact_sha256,
            provider_ref=response.get("deployment_ref"),
            detail={
                "agent_identity": response.get("agent_identity"),
                "command_digest": digest_json(command["payload"]),
                "response": response,
            },
        )

    def apply(self, spec: DeploySpec) -> DeployResult:
        self.preflight(spec)
        return self._invoke(spec, "apply")

    def status(self, spec: DeploySpec) -> DeployResult:
        return self._invoke(spec, "status")

    def verify(self, spec: DeploySpec) -> DeployResult:
        result=self._invoke(spec, "verify")
        if result.status != "verified":
            raise DeployError("remote deployment verification failed")
        return result

    def rollback(self, spec: DeploySpec) -> DeployResult:
        return self._invoke(spec, "rollback")


PROVIDERS = {
    "docker": DockerOCIProvider,
    "oci": DockerOCIProvider,
    "kubernetes": KubernetesProvider,
    "k8s": KubernetesProvider,
    "https": HTTPSDeployProvider,
    "remote": RemoteAgentProvider,
}


def get_provider(name: str) -> DeployProvider:
    key = name.strip().lower()
    cls = PROVIDERS.get(key)
    if cls is None:
        raise DeployError(f"unknown deploy provider: {name}")
    return cls()


def enforce_role_boundary(spec: DeploySpec, *, allow_authority_node: bool = False) -> None:
    if spec.role == "authority-node" and not allow_authority_node:
        raise DeployError(
            "authority-node deployment requires explicit --allow-authority-node"
        )


def write_plan(spec: DeploySpec, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(spec), indent=2, sort_keys=True) + "\n")


def read_plan(path: Path) -> DeploySpec:
    return DeploySpec(**json.loads(path.read_text()))

def spec_fingerprint(spec: DeploySpec) -> str:
    payload = json.dumps(asdict(spec), sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


class DeploymentJournal:
    def __init__(self, path: Path):
        self.path = Path(path)

    def _load(self) -> dict:
        if not self.path.exists():
            return {"deployments": {}}
        return json.loads(self.path.read_text())

    def _save(self, state: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        temp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
        os.replace(temp, self.path)

    def get(self, deployment_id: str) -> dict | None:
        return self._load()["deployments"].get(deployment_id)

    def put(self, deployment_id: str, record: dict) -> None:
        state = self._load()
        state["deployments"][deployment_id] = record
        self._save(state)


class DeploymentManager:
    """Provider-neutral operator-side deployment coordinator.

    The manager owns idempotency, role safety, receipt creation, and rollback
    bookkeeping. Providers remain thin adapters to execution environments.
    """

    def __init__(
        self,
        journal: DeploymentJournal,
        identity: SigningIdentity,
        provider_factory: Callable[[str], DeployProvider] = get_provider,
    ):
        self.journal = journal
        self.identity = identity
        self.provider_factory = provider_factory

    def plan(self, spec: DeploySpec, *, allow_authority_node: bool = False) -> dict:
        enforce_role_boundary(spec, allow_authority_node=allow_authority_node)
        verification = verify_sidecars(spec)
        provider = self.provider_factory(spec.provider)
        preflight = provider.preflight(spec)
        return {
            "valid": True,
            "deployment_id": spec.deployment_id,
            "fingerprint": spec_fingerprint(spec),
            "role": spec.role,
            "provider": spec.provider,
            "artifact": verification,
            "provider_preflight": preflight,
        }

    def apply(
        self,
        spec: DeploySpec,
        *,
        allow_authority_node: bool = False,
        admission_policy=None,
        signing_key_persistent: bool = True,
        hosted_attestation_count: int = 0,
        hosted_attestation_paths: tuple[str,...] = (),
    ) -> tuple[DeployResult, dict, bool]:
        enforce_role_boundary(spec, allow_authority_node=allow_authority_node)
        verify_sidecars(spec)
        admission_dict = None
        if admission_policy is not None:
            from .deploy_policy import evaluate_admission
            decision = evaluate_admission(
                spec, admission_policy,
                signing_key_persistent=signing_key_persistent,
                hosted_attestation_count=hosted_attestation_count,
                hosted_attestation_paths=hosted_attestation_paths,
            )
            admission_dict = {
                "allowed":decision.allowed,
                "policy_id":decision.policy_id,
                "policy_digest":decision.policy_digest,
                "reasons":list(decision.reasons),
                "evidence":decision.evidence,
            }
            if not decision.allowed:
                raise DeployError(
                    "DEPLOY_ADMISSION_DENIED:" + ",".join(decision.reasons)
                )
        fingerprint = spec_fingerprint(spec)
        prior = self.journal.get(spec.deployment_id)

        if prior:
            if prior["fingerprint"] != fingerprint:
                raise DeployError("deployment id already exists with a different specification")
            if prior["state"] in {"deployed", "verified"}:
                result = DeployResult(**prior["result"])
                receipt = prior["receipt"]
                if not verify_deployment_receipt(
                    receipt,
                    expected_public_key_b64=self.identity.public_key_b64,
                ):
                    raise DeployError("stored deployment receipt failed verification")
                return result, receipt, True
            if prior["state"] == "rolled-back":
                raise DeployError(
                    "rolled-back deployment id cannot be reused; create a new deployment id"
                )

        provider = self.provider_factory(spec.provider)
        result = provider.apply(spec)
        receipt = deployment_receipt(self.identity, spec, result, admission_dict)
        record = {
            "fingerprint": fingerprint,
            "state": result.status,
            "result": asdict(result),
            "receipt": receipt,
        }
        self.journal.put(spec.deployment_id, record)
        return result, receipt, False

    def status(self, spec: DeploySpec) -> DeployResult:
        prior = self.journal.get(spec.deployment_id)
        if not prior:
            raise DeployError("deployment id is not known to Numina")
        if prior["fingerprint"] != spec_fingerprint(spec):
            raise DeployError("deployment specification does not match journal")
        provider = self.provider_factory(spec.provider)
        return provider.status(spec)

    def verify(self, spec: DeploySpec) -> tuple[DeployResult, dict]:
        prior = self.journal.get(spec.deployment_id)
        if not prior:
            raise DeployError("deployment id is not known to Numina")
        if prior["fingerprint"] != spec_fingerprint(spec):
            raise DeployError("deployment specification does not match journal")
        provider = self.provider_factory(spec.provider)
        result = provider.verify(spec)
        receipt = deployment_receipt(self.identity, spec, result)
        self.journal.put(spec.deployment_id, {
            "fingerprint": spec_fingerprint(spec),
            "state": "verified",
            "result": asdict(result),
            "receipt": receipt,
        })
        return result, receipt

    def rollback(
        self,
        spec: DeploySpec,
        *,
        allow_authority_node: bool = False,
    ) -> tuple[DeployResult, dict]:
        enforce_role_boundary(spec, allow_authority_node=allow_authority_node)
        prior = self.journal.get(spec.deployment_id)
        if not prior:
            raise DeployError("refusing rollback for unknown deployment")
        if prior["fingerprint"] != spec_fingerprint(spec):
            raise DeployError("deployment specification does not match journal")
        if prior["state"] == "rolled-back":
            result = DeployResult(**prior["result"])
            return result, prior["receipt"]

        provider = self.provider_factory(spec.provider)
        result = provider.rollback(spec)
        receipt = deployment_receipt(self.identity, spec, result)
        self.journal.put(spec.deployment_id, {
            "fingerprint": spec_fingerprint(spec),
            "state": "rolled-back",
            "result": asdict(result),
            "receipt": receipt,
        })
        return result, receipt
