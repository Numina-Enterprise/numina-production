from __future__ import annotations

import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from numina_prod.deploy_provider import DeployResult, DeploySpec
from numina_prod.remote_agent_service import RemoteAgentConfig, create_remote_agent_app
from numina_prod.remote_execution import RemoteAgentTarget, issue_remote_command
from numina_prod.signing import SigningIdentity, verify_envelope


def write_key(path:Path, key:Ed25519PrivateKey):
    path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))


def artifact_spec(tmp_path:Path, provider="docker", role="public-verifier"):
    artifact=tmp_path/"numina.zip"
    artifact.write_bytes(b"release")
    digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_suffix(".zip.sha256").write_text(f"{digest}  {artifact.name}\n")
    artifact.with_suffix(".zip.intoto.json").write_text(json.dumps({
        "_type":"https://in-toto.io/Statement/v1",
        "subject":[{"name":artifact.name,"digest":{"sha256":digest}}],
        "predicateType":"https://slsa.dev/provenance/v1",
        "predicate":{"runDetails":{"builder":{"id":"urn:numina:builder:release-gate:v1"}}}
    }))
    return DeploySpec(
        deployment_id="dep-1",
        provider=provider,
        artifact=str(artifact),
        artifact_sha256=digest,
        role=role,
        environment="production",
        target="numina-public",
        image="numina/verifier:test",
        namespace="NUMINA",
        service_name="numina-public-verifier",
        public_url="https://numinalabs.xyz",
        metadata={},
    )


class FakeProvider:
    def apply(self,s):
        return DeployResult(s.deployment_id,s.provider,s.role,s.environment,s.target,"deployed",s.artifact_sha256,"fake://dep")
    def status(self,s):
        return DeployResult(s.deployment_id,s.provider,s.role,s.environment,s.target,"running",s.artifact_sha256,"fake://dep")
    def verify(self,s):
        return DeployResult(s.deployment_id,s.provider,s.role,s.environment,s.target,"verified",s.artifact_sha256,"fake://dep")
    def rollback(self,s):
        return DeployResult(s.deployment_id,s.provider,s.role,s.environment,s.target,"rolled-back",s.artifact_sha256,"fake://dep")


def config(tmp_path,controller_identity):
    agent_key=Ed25519PrivateKey.generate()
    agent_key_path=tmp_path/"agent.pem"
    write_key(agent_key_path,agent_key)

    c=RemoteAgentConfig()
    c.controller_public_key_b64=controller_identity.public_key_b64
    c.agent_signing_key_file=str(agent_key_path)
    c.workload_identity="spiffe://numina.example/deployer/public"
    c.trust_domain="numina.example"
    c.replay_store_path=tmp_path/"replay.json"
    c.allowed_roles=("public-verifier",)
    c.allowed_providers=("docker",)
    return c, SigningIdentity(agent_key)


def signed_command(tmp_path,controller_identity,spec,action="apply"):
    target=RemoteAgentTarget(
        "https://agent.numina.example",
        "spiffe://numina.example/deployer/public",
        "numina.example",
        ("public-verifier",),
    )
    return issue_remote_command(
        controller_identity,spec,target,action=action,ttl_seconds=120
    )


def test_remote_agent_executes_signed_command_and_returns_signed_receipt(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,agent_identity=config(tmp_path,controller)
    app=create_remote_agent_app(cfg,provider_factory=lambda _:FakeProvider())
    client=TestClient(app)

    env=signed_command(tmp_path,controller,artifact_spec(tmp_path),"apply")
    r=client.post("/v1/remote-execution",json=env)
    assert r.status_code==200,r.text
    body=r.json()
    assert body["status"]=="deployed"
    assert body["agent_identity"]==cfg.workload_identity
    assert verify_envelope(
        body["receipt"],
        expected_public_key_b64=agent_identity.public_key_b64,
        expected_type="NUMINA_REMOTE_DEPLOY_RECEIPT",
    )


def test_replay_is_rejected(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,_=config(tmp_path,controller)
    app=create_remote_agent_app(cfg,provider_factory=lambda _:FakeProvider())
    client=TestClient(app)
    env=signed_command(tmp_path,controller,artifact_spec(tmp_path),"apply")
    assert client.post("/v1/remote-execution",json=env).status_code==200
    second=client.post("/v1/remote-execution",json=env)
    assert second.status_code==403
    assert "REMOTE_COMMAND_REPLAY" in second.json()["detail"]["reasons"]


def test_tampered_signed_spec_is_rejected(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,_=config(tmp_path,controller)
    app=create_remote_agent_app(cfg,provider_factory=lambda _:FakeProvider())
    client=TestClient(app)
    env=signed_command(tmp_path,controller,artifact_spec(tmp_path),"apply")
    env["payload"]["deployment_spec"]["target"]="evil"
    r=client.post("/v1/remote-execution",json=env)
    assert r.status_code==403
    assert "REMOTE_SIGNATURE_INVALID" in r.json()["detail"]["reasons"]


def test_disallowed_provider_is_rejected_before_invocation(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,_=config(tmp_path,controller)
    called={"count":0}
    def factory(_):
        called["count"]+=1
        return FakeProvider()
    app=create_remote_agent_app(cfg,provider_factory=factory)
    client=TestClient(app)
    env=signed_command(tmp_path,controller,artifact_spec(tmp_path,provider="https"),"apply")
    r=client.post("/v1/remote-execution",json=env)
    assert r.status_code==403
    assert r.json()["detail"]["code"]=="REMOTE_PROVIDER_NOT_ALLOWED"
    assert called["count"]==0


def test_disallowed_role_is_rejected(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,_=config(tmp_path,controller)
    spec=artifact_spec(tmp_path,role="authority-node")
    target=RemoteAgentTarget(
        "https://agent.numina.example",
        "spiffe://numina.example/deployer/public",
        "numina.example",
        ("authority-node",),
    )
    env=issue_remote_command(controller,spec,target,action="apply")
    app=create_remote_agent_app(cfg,provider_factory=lambda _:FakeProvider())
    r=TestClient(app).post("/v1/remote-execution",json=env)
    assert r.status_code==403
    assert "REMOTE_ROLE_NOT_ALLOWED" in r.json()["detail"]["reasons"]


def test_docs_and_openapi_disabled(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,_=config(tmp_path,controller)
    c=TestClient(create_remote_agent_app(cfg,provider_factory=lambda _:FakeProvider()))
    assert c.get("/docs").status_code==404
    assert c.get("/redoc").status_code==404
    assert c.get("/openapi.json").status_code==404
