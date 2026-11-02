from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.convergence_controller import ConvergenceController, ConvergencePolicy
from numina_prod.deploy_provider import DeployError, DeployResult, DeploySpec
from numina_prod.execution_rooms import ExecutionRoom, RoomSetPolicy
from numina_prod.room_discovery import RoomHealth, RoutingPolicy
from numina_prod.signing import SigningIdentity, verify_envelope


def base_spec(tmp_path:Path):
    artifact=tmp_path/"numina.zip"
    artifact.write_bytes(b"release")
    digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
    return DeploySpec(
        deployment_id="conv",
        provider="remote",
        artifact=str(artifact),
        artifact_sha256=digest,
        role="public-verifier",
        environment="production",
        target="",
        image="numina/verifier:test",
        namespace="NUMINA",
        service_name="numina-public-verifier",
        public_url="https://numinalabs.xyz",
        metadata={},
    )


class FakeProvider:
    def __init__(self):
        self.apply_calls=0
        self.verify_calls=0
    def apply(self,s):
        self.apply_calls += 1
        return DeployResult(
            s.deployment_id,s.provider,s.role,s.environment,s.target,
            "deployed",s.artifact_sha256,f"fake://{s.target}"
        )
    def verify(self,s):
        self.verify_calls += 1
        return DeployResult(
            s.deployment_id,s.provider,s.role,s.environment,s.target,
            "verified",s.artifact_sha256,f"fake://{s.target}"
        )


def test_converges_in_one_cycle(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    providers={"remote":FakeProvider()}
    def probe(room):
        return RoomHealth(room.room_id,True,5,1000,"ready",{})

    controller=ConvergenceController(
        identity,
        health_probe=probe,
        provider_factory=lambda name:providers[name],
    )
    rooms=(ExecutionRoom("a","remote","https://a.example"),)

    out=controller.converge(
        base=base_spec(tmp_path),
        rooms=rooms,
        routing_policy=RoutingPolicy(minimum_healthy_rooms=1),
        room_set_policy=RoomSetPolicy(minimum_successful_rooms=1),
        convergence_policy=ConvergencePolicy(maximum_cycles=2,minimum_verified_rooms=1),
    )

    assert out["converged"]
    assert len(out["cycles"])==1
    assert out["cycles"][0]["verified_room_ids"]==("a",)
    assert verify_envelope(
        out["convergence_receipt"],
        expected_public_key_b64=identity.public_key_b64,
        expected_type="NUMINA_DEPLOYMENT_CONVERGENCE_RECEIPT",
    )


def test_bounded_failure_no_infinite_retry(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    providers={"remote":FakeProvider()}
    state={"count":0}

    def probe(room):
        state["count"] += 1
        # Healthy for initial routing observation, unhealthy for post-apply
        # refresh; repeats per cycle.
        healthy=(state["count"] % 2)==1
        return RoomHealth(room.room_id,healthy,5,1000,"ready" if healthy else "down",{})

    controller=ConvergenceController(
        identity,
        health_probe=probe,
        provider_factory=lambda name:providers[name],
    )
    rooms=(ExecutionRoom("a","remote","https://a.example"),)

    with pytest.raises(DeployError,match="DEPLOYMENT_CONVERGENCE_FAILED"):
        controller.converge(
            base=base_spec(tmp_path),
            rooms=rooms,
            routing_policy=RoutingPolicy(minimum_healthy_rooms=1),
            room_set_policy=RoomSetPolicy(minimum_successful_rooms=1),
            convergence_policy=ConvergencePolicy(maximum_cycles=2,minimum_verified_rooms=1),
        )

    assert providers["remote"].apply_calls==2
    assert providers["remote"].verify_calls==2


def test_reobserves_and_converges_after_failover(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    providers={"remote":FakeProvider()}
    calls={"a":0,"b":0}

    def probe(room):
        calls[room.room_id]+=1
        if room.room_id=="a":
            # a is healthy for first route, then fails and stays failed
            healthy=calls["a"]==1
        else:
            healthy=True
        return RoomHealth(room.room_id,healthy,5,1000,"ready" if healthy else "down",{})

    controller=ConvergenceController(
        identity,
        health_probe=probe,
        provider_factory=lambda name:providers[name],
    )
    rooms=(
        ExecutionRoom("a","remote","https://a.example",required=False),
        ExecutionRoom("b","remote","https://b.example",required=False),
    )

    out=controller.converge(
        base=base_spec(tmp_path),
        rooms=rooms,
        routing_policy=RoutingPolicy(
            minimum_healthy_rooms=1,
            require_all_required_rooms_healthy=False,
        ),
        room_set_policy=RoomSetPolicy(
            minimum_successful_rooms=1,
            require_all_required_rooms=False,
        ),
        convergence_policy=ConvergencePolicy(
            maximum_cycles=3,
            minimum_verified_rooms=1,
            require_all_required_rooms=False,
        ),
    )

    assert out["converged"]
    assert len(out["cycles"])==2
    assert "a" in out["cycles"][0]["unhealthy_room_ids"]
    assert out["cycles"][1]["selected_room_ids"]==("b",)


def test_role_boundary_preserved(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    controller=ConvergenceController(
        identity,
        health_probe=lambda r:RoomHealth(r.room_id,True,1,1000,"ready",{}),
        provider_factory=lambda _:FakeProvider(),
    )
    spec=base_spec(tmp_path)
    spec=DeploySpec(**{**spec.__dict__,"role":"authority-node"})
    rooms=(ExecutionRoom("a","remote","https://a.example",role="authority-node"),)

    with pytest.raises(DeployError,match="CONVERGENCE_ROLE_NOT_ALLOWED"):
        controller.converge(
            base=spec,
            rooms=rooms,
            routing_policy=RoutingPolicy(
                minimum_healthy_rooms=1,
                allowed_roles=("authority-node",),
            ),
            room_set_policy=RoomSetPolicy(
                minimum_successful_rooms=1,
                allowed_roles=("authority-node",),
            ),
            convergence_policy=ConvergencePolicy(),
        )
