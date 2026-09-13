from __future__ import annotations

import hashlib
from pathlib import Path
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.deploy_provider import DeployError, DeploySpec
from numina_prod.execution_rooms import ExecutionRoom
from numina_prod.room_discovery import DiscoveredRoom, RoomHealth, RoutingPolicy
from numina_prod.room_rebalancing import RoomRebalancer
from numina_prod.signing import SigningIdentity, verify_envelope


def spec(tmp_path:Path):
    artifact=tmp_path/"numina.zip"
    artifact.write_bytes(b"release")
    digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
    return DeploySpec(
        deployment_id="dep",
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


def discovered(room_id,healthy,latency=10,required=False,provider="remote"):
    room=ExecutionRoom(room_id,provider,f"https://{room_id}.example","public-verifier",required,{})
    health=RoomHealth(room_id,healthy,latency,1000,"ready" if healthy else "down",{})
    return DiscoveredRoom(room,health)


def prior():
    return {
        "selected_room_ids":["a","b"],
        "allowed":True,
        "policy":{"minimum_healthy_rooms":2}
    }


def test_rebalances_to_new_healthy_room(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    r=RoomRebalancer(identity).rebalance(
        base=spec(tmp_path),
        prior_routing=prior(),
        discovered=(
            discovered("a",False),
            discovered("b",True),
            discovered("c",True,5),
        ),
        failed_room_id="a",
        routing_policy=RoutingPolicy(minimum_healthy_rooms=2),
    )
    assert r["replacement_room"].room_id=="c"
    assert r["decision"]["failed_room_id"]=="a"
    assert r["decision"]["replacement_room_id"]=="c"
    assert verify_envelope(
        r["rebalance_receipt"],
        expected_public_key_b64=identity.public_key_b64,
        expected_type="NUMINA_ROOM_REBALANCE_RECEIPT",
    )


def test_failed_room_must_be_in_prior_route(tmp_path):
    with pytest.raises(DeployError,match="FAILED_ROOM_NOT_IN_PRIOR_ROUTING"):
        RoomRebalancer(SigningIdentity(Ed25519PrivateKey.generate())).rebalance(
            base=spec(tmp_path),
            prior_routing=prior(),
            discovered=(discovered("x",False),discovered("c",True)),
            failed_room_id="x",
            routing_policy=RoutingPolicy(),
        )


def test_room_marked_healthy_cannot_be_failed(tmp_path):
    with pytest.raises(DeployError,match="FAILED_ROOM_STILL_HEALTHY"):
        RoomRebalancer(SigningIdentity(Ed25519PrivateKey.generate())).rebalance(
            base=spec(tmp_path),
            prior_routing=prior(),
            discovered=(discovered("a",True),discovered("c",True)),
            failed_room_id="a",
            routing_policy=RoutingPolicy(),
        )


def test_no_candidate_fails_closed(tmp_path):
    with pytest.raises(DeployError,match="NO_REBALANCE_CANDIDATES"):
        RoomRebalancer(SigningIdentity(Ed25519PrivateKey.generate())).rebalance(
            base=spec(tmp_path),
            prior_routing=prior(),
            discovered=(discovered("a",False),discovered("b",True)),
            failed_room_id="a",
            routing_policy=RoutingPolicy(),
        )


def test_unhealthy_candidates_do_not_replace(tmp_path):
    with pytest.raises(DeployError,match="ROOM_ROUTING_QUORUM_FAILED"):
        RoomRebalancer(SigningIdentity(Ed25519PrivateKey.generate())).rebalance(
            base=spec(tmp_path),
            prior_routing=prior(),
            discovered=(
                discovered("a",False),
                discovered("b",True),
                discovered("c",False),
            ),
            failed_room_id="a",
            routing_policy=RoutingPolicy(),
        )


def test_latency_policy_applies_to_replacement(tmp_path):
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    r=RoomRebalancer(identity).rebalance(
        base=spec(tmp_path),
        prior_routing=prior(),
        discovered=(
            discovered("a",False),
            discovered("b",True),
            discovered("c",True,500),
            discovered("d",True,25),
        ),
        failed_room_id="a",
        routing_policy=RoutingPolicy(maximum_latency_ms=100),
    )
    assert r["replacement_room"].room_id=="d"
