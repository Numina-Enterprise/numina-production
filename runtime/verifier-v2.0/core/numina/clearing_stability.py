from __future__ import annotations

from dataclasses import dataclass, asdict
from enum import Enum
from hashlib import sha256
import json
from typing import Dict, Tuple


def _digest(v) -> str:
    return sha256(json.dumps(v, sort_keys=True, separators=(",", ":"), default=list).encode()).hexdigest()


class StabilityError(Exception):
    pass


class MarginState(str, Enum):
    HEALTHY = "HEALTHY"
    CALL_REQUIRED = "CALL_REQUIRED"
    CALL_OUTSTANDING = "CALL_OUTSTANDING"
    DEFAULT_PENDING = "DEFAULT_PENDING"
    DEFAULT_DECLARED = "DEFAULT_DECLARED"
    RECOVERY = "RECOVERY"


@dataclass(frozen=True)
class MarginProfile:
    domain_id: str
    maintenance_bps: int
    call_buffer_bps: int
    max_call_amount: int
    call_deadline_seq: int

    def __post_init__(self):
        if not self.domain_id or not (0 <= self.maintenance_bps <= 10_000) or not (0 <= self.call_buffer_bps <= 10_000):
            raise StabilityError("invalid margin profile")
        if self.max_call_amount < 0 or self.call_deadline_seq < 0:
            raise StabilityError("invalid margin profile bounds")


@dataclass(frozen=True)
class MarginAssessment:
    domain_id: str
    exposure: int
    eligible_collateral: int
    settlement_capacity: int
    required_support: int
    deficiency: int
    state: MarginState

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class MarginCall:
    call_id: str
    domain_id: str
    amount: int
    issued_sequence: int
    deadline_sequence: int
    source_assessment_digest: str
    state: str = "OPEN"

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class WaterfallLayer:
    layer_id: str
    available_amount: int
    priority: int
    source_kind: str

    def __post_init__(self):
        if not self.layer_id or self.available_amount < 0 or self.priority < 0 or not self.source_kind:
            raise StabilityError("invalid waterfall layer")


@dataclass(frozen=True)
class WaterfallUse:
    layer_id: str
    amount: int
    source_kind: str


@dataclass(frozen=True)
class WaterfallResult:
    deficiency: int
    uses: Tuple[WaterfallUse, ...]
    residual_deficiency: int
    source_root: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class RecoveryStep:
    step_id: str
    order: int
    action_class: str
    max_amount: int
    risk_adding: bool = False


@dataclass(frozen=True)
class RecoveryPlan:
    domain_id: str
    steps: Tuple[RecoveryStep, ...]
    initial_deficiency: int
    projected_residual_deficiency: int
    source_root: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class SystemicEnvelope:
    total_open_obligations: int
    total_eligible_collateral: int
    total_settlement_capacity: int
    total_deficiency: int
    max_single_domain_deficiency: int
    domains_in_deficiency: Tuple[str, ...]
    state_root: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class CrisisNonAmplificationProof:
    before_risk_authority: int
    after_risk_authority: int
    before_open_obligations: int
    after_open_obligations: int
    uncertainty_preserved: bool
    valid: bool
    source_root: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


class AutonomousClearingStabilityRuntime:
    """Deterministic crisis-control layer over ConstitutionalMarketRuntime.

    It may identify margin deficiency, issue bounded calls, allocate pre-existing
    default resources, and build non-risk-adding recovery plans. It cannot create
    collateral, erase gross obligations, or treat crisis as a source of authority.
    """

    def __init__(self, market):
        self.market = market
        self.margin_profiles: Dict[str, MarginProfile] = {}
        self.margin_calls: Dict[str, MarginCall] = {}
        self.waterfall_layers: Dict[str, WaterfallLayer] = {}

    def set_margin_profile(self, profile: MarginProfile):
        if profile.domain_id not in self.market.members:
            raise StabilityError("unknown margin domain")
        self.margin_profiles[profile.domain_id] = profile

    def assess_margin(self, domain_id: str) -> MarginAssessment:
        p = self.margin_profiles.get(domain_id)
        if p is None:
            raise StabilityError("margin profile missing")
        m = self.market.members[domain_id]
        exposure = sum(o.amount for o in self.market.obligations.values()
                       if o.debtor == domain_id and o.state == "OPEN")
        collateral = sum(l.eligible_after_haircut for l in self.market.collateral.values()
                         if l.owner == domain_id)
        required = (exposure * p.maintenance_bps + 9_999) // 10_000
        support = collateral + m.settlement_capacity
        deficiency = max(0, required - support)
        if deficiency == 0:
            state = MarginState.HEALTHY
        elif support > 0:
            state = MarginState.CALL_REQUIRED
        else:
            state = MarginState.DEFAULT_PENDING
        return MarginAssessment(domain_id, exposure, collateral, m.settlement_capacity, required, deficiency, state)

    def issue_margin_call(self, call_id: str, domain_id: str, sequence: int) -> MarginCall:
        if not call_id or call_id in self.margin_calls or sequence < 0:
            raise StabilityError("invalid margin call")
        p = self.margin_profiles.get(domain_id)
        if p is None:
            raise StabilityError("margin profile missing")
        a = self.assess_margin(domain_id)
        if a.deficiency <= 0:
            raise StabilityError("no margin deficiency")
        buffered = a.deficiency + (a.deficiency * p.call_buffer_bps + 9_999) // 10_000
        amount = min(buffered, p.max_call_amount)
        c = MarginCall(call_id, domain_id, amount, sequence, sequence + p.call_deadline_seq, a.digest)
        self.margin_calls[call_id] = c
        return c

    def add_waterfall_layer(self, layer: WaterfallLayer):
        if layer.layer_id in self.waterfall_layers:
            raise StabilityError("duplicate waterfall layer")
        self.waterfall_layers[layer.layer_id] = layer

    def allocate_waterfall(self, deficiency: int) -> WaterfallResult:
        if deficiency < 0:
            raise StabilityError("invalid deficiency")
        remaining = deficiency
        uses = []
        layers = sorted(self.waterfall_layers.values(), key=lambda x: (x.priority, x.layer_id))
        for layer in layers:
            if remaining <= 0:
                break
            take = min(remaining, layer.available_amount)
            if take:
                uses.append(WaterfallUse(layer.layer_id, take, layer.source_kind))
                remaining -= take
        root = _digest(tuple((x.layer_id, x.available_amount, x.priority, x.source_kind) for x in layers))
        return WaterfallResult(deficiency, tuple(uses), remaining, root)

    def build_recovery_plan(self, domain_id: str, steps: Tuple[RecoveryStep, ...]) -> RecoveryPlan:
        if domain_id not in self.market.members:
            raise StabilityError("unknown recovery domain")
        if any(s.risk_adding for s in steps):
            raise StabilityError("recovery may not add risk authority")
        if len({s.step_id for s in steps}) != len(steps):
            raise StabilityError("duplicate recovery step")
        ordered = tuple(sorted(steps, key=lambda s:(s.order,s.step_id)))
        if tuple(s.order for s in ordered) != tuple(sorted(s.order for s in ordered)):
            raise StabilityError("invalid recovery ordering")
        a = self.assess_margin(domain_id)
        residual = a.deficiency
        for s in ordered:
            if s.action_class not in ("OBLIGATION_SATISFYING", "RISK_REDUCING", "RECONCILIATION", "COLLATERALIZATION"):
                raise StabilityError("unsupported recovery action class")
            residual = max(0, residual - s.max_amount)
        root = _digest({"margin":a.digest,"steps":[asdict(s) for s in ordered]})
        return RecoveryPlan(domain_id, ordered, a.deficiency, residual, root)

    def systemic_envelope(self) -> SystemicEnvelope:
        total_ob = sum(o.amount for o in self.market.obligations.values() if o.state == "OPEN")
        total_col = sum(l.eligible_after_haircut for l in self.market.collateral.values())
        total_settlement = sum(m.settlement_capacity for m in self.market.members.values())
        deficiencies = []
        for domain in sorted(self.margin_profiles):
            a = self.assess_margin(domain)
            if a.deficiency:
                deficiencies.append((domain, a.deficiency))
        return SystemicEnvelope(total_ob, total_col, total_settlement,
                                sum(v for _,v in deficiencies),
                                max((v for _,v in deficiencies), default=0),
                                tuple(d for d,_ in deficiencies),
                                self.market.state_root())

    @staticmethod
    def prove_non_amplification(before_risk_authority: int, after_risk_authority: int,
                                before_open_obligations: int, after_open_obligations: int,
                                uncertainty_preserved: bool, source_root: str) -> CrisisNonAmplificationProof:
        if min(before_risk_authority, after_risk_authority, before_open_obligations, after_open_obligations) < 0:
            raise StabilityError("invalid proof inputs")
        valid = (after_risk_authority <= before_risk_authority and
                 after_open_obligations >= 0 and uncertainty_preserved)
        return CrisisNonAmplificationProof(before_risk_authority, after_risk_authority,
                                           before_open_obligations, after_open_obligations,
                                           uncertainty_preserved, valid, source_root)
