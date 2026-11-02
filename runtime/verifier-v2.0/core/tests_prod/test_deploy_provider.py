from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.deploy_provider import (
    DeployError,
    DeployResult,
    DeploySpec,
    DeploymentJournal,
    DeploymentManager,
    DockerOCIProvider,
    HTTPSDeployProvider,
    KubernetesProvider,
    enforce_role_boundary,
    get_provider,
    verify_deployment_receipt,
    verify_sidecars,
)
from numina_prod.signing import SigningIdentity


def release_artifact(tmp_path: Path):
    artifact=tmp_path/"numina-production.zip"
    artifact.write_bytes(b"numina-release")
    digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_suffix(".zip.sha256").write_text(
        f"{digest}  {artifact.name}\n"
    )
    artifact.with_suffix(".zip.intoto.json").write_text(json.dumps({
        "_type":"https://in-toto.io/Statement/v1",
        "subject":[{"name":artifact.name,"digest":{"sha256":digest}}],
        "predicateType":"https://slsa.dev/provenance/v1",
        "predicate":{},
    }))
    return artifact,digest


def spec(tmp_path: Path, **kwargs):
    artifact,digest=release_artifact(tmp_path)
    base=dict(
        deployment_id="dep-001",
        provider="docker",
        artifact=str(artifact),
        artifact_sha256=digest,
        role="public-verifier",
        environment="production",
        target="numina-verifier",
        image="numina/verifier:test",
        public_url="https://numinalabs.xyz",
        metadata={},
    )
    base.update(kwargs)
    return DeploySpec(**base)


class FakeProvider:
    name="fake"
    def __init__(self):
        self.apply_calls=0
        self.rollback_calls=0
        self.running=True
    def preflight(self,spec):
        verify_sidecars(spec)
        return {"valid":True}
    def apply(self,spec):
        self.apply_calls+=1
        self.running=True
        return DeployResult(
            spec.deployment_id,spec.provider,spec.role,spec.environment,
            spec.target,"deployed",spec.artifact_sha256,"fake://deployment"
        )
    def status(self,spec):
        return DeployResult(
            spec.deployment_id,spec.provider,spec.role,spec.environment,
            spec.target,"running" if self.running else "stopped",
            spec.artifact_sha256,"fake://deployment"
        )
    def verify(self,spec):
        if not self.running: raise DeployError("not running")
        return DeployResult(
            spec.deployment_id,spec.provider,spec.role,spec.environment,
            spec.target,"verified",spec.artifact_sha256,"fake://deployment"
        )
    def rollback(self,spec):
        self.rollback_calls+=1
        self.running=False
        return DeployResult(
            spec.deployment_id,spec.provider,spec.role,spec.environment,
            spec.target,"rolled-back",spec.artifact_sha256,"fake://deployment"
        )


def manager(tmp_path, provider):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    mgr=DeploymentManager(
        DeploymentJournal(tmp_path/"deployments.json"),
        identity,
        provider_factory=lambda _:provider,
    )
    return mgr,identity


def test_provider_selection():
    assert isinstance(get_provider("docker"),DockerOCIProvider)
    assert isinstance(get_provider("oci"),DockerOCIProvider)
    assert isinstance(get_provider("k8s"),KubernetesProvider)
    assert isinstance(get_provider("kubernetes"),KubernetesProvider)
    assert isinstance(get_provider("https"),HTTPSDeployProvider)
    with pytest.raises(DeployError,match="unknown deploy provider"):
        get_provider("magic-cloud")


def test_missing_https_credentials_fail_closed(tmp_path,monkeypatch):
    monkeypatch.delenv("NUMINA_DEPLOY_BEARER_TOKEN",raising=False)
    s=spec(tmp_path,provider="https",target="https://deploy.example.test")
    with pytest.raises(DeployError,match="NUMINA_DEPLOY_BEARER_TOKEN"):
        HTTPSDeployProvider().preflight(s)


def test_artifact_checksum_mismatch_rejected(tmp_path):
    s=spec(tmp_path)
    bad=replace(s,artifact_sha256="0"*64)
    with pytest.raises(DeployError,match="artifact checksum mismatch"):
        verify_sidecars(bad)


def test_missing_provenance_rejected(tmp_path):
    s=spec(tmp_path)
    Path(s.artifact).with_suffix(".zip.intoto.json").unlink()
    with pytest.raises(DeployError,match="provenance sidecar missing"):
        verify_sidecars(s)


def test_authority_node_requires_explicit_opt_in(tmp_path):
    s=spec(tmp_path,role="authority-node")
    with pytest.raises(DeployError,match="explicit --allow-authority-node"):
        enforce_role_boundary(s)
    enforce_role_boundary(s,allow_authority_node=True)


def test_signed_deployment_receipt_verifies(tmp_path):
    provider=FakeProvider()
    mgr,identity=manager(tmp_path,provider)
    result,receipt,idempotent=mgr.apply(spec(tmp_path))
    assert idempotent is False
    assert verify_deployment_receipt(
        receipt,expected_public_key_b64=identity.public_key_b64
    )
    receipt["payload"]["result"]["status"]="forged"
    assert not verify_deployment_receipt(
        receipt,expected_public_key_b64=identity.public_key_b64
    )


def test_apply_is_idempotent_for_same_deployment_spec(tmp_path):
    provider=FakeProvider()
    mgr,identity=manager(tmp_path,provider)
    s=spec(tmp_path)
    r1,receipt1,idempotent1=mgr.apply(s)
    r2,receipt2,idempotent2=mgr.apply(s)
    assert provider.apply_calls==1
    assert idempotent1 is False
    assert idempotent2 is True
    assert r1==r2
    assert receipt1==receipt2


def test_reused_deployment_id_with_changed_artifact_fails_closed(tmp_path):
    provider=FakeProvider()
    mgr,_=manager(tmp_path,provider)
    s=spec(tmp_path)
    mgr.apply(s)

    artifact2=tmp_path/"numina-production-2.zip"
    artifact2.write_bytes(b"different-release")
    digest2=hashlib.sha256(artifact2.read_bytes()).hexdigest()
    artifact2.with_suffix(".zip.sha256").write_text(f"{digest2}  {artifact2.name}\n")
    artifact2.with_suffix(".zip.intoto.json").write_text(json.dumps({
        "_type":"https://in-toto.io/Statement/v1",
        "subject":[{"name":artifact2.name,"digest":{"sha256":digest2}}],
        "predicateType":"https://slsa.dev/provenance/v1","predicate":{}
    }))

    changed=replace(s,artifact=str(artifact2),artifact_sha256=digest2)
    with pytest.raises(DeployError,match="different specification"):
        mgr.apply(changed)


def test_rollback_unknown_deployment_is_refused(tmp_path):
    provider=FakeProvider()
    mgr,_=manager(tmp_path,provider)
    with pytest.raises(DeployError,match="unknown deployment"):
        mgr.rollback(spec(tmp_path))


def test_rollback_is_idempotent_and_does_not_reapply(tmp_path):
    provider=FakeProvider()
    mgr,_=manager(tmp_path,provider)
    s=spec(tmp_path)
    mgr.apply(s)
    r1,_=mgr.rollback(s)
    r2,_=mgr.rollback(s)
    assert r1.status=="rolled-back"
    assert r2.status=="rolled-back"
    assert provider.rollback_calls==1


def test_rolled_back_deployment_id_cannot_be_reused(tmp_path):
    provider=FakeProvider()
    mgr,_=manager(tmp_path,provider)
    s=spec(tmp_path)
    mgr.apply(s)
    mgr.rollback(s)
    with pytest.raises(DeployError,match="cannot be reused"):
        mgr.apply(s)


def test_docker_preflight_fails_when_runtime_missing(tmp_path):
    s=spec(tmp_path)
    def missing(*args,**kwargs):
        raise FileNotFoundError("docker")
    with pytest.raises(DeployError,match="runtime unavailable"):
        DockerOCIProvider(runner=missing).preflight(s)


def test_kubernetes_requires_manifest(tmp_path):
    s=spec(tmp_path,provider="kubernetes",target="cluster-a",image="")
    with pytest.raises(DeployError,match="metadata.manifest"):
        KubernetesProvider(runner=lambda *a,**k:None).preflight(s)


def test_public_service_exposes_no_deploy_or_economic_mutation_route(monkeypatch,tmp_path):
    from numina_prod.config import Settings
    from numina_prod.service import create_app

    settings=Settings(
        environment="test",
        role="public-verifier",
        release="test",
        data_dir=tmp_path,
        signing_key_file=None,
        allow_ephemeral_key=True,
        require_frozen_core=False,
        public_url=None,
        database_url=None,
        real_funds_enabled=False,
        employer_ip_enabled=False,
        trusted_hosts=("testserver",),
    )
    app=create_app(settings)
    paths={route.path for route in app.routes}
    assert not any(path.startswith("/v1/deploy") for path in paths)
    forbidden=("execute","commit","trade","wallet","broker","custody","fund")
    assert not any(
        any(word in path.lower() for word in forbidden)
        for path in paths
    )
