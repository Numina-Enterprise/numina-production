from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Callable

from .deploy_provider import DeployError, DeploySpec
from .execution_rooms import (
    ExecutionRoom,
    ExecutionRoomOrchestrator,
    RoomSetPolicy,
)
from .room_discovery import (
    DiscoveredRoom,
    HealthAwareRouter,
    RoomDiscoveryRegistry,
    RoomHealth,
    RoutingPolicy,
)
from .room_rebalancing import RoomRebalancer
from .signing import SigningIdentity
from .convergence_journal import ConvergenceJournal


CONVERGENCE_RECEIPT_TYPE="NUMINA_DEPLOYMENT_CONVERGENCE_RECEIPT"


def _canonical(value:dict)->bytes:
    return json.dumps(value,sort_keys=True,separators=(",",":")).encode()


def _digest(value:dict)->str:
    return hashlib.sha256(_canonical(value)).hexdigest()


@dataclass(frozen=True)
class ConvergencePolicy:
    maximum_cycles:int=4
    minimum_verified_rooms:int=1
    require_all_required_rooms:bool=True
    allowed_roles:tuple[str,...]=("public-verifier",)

    def __post_init__(self):
        if self.maximum_cycles < 1:
            raise ValueError("maximum_cycles must be >= 1")
        if self.minimum_verified_rooms < 1:
            raise ValueError("minimum_verified_rooms must be >= 1")


@dataclass(frozen=True)
class CycleEvidence:
    cycle:int
    routing_digest:str
    selected_room_ids:tuple[str,...]
    verified_room_ids:tuple[str,...]
    unhealthy_room_ids:tuple[str,...]
    actions:tuple[dict,...]
    converged:bool


class ConvergenceController:
    """Bounded reconciliation controller for Numina deployment rooms.

    The controller never loops indefinitely. Each cycle re-observes health,
    routes from current state, applies/repairs selected rooms, verifies them,
    and emits immutable cycle evidence. If convergence is not achieved before
    maximum_cycles, it fails closed.
    """

    def __init__(
        self,
        identity:SigningIdentity,
        *,
        health_probe:Callable[[ExecutionRoom],RoomHealth],
        provider_factory,
        journal:ConvergenceJournal|None=None,
    ):
        self.identity=identity
        self.health_probe=health_probe
        self.provider_factory=provider_factory
        self.journal=journal

    def converge(
        self,
        *,
        base:DeploySpec,
        rooms:tuple[ExecutionRoom,...],
        routing_policy:RoutingPolicy,
        room_set_policy:RoomSetPolicy,
        convergence_policy:ConvergencePolicy,
    )->dict:
        if base.role not in convergence_policy.allowed_roles:
            raise DeployError("CONVERGENCE_ROLE_NOT_ALLOWED")
        if not rooms:
            raise DeployError("NO_EXECUTION_ROOMS")

        registry=RoomDiscoveryRegistry(rooms)
        router=HealthAwareRouter(self.identity)
        orchestrator=ExecutionRoomOrchestrator(
            self.identity,
            provider_factory=self.provider_factory,
        )
        rebalancer=RoomRebalancer(self.identity)

        cycles=[]
        latest_selected=()
        converged=False

        for cycle in range(1,convergence_policy.maximum_cycles+1):
            discovered=registry.discover(self.health_probe)
            routing=router.select(discovered,routing_policy)
            selected=tuple(routing["selected_rooms"])
            latest_selected=selected

            actions=[]

            # Apply current desired selected set. Provider-level idempotency remains
            # the responsibility of each provider implementation.
            apply_result=orchestrator.apply(
                base,
                selected,
                room_set_policy,
            )
            actions.append({
                "type":"apply-room-set",
                "room_ids":[r.room_id for r in selected],
                "room_set_receipt_digest":_digest(
                    apply_result["room_set_receipt"]
                ),
            })

            verification=orchestrator.verify(
                base,
                selected,
                room_set_policy,
            )
            verified_ids=tuple(
                x["room_id"]
                for x in verification["outcomes"]
                if x["success"]
            )

            refreshed=registry.discover(self.health_probe)
            refreshed_by_id={x.room.room_id:x for x in refreshed}
            unhealthy=tuple(
                r.room_id for r in selected
                if r.room_id in refreshed_by_id
                and not refreshed_by_id[r.room_id].health.healthy
            )

            if unhealthy:
                # Record deterministic replacement decisions for failed selected
                # rooms. Replacements become eligible on the next cycle after a
                # complete re-observation; this avoids mutating the active room set
                # mid-verification.
                prior_snapshot=routing["routing_snapshot"]
                for failed_id in unhealthy:
                    try:
                        rebalance=rebalancer.rebalance(
                            base=base,
                            prior_routing=prior_snapshot,
                            discovered=refreshed,
                            failed_room_id=failed_id,
                            routing_policy=routing_policy,
                        )
                        actions.append({
                            "type":"rebalance",
                            "failed_room_id":failed_id,
                            "replacement_room_id":rebalance["replacement_room"].room_id,
                            "rebalance_receipt_digest":_digest(
                                rebalance["rebalance_receipt"]
                            ),
                        })
                    except DeployError as exc:
                        actions.append({
                            "type":"rebalance-failed",
                            "failed_room_id":failed_id,
                            "reason":str(exc),
                        })

            required_selected_ids={
                r.room_id for r in selected if r.required
            }
            required_verified=required_selected_ids.issubset(set(verified_ids))

            converged=(
                len(verified_ids) >= convergence_policy.minimum_verified_rooms
                and not unhealthy
                and (
                    required_verified
                    if convergence_policy.require_all_required_rooms
                    else True
                )
            )

            cycle_evidence=CycleEvidence(
                cycle=cycle,
                routing_digest=routing["routing_digest"],
                selected_room_ids=tuple(r.room_id for r in selected),
                verified_room_ids=verified_ids,
                unhealthy_room_ids=unhealthy,
                actions=tuple(actions),
                converged=converged,
            )
            cycles.append(cycle_evidence)

            if self.journal is not None:
                self.journal.append_cycle(
                    deployment_id=base.deployment_id,
                    cycle=cycle,
                    routing_digest=cycle_evidence.routing_digest,
                    selected_room_ids=cycle_evidence.selected_room_ids,
                    verified_room_ids=cycle_evidence.verified_room_ids,
                    unhealthy_room_ids=cycle_evidence.unhealthy_room_ids,
                    converged=cycle_evidence.converged,
                )

            if converged:
                break

        payload={
            "deployment_id":base.deployment_id,
            "artifact_sha256":base.artifact_sha256,
            "role":base.role,
            "environment":base.environment,
            "convergence_policy":asdict(convergence_policy),
            "routing_policy":asdict(routing_policy),
            "room_set_policy":asdict(room_set_policy),
            "cycles":[asdict(c) for c in cycles],
            "final_selected_room_ids":[r.room_id for r in latest_selected],
            "converged":converged,
            "journal_head_digest":self.journal.head_digest() if self.journal is not None else None,
        }
        receipt=self.identity.sign(payload,CONVERGENCE_RECEIPT_TYPE)

        if not converged:
            raise DeployError(
                "DEPLOYMENT_CONVERGENCE_FAILED:"+
                json.dumps({
                    "cycles":len(cycles),
                    "maximum_cycles":convergence_policy.maximum_cycles,
                    "final_selected_room_ids":[r.room_id for r in latest_selected],
                },sort_keys=True)
            )

        result={
            "converged":True,
            "cycles":[asdict(c) for c in cycles],
            "convergence_receipt":receipt,
            "convergence_digest":_digest(payload),
            "journal_head_digest":payload["journal_head_digest"],
        }
        if self.journal is not None:
            result["journal_checkpoint"]=self.journal.checkpoint(
                self.identity,
                deployment_id=base.deployment_id,
            )
        return result
