from __future__ import annotations

from dataclasses import dataclass, asdict, replace
from enum import Enum
from hashlib import sha256
import json
from typing import Dict, Iterable, Optional, Tuple


class RightsError(ValueError):
    pass


class RightLifecycle(str, Enum):
    PROPOSED = "PROPOSED"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    EXTINGUISHED = "EXTINGUISHED"


class RightRecognitionState(str, Enum):
    LOCAL = "LOCAL"
    RECOGNIZED = "RECOGNIZED"
    DISPUTED = "DISPUTED"
    REJECTED = "REJECTED"


class RightKind(str, Enum):
    CLAIM = "CLAIM"
    CONTROL = "CONTROL"
    USE = "USE"
    GOVERNANCE = "GOVERNANCE"
    CREATION = "CREATION"
    RECOGNITION = "RECOGNITION"


class BackingKind(str, Enum):
    RESOURCE_BACKED = "RESOURCE_BACKED"
    CONTRACTUAL = "CONTRACTUAL"
    PROTOCOL_NATIVE = "PROTOCOL_NATIVE"
    STATUTORY = "STATUTORY"
    UNBACKED_INSTITUTIONAL = "UNBACKED_INSTITUTIONAL"


class RightsVMOp(str, Enum):
    CREATE_RIGHT = "CREATE_RIGHT"
    RECOGNIZE_RIGHT = "RECOGNIZE_RIGHT"
    SUSPEND_RIGHT = "SUSPEND_RIGHT"
    ACTIVATE_RIGHT = "ACTIVATE_RIGHT"
    EXTINGUISH_RIGHT = "EXTINGUISH_RIGHT"


def _digest(value) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=list).encode()).hexdigest()


@dataclass(frozen=True)
class RightsOccupancy:
    reserved_for_creation: int = 0
    encumbered: int = 0
    exercised: int = 0
    uncertain: int = 0

    def __post_init__(self):
        if min(self.reserved_for_creation, self.encumbered, self.exercised, self.uncertain) < 0:
            raise RightsError("rights occupancy must be non-negative")

    @property
    def occupied(self) -> int:
        return self.reserved_for_creation + self.encumbered + self.exercised + self.uncertain


@dataclass(frozen=True)
class RuntimeRight:
    right_id: str
    principal_id: str
    origin_domain: str
    right_class: str
    right_kind: RightKind
    backing_kind: BackingKind
    capacity: int
    unit: str = "USD_MINOR"
    source_right_ids: Tuple[str, ...] = ()
    lifecycle: RightLifecycle = RightLifecycle.ACTIVE
    transferable: bool = False
    priority: int = 0
    occupancy: RightsOccupancy = RightsOccupancy()
    recognition: Tuple[Tuple[str, RightRecognitionState], ...] = ()
    created_sequence: int = 0

    def __post_init__(self):
        if not self.right_id or not self.principal_id or not self.origin_domain or not self.right_class or not self.unit:
            raise RightsError("right identity fields are required")
        if self.capacity < 0 or self.priority < 0 or self.created_sequence < 0:
            raise RightsError("right numeric fields must be non-negative")
        if self.occupancy.occupied > self.capacity:
            raise RightsError("rights occupancy exceeds capacity")
        if len(set(self.source_right_ids)) != len(self.source_right_ids):
            raise RightsError("duplicate source right")

    @property
    def available(self) -> int:
        if self.lifecycle != RightLifecycle.ACTIVE:
            return 0
        return self.capacity - self.occupancy.occupied

    @property
    def right_digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class RightCreationAuthority:
    authority_id: str
    controller_principal_id: str
    origin_domain: str
    allowed_right_classes: Tuple[str, ...]
    max_capacity_per_right: int
    max_total_created_capacity: int
    allow_root_genesis: bool = False
    allowed_backing_kinds: Tuple[BackingKind, ...] = tuple(BackingKind)

    def __post_init__(self):
        if not self.authority_id or not self.controller_principal_id or not self.origin_domain:
            raise RightsError("creation authority identity fields required")
        if self.max_capacity_per_right < 0 or self.max_total_created_capacity < 0:
            raise RightsError("creation authority bounds must be non-negative")


@dataclass(frozen=True)
class RightGenesisRequest:
    right_id: str
    principal_id: str
    right_class: str
    right_kind: RightKind
    backing_kind: BackingKind
    capacity: int
    source_right_ids: Tuple[str, ...] = ()
    transferable: bool = False
    priority: int = 0


@dataclass(frozen=True)
class ReciprocalEconomicPair:
    pair_id: str
    right_id: str
    obligation_id: str
    creditor_principal_id: str
    debtor_principal_id: str
    amount: int
    unit: str
    created_sequence: int

    @property
    def pair_digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class RightsObligation:
    obligation_id: str
    debtor_principal_id: str
    creditor_principal_id: str
    amount: int
    unit: str = "USD_MINOR"
    state: str = "OPEN"

    def __post_init__(self):
        if self.amount < 0:
            raise RightsError("obligation amount must be non-negative")
        if self.state not in ("OPEN", "DISPUTED", "FINAL", "SATISFIED"):
            raise RightsError("unsupported obligation state")


@dataclass(frozen=True)
class RecognitionBudget:
    budget_id: str
    recognizer_domain: str
    issuer_domain: str
    right_class: str
    max_open_recognized_capacity: int
    unit: str = "USD_MINOR"

    def __post_init__(self):
        if self.max_open_recognized_capacity < 0:
            raise RightsError("recognition budget must be non-negative")


@dataclass(frozen=True)
class RightRecognition:
    right_id: str
    recognizer_domain: str
    budget_id: str
    recognized_capacity: int
    state: RightRecognitionState
    sequence: int


@dataclass(frozen=True)
class RightsEvent:
    sequence: int
    event_type: str
    object_id: str
    pre_root: str
    post_root: str


@dataclass(frozen=True)
class RightsVMInstruction:
    op: RightsVMOp
    args: Tuple[Tuple[str, object], ...]

    @staticmethod
    def build(op: RightsVMOp, **kwargs) -> "RightsVMInstruction":
        return RightsVMInstruction(op, tuple(sorted(kwargs.items())))

    def argdict(self) -> dict:
        return dict(self.args)


@dataclass(frozen=True)
class RightsProgram:
    program_id: str
    instructions: Tuple[RightsVMInstruction, ...]

    @property
    def program_digest(self) -> str:
        payload = {"program_id": self.program_id, "instructions": [asdict(i) for i in self.instructions]}
        return _digest(payload)


@dataclass(frozen=True)
class RightsExecutionResult:
    program_digest: str
    pre_root: str
    post_root: str
    sequence: int
    event_count: int


class RightsRuntime:
    """Deterministic in-memory reference runtime for rights genesis and mutation.

    The runtime creates protocol/local rights only through explicit creation authority.
    External recognition is separately budgeted and never widens intrinsic right capacity.
    """

    def __init__(self):
        self.rights: Dict[str, RuntimeRight] = {}
        self.creation_authorities: Dict[str, RightCreationAuthority] = {}
        self.obligations: Dict[str, RightsObligation] = {}
        self.reciprocal_pairs: Dict[str, ReciprocalEconomicPair] = {}
        self.recognition_budgets: Dict[str, RecognitionBudget] = {}
        self.recognitions: Dict[Tuple[str, str], RightRecognition] = {}
        self.events: list[RightsEvent] = []
        self.sequence = 0

    @property
    def state_root(self) -> str:
        payload = {
            "sequence": self.sequence,
            "rights": tuple(sorted((k, asdict(v)) for k, v in self.rights.items())),
            "obligations": tuple(sorted((k, asdict(v)) for k, v in self.obligations.items())),
            "pairs": tuple(sorted((k, asdict(v)) for k, v in self.reciprocal_pairs.items())),
            "recognitions": tuple(sorted((str(k), asdict(v)) for k, v in self.recognitions.items())),
        }
        return _digest(payload)

    def _record(self, event_type: str, object_id: str, pre_root: str):
        self.sequence += 1
        post = self.state_root
        self.events.append(RightsEvent(self.sequence, event_type, object_id, pre_root, post))

    def add_creation_authority(self, authority: RightCreationAuthority):
        if authority.authority_id in self.creation_authorities:
            raise RightsError("duplicate creation authority")
        self.creation_authorities[authority.authority_id] = authority

    def add_recognition_budget(self, budget: RecognitionBudget):
        if budget.budget_id in self.recognition_budgets:
            raise RightsError("duplicate recognition budget")
        self.recognition_budgets[budget.budget_id] = budget

    def _created_capacity(self, authority: RightCreationAuthority) -> int:
        return sum(r.capacity for r in self.rights.values() if r.origin_domain == authority.origin_domain and r.right_class in authority.allowed_right_classes)

    def create_right(self, authority_id: str, req: RightGenesisRequest) -> RuntimeRight:
        if req.right_id in self.rights:
            raise RightsError("duplicate right id")
        auth = self.creation_authorities.get(authority_id)
        if auth is None:
            raise RightsError("unknown rights creation authority")
        if req.right_class not in auth.allowed_right_classes:
            raise RightsError("right class not permitted")
        if req.backing_kind not in auth.allowed_backing_kinds:
            raise RightsError("backing kind not permitted")
        if req.capacity < 0 or req.capacity > auth.max_capacity_per_right:
            raise RightsError("right capacity exceeds creation authority")
        if self._created_capacity(auth) + req.capacity > auth.max_total_created_capacity:
            raise RightsError("aggregate created rights exceed creation authority")
        if not req.source_right_ids and not auth.allow_root_genesis:
            raise RightsError("root rights genesis not permitted")

        sources = []
        for rid in req.source_right_ids:
            src = self.rights.get(rid)
            if src is None:
                raise RightsError("missing source right")
            if src.principal_id != req.principal_id:
                raise RightsError("source/right principal mismatch")
            if src.unit != "USD_MINOR":
                raise RightsError("source unit mismatch")
            sources.append(src)
        if sources and sum(s.available for s in sources) < req.capacity:
            raise RightsError("insufficient source-right capacity")

        pre = self.state_root
        # Conservative backing: consume from listed sources in deterministic ID order.
        remaining = req.capacity if sources else 0
        updates = {}
        for src in sorted(sources, key=lambda r: r.right_id):
            if remaining == 0:
                break
            take = min(src.available, remaining)
            occ = replace(src.occupancy, encumbered=src.occupancy.encumbered + take)
            updates[src.right_id] = replace(src, occupancy=occ)
            remaining -= take
        if remaining:
            raise RightsError("source reservation failed")
        self.rights.update(updates)
        right = RuntimeRight(
            req.right_id, req.principal_id, auth.origin_domain, req.right_class, req.right_kind,
            req.backing_kind, req.capacity, "USD_MINOR", tuple(sorted(req.source_right_ids)),
            RightLifecycle.ACTIVE, req.transferable, req.priority, RightsOccupancy(), (), self.sequence + 1,
        )
        self.rights[right.right_id] = right
        self._record("RIGHT_CREATED", right.right_id, pre)
        return right

    def create_reciprocal_claim(self, authority_id: str, pair_id: str, right_id: str, obligation_id: str,
                                creditor_principal_id: str, debtor_principal_id: str, amount: int,
                                right_class: str = "CLAIM") -> ReciprocalEconomicPair:
        if pair_id in self.reciprocal_pairs or obligation_id in self.obligations or right_id in self.rights:
            raise RightsError("duplicate reciprocal object")
        auth = self.creation_authorities.get(authority_id)
        if auth is None or right_class not in auth.allowed_right_classes:
            raise RightsError("reciprocal right creation not permitted")
        if amount < 0 or amount > auth.max_capacity_per_right:
            raise RightsError("reciprocal amount exceeds bound")
        if self._created_capacity(auth) + amount > auth.max_total_created_capacity:
            raise RightsError("aggregate created rights exceed creation authority")
        pre = self.state_root
        right = RuntimeRight(right_id, creditor_principal_id, auth.origin_domain, right_class, RightKind.CLAIM,
                             BackingKind.CONTRACTUAL, amount, created_sequence=self.sequence + 1)
        obligation = RightsObligation(obligation_id, debtor_principal_id, creditor_principal_id, amount)
        pair = ReciprocalEconomicPair(pair_id, right_id, obligation_id, creditor_principal_id,
                                      debtor_principal_id, amount, "USD_MINOR", self.sequence + 1)
        # Atomic in reference runtime: all validations precede mutation.
        self.rights[right_id] = right
        self.obligations[obligation_id] = obligation
        self.reciprocal_pairs[pair_id] = pair
        self._record("RECIPROCAL_PAIR_CREATED", pair_id, pre)
        return pair

    def recognize_right(self, right_id: str, budget_id: str, recognized_capacity: Optional[int] = None) -> RightRecognition:
        right = self.rights.get(right_id)
        budget = self.recognition_budgets.get(budget_id)
        if right is None or budget is None:
            raise RightsError("right or recognition budget missing")
        if right.origin_domain != budget.issuer_domain or right.right_class != budget.right_class:
            raise RightsError("recognition budget does not match right")
        amount = right.capacity if recognized_capacity is None else recognized_capacity
        if amount < 0 or amount > right.capacity:
            raise RightsError("recognition cannot widen intrinsic right")
        key = (right_id, budget.recognizer_domain)
        prior = self.recognitions.get(key)
        prior_amount = prior.recognized_capacity if prior and prior.state == RightRecognitionState.RECOGNIZED else 0
        used = sum(x.recognized_capacity for k, x in self.recognitions.items()
                   if x.budget_id == budget_id and x.state == RightRecognitionState.RECOGNIZED) - prior_amount
        if used + amount > budget.max_open_recognized_capacity:
            raise RightsError("recognition budget exceeded")
        pre = self.state_root
        rec = RightRecognition(right_id, budget.recognizer_domain, budget_id, amount,
                               RightRecognitionState.RECOGNIZED, self.sequence + 1)
        self.recognitions[key] = rec
        mapping = dict(right.recognition)
        mapping[budget.recognizer_domain] = RightRecognitionState.RECOGNIZED
        self.rights[right_id] = replace(right, recognition=tuple(sorted(mapping.items())))
        self._record("RIGHT_RECOGNIZED", right_id, pre)
        return rec

    def set_recognition_state(self, right_id: str, recognizer_domain: str, state: RightRecognitionState):
        key = (right_id, recognizer_domain)
        rec = self.recognitions.get(key)
        right = self.rights.get(right_id)
        if rec is None or right is None:
            raise RightsError("recognition missing")
        pre = self.state_root
        self.recognitions[key] = replace(rec, state=state, sequence=self.sequence + 1)
        mapping = dict(right.recognition)
        mapping[recognizer_domain] = state
        self.rights[right_id] = replace(right, recognition=tuple(sorted(mapping.items())))
        self._record("RECOGNITION_STATE_CHANGED", right_id, pre)

    def suspend_right(self, right_id: str):
        right = self.rights.get(right_id)
        if right is None or right.lifecycle != RightLifecycle.ACTIVE:
            raise RightsError("only active right may be suspended")
        pre = self.state_root
        self.rights[right_id] = replace(right, lifecycle=RightLifecycle.SUSPENDED)
        self._record("RIGHT_SUSPENDED", right_id, pre)

    def activate_right(self, right_id: str):
        right = self.rights.get(right_id)
        if right is None or right.lifecycle != RightLifecycle.SUSPENDED:
            raise RightsError("only suspended right may be activated")
        pre = self.state_root
        self.rights[right_id] = replace(right, lifecycle=RightLifecycle.ACTIVE)
        self._record("RIGHT_ACTIVATED", right_id, pre)

    def add_uncertainty(self, right_id: str, amount: int):
        right = self.rights.get(right_id)
        if right is None or amount < 0 or amount > right.available:
            raise RightsError("invalid rights uncertainty")
        pre = self.state_root
        occ = replace(right.occupancy, uncertain=right.occupancy.uncertain + amount)
        self.rights[right_id] = replace(right, occupancy=occ)
        self._record("RIGHT_UNCERTAINTY_OPENED", right_id, pre)

    def narrow_uncertainty(self, right_id: str, amount: int):
        right = self.rights.get(right_id)
        if right is None or amount < 0 or amount > right.occupancy.uncertain:
            raise RightsError("invalid uncertainty narrowing")
        pre = self.state_root
        occ = replace(right.occupancy, uncertain=right.occupancy.uncertain - amount)
        self.rights[right_id] = replace(right, occupancy=occ)
        self._record("RIGHT_UNCERTAINTY_NARROWED", right_id, pre)

    def transfer_right(self, right_id: str, new_principal_id: str):
        right = self.rights.get(right_id)
        if right is None or not right.transferable:
            raise RightsError("right is not transferable")
        if right.occupancy.occupied:
            raise RightsError("occupied right cannot transfer")
        pre = self.state_root
        self.rights[right_id] = replace(right, principal_id=new_principal_id)
        self._record("RIGHT_TRANSFERRED", right_id, pre)

    def extinguish_right(self, right_id: str):
        right = self.rights.get(right_id)
        if right is None or right.lifecycle == RightLifecycle.EXTINGUISHED:
            raise RightsError("right unavailable")
        if right.occupancy.occupied:
            raise RightsError("occupied right cannot be extinguished")
        if any(right_id in r.source_right_ids and r.lifecycle != RightLifecycle.EXTINGUISHED for r in self.rights.values()):
            raise RightsError("right has active descendants")
        pre = self.state_root
        # Release backing to sources when a derived right is extinguished.
        remaining = right.capacity
        for sid in sorted(right.source_right_ids):
            src = self.rights[sid]
            release = min(src.occupancy.encumbered, remaining)
            self.rights[sid] = replace(src, occupancy=replace(src.occupancy, encumbered=src.occupancy.encumbered-release))
            remaining -= release
        self.rights[right_id] = replace(right, lifecycle=RightLifecycle.EXTINGUISHED)
        self._record("RIGHT_EXTINGUISHED", right_id, pre)

    def mr_rc(self, right_id: str) -> int:
        """Conservative Maximum Reachable Rights Consequence.

        Sum intrinsic capacity across active descendants, counting each right once. This
        is intentionally conservative and is not reusable authority.
        """
        if right_id not in self.rights:
            raise RightsError("right missing")
        children: Dict[str, list[str]] = {}
        for r in self.rights.values():
            for sid in r.source_right_ids:
                children.setdefault(sid, []).append(r.right_id)
        seen = set()
        def walk(rid: str) -> int:
            if rid in seen:
                return 0
            seen.add(rid)
            r = self.rights[rid]
            total = r.capacity if r.lifecycle != RightLifecycle.EXTINGUISHED else 0
            for cid in sorted(children.get(rid, ())):
                total += walk(cid)
            return total
        return walk(right_id)

    def execute(self, program: RightsProgram, authority_id: str) -> RightsExecutionResult:
        pre = self.state_root
        before_events = len(self.events)
        # Reference VM is deterministic and fail-stop. It executes only simple lifecycle
        # and recognition operations; genesis arguments are canonicalized in instructions.
        for ins in program.instructions:
            a = ins.argdict()
            if ins.op == RightsVMOp.CREATE_RIGHT:
                req = RightGenesisRequest(
                    a["right_id"], a["principal_id"], a["right_class"], RightKind(a["right_kind"]),
                    BackingKind(a["backing_kind"]), int(a["capacity"]), tuple(a.get("source_right_ids", ())),
                    bool(a.get("transferable", False)), int(a.get("priority", 0)),
                )
                self.create_right(authority_id, req)
            elif ins.op == RightsVMOp.RECOGNIZE_RIGHT:
                self.recognize_right(a["right_id"], a["budget_id"], int(a["recognized_capacity"]))
            elif ins.op == RightsVMOp.SUSPEND_RIGHT:
                self.suspend_right(a["right_id"])
            elif ins.op == RightsVMOp.ACTIVATE_RIGHT:
                self.activate_right(a["right_id"])
            elif ins.op == RightsVMOp.EXTINGUISH_RIGHT:
                self.extinguish_right(a["right_id"])
            else:
                raise RightsError("unsupported Rights VM opcode")
        return RightsExecutionResult(program.program_digest, pre, self.state_root, self.sequence, len(self.events)-before_events)

    def to_institutional_components(self):
        """Project active Rights Runtime state into the v1.3 Institutional Compiler types."""
        from numina_core import InstitutionalRight, InstitutionalObligation
        rights = tuple(
            InstitutionalRight(r.right_id, r.principal_id, r.right_class, r.capacity, r.source_right_ids,
                               "RIGHTS_RUNTIME", r.transferable)
            for r in sorted(self.rights.values(), key=lambda x: x.right_id)
            if r.lifecycle != RightLifecycle.EXTINGUISHED
        )
        obligations = tuple(
            InstitutionalObligation(o.obligation_id, o.debtor_principal_id, o.creditor_principal_id, o.amount, o.state)
            for o in sorted(self.obligations.values(), key=lambda x: x.obligation_id)
        )
        return rights, obligations
