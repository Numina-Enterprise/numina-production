from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.deploy_provider import DeployError, DeploySpec, RemoteAgentProvider, get_provider
from numina_prod.remote_execution import (
    RemoteAgentTarget,
    ReplayStore,
    issue_remote_command,
    verify_remote_command,
)
from numina_prod.signing import SigningIdentity


def spec(tmp_path: Path):
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
    sbom=tmp_path/"software-bom.spdx.json"
    sbom.write_text('{"spdxVersion":"SPDX-2.3"}')
    return DeploySpec(
        deployment_id="dep-remote",
        provider="remote",
        artifact=str(artifact),
        artifact_sha256=digest,
        role="public-verifier",
        environment="production",
        target="https://agent.numina.example",
        image="numina/verifier:test",
        namespace="NUMINA",
        service_name="numina-public-verifier",
        public_url="https://numinalabs.xyz",
        metadata={
            "sbom_path":str(sbom),
            "agent_url":"https://agent.numina.example",
            "workload_identity":"spiffe://numina.example/deployer/public",
            "trust_domain":"numina.example",
            "allowed_roles":["public-verifier"],
        },
    )


def target():
    return RemoteAgentTarget(
        agent_url="https://agent.numina.example",
        workload_identity="spiffe://numina.example/deployer/public",
        trust_domain="numina.example",
        allowed_roles=("public-verifier",),
    )


def test_remote_provider_selected():
    assert isinstance(get_provider("remote"),RemoteAgentProvider)


def test_remote_target_requires_https_and_spiffe():
    with pytest.raises(ValueError):
        RemoteAgentTarget("http://agent","spiffe://numina.example/a","numina.example")
    with pytest.raises(ValueError):
        RemoteAgentTarget("https://agent","not-spiffe","numina.example")


def test_signed_remote_command_verifies_once(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    env=issue_remote_command(identity,spec(tmp_path),target(),action="apply",now=1000,ttl_seconds=120)
    store=ReplayStore(tmp_path/"replay.json")
    r=verify_remote_command(
        env,
        trusted_public_key_b64=identity.public_key_b64,
        expected_workload_identity=target().workload_identity,
        expected_trust_domain=target().trust_domain,
        replay_store=store,
        allowed_roles=("public-verifier",),
        now=1010,
    )
    assert r.valid

    replay=verify_remote_command(
        env,
        trusted_public_key_b64=identity.public_key_b64,
        expected_workload_identity=target().workload_identity,
        expected_trust_domain=target().trust_domain,
        replay_store=store,
        allowed_roles=("public-verifier",),
        now=1011,
    )
    assert not replay.valid
    assert "REMOTE_COMMAND_REPLAY" in replay.reasons


def test_tampered_remote_command_rejected(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    env=issue_remote_command(identity,spec(tmp_path),target(),action="apply",now=1000)
    env["payload"]["artifact_sha256"]="0"*64
    r=verify_remote_command(
        env,
        trusted_public_key_b64=identity.public_key_b64,
        expected_workload_identity=target().workload_identity,
        expected_trust_domain=target().trust_domain,
        replay_store=ReplayStore(tmp_path/"replay.json"),
        now=1001,
    )
    assert not r.valid
    assert "REMOTE_SIGNATURE_INVALID" in r.reasons


def test_expired_remote_command_rejected(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    env=issue_remote_command(identity,spec(tmp_path),target(),action="apply",now=1000,ttl_seconds=10)
    r=verify_remote_command(
        env,
        trusted_public_key_b64=identity.public_key_b64,
        expected_workload_identity=target().workload_identity,
        expected_trust_domain=target().trust_domain,
        replay_store=ReplayStore(tmp_path/"replay.json"),
        now=1011,
    )
    assert not r.valid
    assert "REMOTE_COMMAND_EXPIRED" in r.reasons


def test_workload_identity_mismatch_rejected(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    env=issue_remote_command(identity,spec(tmp_path),target(),action="verify",now=1000)
    r=verify_remote_command(
        env,
        trusted_public_key_b64=identity.public_key_b64,
        expected_workload_identity="spiffe://numina.example/deployer/other",
        expected_trust_domain=target().trust_domain,
        replay_store=ReplayStore(tmp_path/"replay.json"),
        now=1001,
    )
    assert not r.valid
    assert "REMOTE_WORKLOAD_IDENTITY_MISMATCH" in r.reasons


def test_remote_provider_requires_persistent_controller_key(tmp_path,monkeypatch):
    monkeypatch.delenv("NUMINA_REMOTE_CONTROLLER_KEY_FILE",raising=False)
    with pytest.raises(DeployError,match="NUMINA_REMOTE_CONTROLLER_KEY_FILE"):
        RemoteAgentProvider().preflight(spec(tmp_path))


def test_authority_role_not_allowed_by_remote_target(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    s=spec(tmp_path)
    bad=DeploySpec(**{**s.__dict__,"role":"authority-node"})
    with pytest.raises(DeployError,match="REMOTE_ROLE_NOT_ALLOWED"):
        issue_remote_command(identity,bad,target(),action="apply",now=1000)
