from __future__ import annotations

import time
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.deploy_provider import DeployError
from numina_prod.execution_rooms import ExecutionRoom
from numina_prod.room_discovery import (
    RoomDiscoveryRegistry,RoomHealth,RoutingPolicy,HealthAwareRouter
)
from numina_prod.signing import SigningIdentity,verify_envelope


def room(room_id,provider="remote",required=True,role="public-verifier"):
    return ExecutionRoom(room_id,provider,f"https://{room_id}.example",role,required,{})


def probe_map(mapping):
    def probe(r):
        healthy,latency=mapping[r.room_id]
        return RoomHealth(r.room_id,healthy,latency,int(time.time()),"ready" if healthy else "down",{})
    return probe


def test_discovery_preserves_unique_rooms():
    reg=RoomDiscoveryRegistry((room("a"),room("b")))
    found=reg.discover(probe_map({"a":(True,10),"b":(True,20)}))
    assert [x.room.room_id for x in found]==["a","b"]


def test_duplicate_room_ids_fail_closed():
    with pytest.raises(DeployError,match="DUPLICATE_EXECUTION_ROOM_ID"):
        RoomDiscoveryRegistry((room("a"),room("a")))


def test_router_selects_only_healthy_authorized_rooms():
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    reg=RoomDiscoveryRegistry((
        room("a","remote"),
        room("b","https",required=False),
        room("c","docker",required=False),
    ))
    discovered=reg.discover(probe_map({
        "a":(True,10),
        "b":(False,20),
        "c":(True,5),
    }))
    router=HealthAwareRouter(identity)
    result=router.select(
        discovered,
        RoutingPolicy(
            minimum_healthy_rooms=2,
            allowed_providers=("remote","docker"),
            maximum_latency_ms=100,
        ),
    )
    assert [r.room_id for r in result["selected_rooms"]]==["a","c"]
    assert result["routing_snapshot"]["allowed"]
    assert verify_envelope(
        result["routing_receipt"],
        expected_public_key_b64=identity.public_key_b64,
        expected_type="NUMINA_ROOM_ROUTING_RECEIPT",
    )


def test_required_unhealthy_room_blocks_routing():
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    reg=RoomDiscoveryRegistry((room("a",required=True),room("b",required=False)))
    discovered=reg.discover(probe_map({"a":(False,1),"b":(True,1)}))
    with pytest.raises(DeployError,match="ROOM_ROUTING_QUORUM_FAILED"):
        HealthAwareRouter(identity).select(
            discovered,
            RoutingPolicy(minimum_healthy_rooms=1,require_all_required_rooms_healthy=True),
        )


def test_latency_cap_excludes_room():
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    reg=RoomDiscoveryRegistry((room("a",required=False),room("b",required=False)))
    discovered=reg.discover(probe_map({"a":(True,500),"b":(True,25)}))
    result=HealthAwareRouter(identity).select(
        discovered,
        RoutingPolicy(
            minimum_healthy_rooms=1,
            maximum_latency_ms=100,
            require_all_required_rooms_healthy=False,
        ),
    )
    assert [r.room_id for r in result["selected_rooms"]]==["b"]
    denied=result["routing_snapshot"]["denied"]
    assert denied[0]["room_id"]=="a"
    assert "ROOM_LATENCY_EXCEEDED" in denied[0]["reasons"]


def test_insufficient_healthy_quorum_fails():
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    reg=RoomDiscoveryRegistry((room("a",required=False),room("b",required=False)))
    discovered=reg.discover(probe_map({"a":(True,10),"b":(False,20)}))
    with pytest.raises(DeployError,match="ROOM_ROUTING_QUORUM_FAILED"):
        HealthAwareRouter(identity).select(
            discovered,
            RoutingPolicy(
                minimum_healthy_rooms=2,
                require_all_required_rooms_healthy=False,
            ),
        )


def test_disallowed_role_not_selected():
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    reg=RoomDiscoveryRegistry((room("a",role="witness",required=False),))
    discovered=reg.discover(probe_map({"a":(True,10)}))
    with pytest.raises(DeployError,match="ROOM_ROUTING_QUORUM_FAILED"):
        HealthAwareRouter(identity).select(
            discovered,
            RoutingPolicy(
                minimum_healthy_rooms=1,
                allowed_roles=("public-verifier",),
                require_all_required_rooms_healthy=False,
            ),
        )
