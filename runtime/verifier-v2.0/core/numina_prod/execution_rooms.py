from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Callable

from .deploy_provider import DeployError, DeployResult, DeploySpec, get_provider
from .signing import SigningIdentity


ROOM_RECEIPT_TYPE = "NUMINA_EXECUTION_ROOM_RECEIPT"
ROOM_SET_RECEIPT_TYPE = "NUMINA_EXECUTION_ROOM_SET_RECEIPT"


def _canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _digest(value: dict) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


@dataclass(frozen=True)
class ExecutionRoom:
    room_id: str
    provider: str
    target: str
    role: str = "public-verifier"
    required: bool = True
    metadata: dict | None = None

    def __post_init__(self):
        if not self.room_id:
            raise ValueError("room_id is required")
        if self.role not in {"public-verifier","authority-node","witness"}:
            raise ValueError("unsupported room role")


@dataclass(frozen=True)
class RoomOutcome:
    room_id: str
    provider: str
    target: str
    role: str
    status: str
    artifact_sha256: str
    provider_ref: str | None
    success: bool
    error: str | None = None


@dataclass(frozen=True)
class RoomSetPolicy:
    minimum_successful_rooms: int = 1
    require_all_required_rooms: bool = True
    allowed_roles: tuple[str, ...] = ("public-verifier",)

    def __post_init__(self):
        if self.minimum_successful_rooms < 1:
            raise ValueError("minimum_successful_rooms must be >= 1")


class ExecutionRoomOrchestrator:
    def __init__(
        self,
        identity: SigningIdentity,
        provider_factory: Callable[[str], object] = get_provider,
    ):
        self.identity = identity
        self.provider_factory = provider_factory

    def _spec_for_room(self, base: DeploySpec, room: ExecutionRoom) -> DeploySpec:
        if room.role != base.role:
            raise DeployError("ROOM_ROLE_MISMATCH")
        meta = dict(base.metadata or {})
        meta.update(room.metadata or {})
        return DeploySpec(
            deployment_id=f"{base.deployment_id}:{room.room_id}",
            provider=room.provider,
            artifact=base.artifact,
            artifact_sha256=base.artifact_sha256,
            role=base.role,
            environment=base.environment,
            target=room.target,
            image=base.image,
            namespace=base.namespace,
            service_name=base.service_name,
            public_url=base.public_url,
            metadata=meta,
        )

    def _room_receipt(
        self,
        base: DeploySpec,
        room: ExecutionRoom,
        outcome: RoomOutcome,
    ) -> dict:
        return self.identity.sign(
            {
                "base_deployment_id": base.deployment_id,
                "artifact_sha256": base.artifact_sha256,
                "room": asdict(room),
                "outcome": asdict(outcome),
            },
            ROOM_RECEIPT_TYPE,
        )

    def apply(
        self,
        base: DeploySpec,
        rooms: tuple[ExecutionRoom, ...],
        policy: RoomSetPolicy,
    ) -> dict:
        if base.role not in policy.allowed_roles:
            raise DeployError("ROOM_SET_ROLE_NOT_ALLOWED")
        if not rooms:
            raise DeployError("NO_EXECUTION_ROOMS")
        room_ids=[r.room_id for r in rooms]
        if len(room_ids) != len(set(room_ids)):
            raise DeployError("DUPLICATE_EXECUTION_ROOM_ID")

        outcomes=[]
        receipts=[]
        successful=0
        required_failures=[]

        for room in rooms:
            try:
                spec=self._spec_for_room(base, room)
                provider=self.provider_factory(room.provider)
                result:DeployResult=provider.apply(spec)
                success=result.status in {"accepted","deployed","running","verified"}
                outcome=RoomOutcome(
                    room_id=room.room_id,
                    provider=room.provider,
                    target=room.target,
                    role=room.role,
                    status=result.status,
                    artifact_sha256=base.artifact_sha256,
                    provider_ref=result.provider_ref,
                    success=success,
                    error=None if success else "ROOM_PROVIDER_NON_SUCCESS_STATUS",
                )
            except Exception as exc:
                outcome=RoomOutcome(
                    room_id=room.room_id,
                    provider=room.provider,
                    target=room.target,
                    role=room.role,
                    status="failed",
                    artifact_sha256=base.artifact_sha256,
                    provider_ref=None,
                    success=False,
                    error=f"{type(exc).__name__}:{exc}",
                )

            outcomes.append(outcome)
            receipts.append(self._room_receipt(base, room, outcome))
            if outcome.success:
                successful += 1
            elif room.required:
                required_failures.append(room.room_id)

        allowed = successful >= policy.minimum_successful_rooms
        if policy.require_all_required_rooms and required_failures:
            allowed = False

        summary = {
            "base_deployment_id": base.deployment_id,
            "artifact_sha256": base.artifact_sha256,
            "role": base.role,
            "environment": base.environment,
            "room_count": len(rooms),
            "successful_rooms": successful,
            "required_failures": required_failures,
            "policy": asdict(policy),
            "outcomes": [asdict(x) for x in outcomes],
            "room_receipt_digests": [
                _digest(r) for r in receipts
            ],
            "allowed": allowed,
        }
        set_receipt=self.identity.sign(summary, ROOM_SET_RECEIPT_TYPE)

        if not allowed:
            raise DeployError(
                "ROOM_SET_QUORUM_FAILED:" +
                json.dumps({
                    "successful_rooms":successful,
                    "minimum_successful_rooms":policy.minimum_successful_rooms,
                    "required_failures":required_failures,
                },sort_keys=True)
            )

        return {
            "summary":summary,
            "room_receipts":receipts,
            "room_set_receipt":set_receipt,
        }

    def verify(
        self,
        base: DeploySpec,
        rooms: tuple[ExecutionRoom, ...],
        policy: RoomSetPolicy,
    ) -> dict:
        if base.role not in policy.allowed_roles:
            raise DeployError("ROOM_SET_ROLE_NOT_ALLOWED")
        outcomes=[]
        successful=0
        required_failures=[]

        for room in rooms:
            try:
                spec=self._spec_for_room(base, room)
                result=self.provider_factory(room.provider).verify(spec)
                success=result.status=="verified"
                outcome=RoomOutcome(
                    room.room_id,room.provider,room.target,room.role,
                    result.status,base.artifact_sha256,result.provider_ref,
                    success,None if success else "ROOM_NOT_VERIFIED"
                )
            except Exception as exc:
                outcome=RoomOutcome(
                    room.room_id,room.provider,room.target,room.role,
                    "failed",base.artifact_sha256,None,False,
                    f"{type(exc).__name__}:{exc}"
                )
            outcomes.append(outcome)
            if outcome.success:
                successful += 1
            elif room.required:
                required_failures.append(room.room_id)

        allowed = successful >= policy.minimum_successful_rooms
        if policy.require_all_required_rooms and required_failures:
            allowed=False

        return {
            "allowed":allowed,
            "successful_rooms":successful,
            "required_failures":required_failures,
            "outcomes":[asdict(x) for x in outcomes],
        }
