from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Callable

from .deploy_provider import DeployError, DeploySpec
from .execution_rooms import ExecutionRoom
from .room_discovery import DiscoveredRoom, RoomHealth, RoutingPolicy, HealthAwareRouter
from .signing import SigningIdentity

ROOM_REBALANCE_RECEIPT_TYPE="NUMINA_ROOM_REBALANCE_RECEIPT"


def _canonical(v:dict)->bytes:
    return json.dumps(v,sort_keys=True,separators=(",",":")).encode()

def _digest(v:dict)->str:
    return hashlib.sha256(_canonical(v)).hexdigest()


@dataclass(frozen=True)
class RebalanceDecision:
    failed_room_id:str
    replacement_room_id:str
    prior_routing_digest:str
    reason:str
    artifact_sha256:str
    deployment_id:str


class RoomRebalancer:
    def __init__(self, identity:SigningIdentity):
        self.identity=identity

    def rebalance(
        self,
        *,
        base:DeploySpec,
        prior_routing:dict,
        discovered:tuple[DiscoveredRoom,...],
        failed_room_id:str,
        routing_policy:RoutingPolicy,
    )->dict:
        selected_ids=set(prior_routing.get("selected_room_ids",[]))
        if failed_room_id not in selected_ids:
            raise DeployError("FAILED_ROOM_NOT_IN_PRIOR_ROUTING")

        failed = next((x for x in discovered if x.room.room_id==failed_room_id),None)
        if failed is None:
            raise DeployError("FAILED_ROOM_NOT_DISCOVERED")
        if failed.health.healthy:
            raise DeployError("FAILED_ROOM_STILL_HEALTHY")

        candidate_discovered=tuple(
            x for x in discovered
            if x.room.room_id not in selected_ids
            and x.room.room_id != failed_room_id
        )
        if not candidate_discovered:
            raise DeployError("NO_REBALANCE_CANDIDATES")

        result=HealthAwareRouter(self.identity).select(
            candidate_discovered,
            RoutingPolicy(
                minimum_healthy_rooms=1,
                allowed_providers=routing_policy.allowed_providers,
                allowed_roles=routing_policy.allowed_roles,
                maximum_latency_ms=routing_policy.maximum_latency_ms,
                require_all_required_rooms_healthy=False,
            ),
        )
        replacement=result["selected_rooms"][0]

        decision=RebalanceDecision(
            failed_room_id=failed_room_id,
            replacement_room_id=replacement.room_id,
            prior_routing_digest=_digest(prior_routing),
            reason="ROOM_BECAME_UNHEALTHY",
            artifact_sha256=base.artifact_sha256,
            deployment_id=base.deployment_id,
        )
        payload={
            "decision":asdict(decision),
            "replacement_room":asdict(replacement),
            "replacement_routing_digest":result["routing_digest"],
        }
        receipt=self.identity.sign(payload,ROOM_REBALANCE_RECEIPT_TYPE)
        return {
            "replacement_room":replacement,
            "decision":asdict(decision),
            "rebalance_receipt":receipt,
        }
