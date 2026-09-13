from __future__ import annotations
import hashlib, json
from pathlib import Path
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.deploy_provider import DeployError, DeployResult, DeploySpec
from numina_prod.execution_rooms import (
    ExecutionRoom, RoomSetPolicy, ExecutionRoomOrchestrator
)
from numina_prod.signing import SigningIdentity, verify_envelope


def base_spec(tmp_path:Path):
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
        deployment_id="multi",
        provider="remote",
        artifact=str(artifact),
        artifact_sha256=digest,
        role="public-verifier",
        environment="production",
        target="",
        image="numina/verifier:test",
        namespace="numina",
        service_name="numina-public-verifier",
        public_url="https://numinalabs.xyz",
        metadata={},
    )


class FakeProvider:
    def __init__(self,status="deployed"):
        self.status_value=status
        self.apply_calls=0
        self.verify_calls=0
    def apply(self,s):
        self.apply_calls += 1
        if self.status_value=="raise":
            raise DeployError("boom")
        return DeployResult(
            s.deployment_id,s.provider,s.role,s.environment,s.target,
            self.status_value,s.artifact_sha256,f"fake://{s.target}"
        )
    def verify(self,s):
        self.verify_calls += 1
        if self.status_value=="raise":
            raise DeployError("boom")
        return DeployResult(
            s.deployment_id,s.provider,s.role,s.environment,s.target,
            "verified" if self.status_value!="bad" else "degraded",
            s.artifact_sha256,f"fake://{s.target}"
        )


def test_all_required_rooms_succeed(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    providers={"docker":FakeProvider(),"kubernetes":FakeProvider()}
    orch=ExecutionRoomOrchestrator(identity,provider_factory=lambda n:providers[n])
    rooms=(
        ExecutionRoom("room-a","docker","a"),
        ExecutionRoom("room-b","kubernetes","b"),
    )
    out=orch.apply(base_spec(tmp_path),rooms,RoomSetPolicy(minimum_successful_rooms=2))
    assert out["summary"]["allowed"]
    assert out["summary"]["successful_rooms"]==2
    assert len(out["room_receipts"])==2
    assert verify_envelope(
        out["room_set_receipt"],
        expected_public_key_b64=identity.public_key_b64,
        expected_type="NUMINA_EXECUTION_ROOM_SET_RECEIPT"
    )


def test_required_room_failure_fails_closed(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    providers={"docker":FakeProvider(),"kubernetes":FakeProvider("raise")}
    orch=ExecutionRoomOrchestrator(identity,provider_factory=lambda n:providers[n])
    rooms=(
        ExecutionRoom("room-a","docker","a",required=True),
        ExecutionRoom("room-b","kubernetes","b",required=True),
    )
    with pytest.raises(DeployError,match="ROOM_SET_QUORUM_FAILED"):
        orch.apply(base_spec(tmp_path),rooms,RoomSetPolicy(minimum_successful_rooms=1))


def test_optional_room_can_fail_if_quorum_met(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    providers={"docker":FakeProvider(),"https":FakeProvider("raise")}
    orch=ExecutionRoomOrchestrator(identity,provider_factory=lambda n:providers[n])
    rooms=(
        ExecutionRoom("room-a","docker","a",required=True),
        ExecutionRoom("room-b","https","b",required=False),
    )
    out=orch.apply(base_spec(tmp_path),rooms,RoomSetPolicy(minimum_successful_rooms=1))
    assert out["summary"]["allowed"]
    assert out["summary"]["successful_rooms"]==1


def test_duplicate_room_id_rejected(tmp_path):
    orch=ExecutionRoomOrchestrator(
        SigningIdentity(Ed25519PrivateKey.generate()),
        provider_factory=lambda n:FakeProvider()
    )
    rooms=(
        ExecutionRoom("same","docker","a"),
        ExecutionRoom("same","docker","b"),
    )
    with pytest.raises(DeployError,match="DUPLICATE_EXECUTION_ROOM_ID"):
        orch.apply(base_spec(tmp_path),rooms,RoomSetPolicy())


def test_room_role_must_match_base_role(tmp_path):
    orch=ExecutionRoomOrchestrator(
        SigningIdentity(Ed25519PrivateKey.generate()),
        provider_factory=lambda n:FakeProvider()
    )
    rooms=(ExecutionRoom("x","docker","a",role="witness"),)
    with pytest.raises(DeployError,match="ROOM_SET_QUORUM_FAILED"):
        orch.apply(base_spec(tmp_path),rooms,RoomSetPolicy())


def test_authority_node_room_set_denied_by_default(tmp_path):
    spec=base_spec(tmp_path)
    spec=DeploySpec(**{**spec.__dict__,"role":"authority-node"})
    orch=ExecutionRoomOrchestrator(
        SigningIdentity(Ed25519PrivateKey.generate()),
        provider_factory=lambda n:FakeProvider()
    )
    rooms=(ExecutionRoom("x","docker","a",role="authority-node"),)
    with pytest.raises(DeployError,match="ROOM_SET_ROLE_NOT_ALLOWED"):
        orch.apply(spec,rooms,RoomSetPolicy())


def test_verify_requires_quorum(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    providers={"docker":FakeProvider(),"https":FakeProvider("bad")}
    orch=ExecutionRoomOrchestrator(identity,provider_factory=lambda n:providers[n])
    rooms=(
        ExecutionRoom("a","docker","a",required=True),
        ExecutionRoom("b","https","b",required=False),
    )
    result=orch.verify(base_spec(tmp_path),rooms,RoomSetPolicy(minimum_successful_rooms=1))
    assert result["allowed"]
    assert result["successful_rooms"]==1
