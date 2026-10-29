from __future__ import annotations

import hashlib
import json
import time
from dataclasses import asdict, dataclass
from typing import Callable

from .deploy_provider import DeployError
from .execution_rooms import ExecutionRoom
from .signing import SigningIdentity

ROOM_DISCOVERY_RECEIPT_TYPE="NUMINA_ROOM_DISCOVERY_RECEIPT"
ROOM_ROUTING_RECEIPT_TYPE="NUMINA_ROOM_ROUTING_RECEIPT"


def _canonical(v:dict)->bytes:
    return json.dumps(v,sort_keys=True,separators=(",",":")).encode()

def _digest(v:dict)->str:
    return hashlib.sha256(_canonical(v)).hexdigest()


@dataclass(frozen=True)
class RoomHealth:
    room_id:str
    healthy:bool
    latency_ms:int|None
    observed_at:int
    status:str
    detail:dict

@dataclass(frozen=True)
class DiscoveredRoom:
    room:ExecutionRoom
    health:RoomHealth

@dataclass(frozen=True)
class RoutingPolicy:
    minimum_healthy_rooms:int=1
    allowed_providers:tuple[str,...]=("docker","kubernetes","https","remote")
    allowed_roles:tuple[str,...]=("public-verifier",)
    maximum_latency_ms:int|None=None
    require_all_required_rooms_healthy:bool=True

    def __post_init__(self):
        if self.minimum_healthy_rooms < 1:
            raise ValueError("minimum_healthy_rooms must be >= 1")


class RoomDiscoveryRegistry:
    def __init__(self, rooms:tuple[ExecutionRoom,...]):
        ids=[r.room_id for r in rooms]
        if len(ids)!=len(set(ids)):
            raise DeployError("DUPLICATE_EXECUTION_ROOM_ID")
        self.rooms=rooms

    def discover(
        self,
        health_probe:Callable[[ExecutionRoom],RoomHealth],
        *,
        now:int|None=None,
    )->tuple[DiscoveredRoom,...]:
        observed=[]
        for room in self.rooms:
            health=health_probe(room)
            observed.append(DiscoveredRoom(room,health))
        return tuple(observed)


class HealthAwareRouter:
    def __init__(self, identity:SigningIdentity):
        self.identity=identity

    def select(
        self,
        discovered:tuple[DiscoveredRoom,...],
        policy:RoutingPolicy,
    )->dict:
        denied=[]
        selected=[]
        required_unhealthy=[]

        for item in discovered:
            room=item.room
            health=item.health
            reasons=[]
            if room.provider not in policy.allowed_providers:
                reasons.append("PROVIDER_NOT_ALLOWED")
            if room.role not in policy.allowed_roles:
                reasons.append("ROLE_NOT_ALLOWED")
            if not health.healthy:
                reasons.append("ROOM_UNHEALTHY")
            if (
                policy.maximum_latency_ms is not None
                and health.latency_ms is not None
                and health.latency_ms > policy.maximum_latency_ms
            ):
                reasons.append("ROOM_LATENCY_EXCEEDED")

            if reasons:
                denied.append({
                    "room_id":room.room_id,
                    "reasons":reasons,
                    "health":asdict(health),
                })
                if room.required and (
                    "ROOM_UNHEALTHY" in reasons or "ROOM_LATENCY_EXCEEDED" in reasons
                ):
                    required_unhealthy.append(room.room_id)
                continue
            selected.append(item)

        allowed=len(selected) >= policy.minimum_healthy_rooms
        if policy.require_all_required_rooms_healthy and required_unhealthy:
            allowed=False

        snapshot={
            "policy":asdict(policy),
            "discovered":[
                {"room":asdict(x.room),"health":asdict(x.health)}
                for x in discovered
            ],
            "selected_room_ids":[x.room.room_id for x in selected],
            "denied":denied,
            "required_unhealthy":required_unhealthy,
            "allowed":allowed,
        }
        receipt=self.identity.sign(snapshot,ROOM_ROUTING_RECEIPT_TYPE)

        if not allowed:
            raise DeployError(
                "ROOM_ROUTING_QUORUM_FAILED:"+
                json.dumps({
                    "selected":len(selected),
                    "minimum":policy.minimum_healthy_rooms,
                    "required_unhealthy":required_unhealthy,
                },sort_keys=True)
            )

        return {
            "selected_rooms":[x.room for x in selected],
            "routing_snapshot":snapshot,
            "routing_receipt":receipt,
            "routing_digest":_digest(snapshot),
        }


def static_health_probe(
    room:ExecutionRoom,
    *,
    healthy:bool=True,
    latency_ms:int|None=1,
    status:str="ready",
    detail:dict|None=None,
)->RoomHealth:
    return RoomHealth(
        room_id=room.room_id,
        healthy=healthy,
        latency_ms=latency_ms,
        observed_at=int(time.time()),
        status=status,
        detail=detail or {},
    )
