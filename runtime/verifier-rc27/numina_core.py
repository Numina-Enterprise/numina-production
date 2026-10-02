from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from hashlib import sha256
import json
from typing import Dict, List, Optional, Tuple


class Decision(str, Enum):
    ALLOW = "ALLOW"
    DENY = "DENY"
    ESCALATE = "ESCALATE"


class Lifecycle(str, Enum):
    AUTHORIZED = "AUTHORIZED"
    COMMITTING = "COMMITTING"
    ECONOMICALLY_POSSIBLE = "ECONOMICALLY_POSSIBLE"
    OBSERVED = "OBSERVED"
    FINAL = "FINAL"
    CLOSED = "CLOSED"


class Legitimacy(str, Enum):
    VALID = "VALID"
    VIOLATION = "VIOLATION"
    DISPUTED = "DISPUTED"


class Certainty(str, Enum):
    KNOWN = "KNOWN"
    BOUNDED_UNCERTAIN = "BOUNDED_UNCERTAIN"


@dataclass(frozen=True)
class DependencyClosure:
    authority_epoch: int
    mandate_epoch: int
    policy_epoch: int
    risk_epoch: int
    runtime_epoch: int
    position_epoch: int
    valuation_epoch: int
    rail_epoch: int


@dataclass
class State:
    sequence: int = 0
    rights_capacity_usd_minor: int = 0
    mandate_epoch: int = 1
    policy_epoch: int = 1
    risk_epoch: int = 1
    runtime_epoch: int = 1
    position_epoch: int = 1
    valuation_epoch: int = 1
    authority_epoch: int = 1
    rail_epochs: Dict[str, int] = field(default_factory=lambda: {"SIM_A": 1, "SIM_B": 1})
    valuation_eth_usd_minor: int = 300_000  # $3,000.00
    valuation_valid_until_seq: int = 10**18
    final_eth_wei: int = 0
    reserved_usd_minor: int = 0
    committed_usd_minor: int = 0
    uncertain_usd_minor: int = 0
    reserved_eth_wei: int = 0
    committed_eth_wei: int = 0
    uncertain_eth_wei: int = 0
    consumed_nonces: set[str] = field(default_factory=set)

    def available_usd_minor(self) -> int:
        return max(0, self.rights_capacity_usd_minor - self.reserved_usd_minor - self.committed_usd_minor - self.uncertain_usd_minor)

    def digest(self) -> str:
        payload = {
            "sequence": self.sequence,
            "rights_capacity_usd_minor": self.rights_capacity_usd_minor,
            "mandate_epoch": self.mandate_epoch,
            "policy_epoch": self.policy_epoch,
            "risk_epoch": self.risk_epoch,
            "runtime_epoch": self.runtime_epoch,
            "position_epoch": self.position_epoch,
            "valuation_epoch": self.valuation_epoch,
            "authority_epoch": self.authority_epoch,
            "rail_epochs": dict(sorted(self.rail_epochs.items())),
            "valuation_eth_usd_minor": self.valuation_eth_usd_minor,
            "valuation_valid_until_seq": self.valuation_valid_until_seq,
            "final_eth_wei": self.final_eth_wei,
            "reserved_usd_minor": self.reserved_usd_minor,
            "committed_usd_minor": self.committed_usd_minor,
            "uncertain_usd_minor": self.uncertain_usd_minor,
            "reserved_eth_wei": self.reserved_eth_wei,
            "committed_eth_wei": self.committed_eth_wei,
            "uncertain_eth_wei": self.uncertain_eth_wei,
            "consumed_nonces": sorted(self.consumed_nonces),
        }
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return sha256(raw).hexdigest()


@dataclass
class Intent:
    operation_id: str
    authorization_id: str
    reservation_id: str
    principal_id: str
    agent_id: str
    mandate_id: str
    side: str  # BUY or SELL
    asset: str
    rail: str
    max_quantity_wei: int
    max_price_usd_minor_per_eth: int
    max_notional_usd_minor: int
    nonce: str
    deps: DependencyClosure


@dataclass
class Operation:
    intent: Intent
    lifecycle: Lifecycle = Lifecycle.AUTHORIZED
    legitimacy: Legitimacy = Legitimacy.VALID
    certainty: Certainty = Certainty.KNOWN
    cumulative_fill_wei: int = 0
    cumulative_fill_notional_usd_minor: int = 0
    reservation_remaining_usd_minor: int = 0
    reservation_remaining_eth_wei: int = 0
    fill_ids: set[str] = field(default_factory=set)


@dataclass
class Event:
    kind: str
    operation_id: str
    payload: dict
    sequence: int
    pre_state_digest: str
    post_state_digest: str


class ConstitutionalError(RuntimeError):
    pass


class NuminaRuntime:
    def __init__(self, state: State):
        self.state = state
        self.operations: Dict[str, Operation] = {}
        self.events: List[Event] = []

    def _current_deps(self, rail: str) -> DependencyClosure:
        return DependencyClosure(
            authority_epoch=self.state.authority_epoch,
            mandate_epoch=self.state.mandate_epoch,
            policy_epoch=self.state.policy_epoch,
            risk_epoch=self.state.risk_epoch,
            runtime_epoch=self.state.runtime_epoch,
            position_epoch=self.state.position_epoch,
            valuation_epoch=self.state.valuation_epoch,
            rail_epoch=self.state.rail_epochs[rail],
        )

    def _deps_current(self, intent: Intent) -> bool:
        return intent.deps == self._current_deps(intent.rail)

    def evaluate(self, intent: Intent) -> Tuple[Decision, str]:
        if intent.asset != "ETH" or intent.rail not in self.state.rail_epochs:
            return Decision.DENY, "UNSUPPORTED_DOMAIN"
        if intent.max_quantity_wei < 0 or intent.max_notional_usd_minor < 0 or intent.max_price_usd_minor_per_eth <= 0:
            return Decision.DENY, "INVALID_BOUNDS"
        if not self._deps_current(intent):
            return Decision.DENY, "STALE_DEPENDENCY"
        if self.state.sequence > self.state.valuation_valid_until_seq:
            return Decision.ESCALATE, "STALE_VALUATION"
        if intent.operation_id in self.operations:
            return Decision.DENY, "DUPLICATE_OPERATION"
        if intent.nonce in self.state.consumed_nonces:
            return Decision.DENY, "NONCE_ALREADY_CONSUMED"
        if intent.side == "BUY":
            if intent.max_notional_usd_minor > self.state.available_usd_minor():
                return Decision.DENY, "INSUFFICIENT_AUTHORITY"
            implied = (intent.max_quantity_wei * intent.max_price_usd_minor_per_eth) // 10**18
            if implied > intent.max_notional_usd_minor:
                return Decision.DENY, "INCONSISTENT_ENVELOPE"
            return Decision.ALLOW, "WITHIN_AUTHORITY"
        if intent.side == "SELL":
            sellable = self.state.final_eth_wei - self.state.reserved_eth_wei - self.state.committed_eth_wei - self.state.uncertain_eth_wei
            if intent.max_quantity_wei > sellable:
                return Decision.DENY, "INSUFFICIENT_FINAL_POSITION"
            return Decision.ALLOW, "WITHIN_AUTHORITY"
        return Decision.DENY, "UNSUPPORTED_SIDE"

    def _append(self, kind: str, operation_id: str, payload: dict, mutator) -> Event:
        pre = self.state.digest()
        mutator()
        self.state.sequence += 1
        post = self.state.digest()
        ev = Event(kind, operation_id, payload, self.state.sequence, pre, post)
        self.events.append(ev)
        self.assert_invariants()
        return ev

    def create_reservation(self, intent: Intent) -> Event:
        decision, reason = self.evaluate(intent)
        if decision != Decision.ALLOW:
            raise ConstitutionalError(f"reservation rejected: {decision}:{reason}")

        def mutate():
            if intent.side == "BUY":
                self.state.reserved_usd_minor += intent.max_notional_usd_minor
            else:
                self.state.reserved_eth_wei += intent.max_quantity_wei
            self.operations[intent.operation_id] = Operation(
                intent=intent,
                reservation_remaining_usd_minor=intent.max_notional_usd_minor if intent.side == "BUY" else 0,
                reservation_remaining_eth_wei=intent.max_quantity_wei if intent.side == "SELL" else 0,
            )
        return self._append("CREATE_RESERVATION", intent.operation_id, {"reason": reason}, mutate)

    def begin_commit(self, operation_id: str) -> Event:
        op = self.operations[operation_id]
        i = op.intent
        if op.lifecycle != Lifecycle.AUTHORIZED:
            raise ConstitutionalError("operation not AUTHORIZED")
        if not self._deps_current(i):
            raise ConstitutionalError("stale dependency at commit")
        if i.nonce in self.state.consumed_nonces:
            raise ConstitutionalError("nonce reuse")

        def mutate():
            self.state.consumed_nonces.add(i.nonce)
            op.lifecycle = Lifecycle.COMMITTING
            if i.side == "BUY":
                self.state.reserved_usd_minor -= op.reservation_remaining_usd_minor
                self.state.committed_usd_minor += op.reservation_remaining_usd_minor
            else:
                self.state.reserved_eth_wei -= op.reservation_remaining_eth_wei
                self.state.committed_eth_wei += op.reservation_remaining_eth_wei
        return self._append("BEGIN_COMMIT", operation_id, {}, mutate)

    def submission_accepted(self, operation_id: str) -> Event:
        op = self.operations[operation_id]
        if op.lifecycle != Lifecycle.COMMITTING:
            raise ConstitutionalError("must be COMMITTING")
        return self._append("SUBMISSION_ACCEPTED", operation_id, {}, lambda: setattr(op, "lifecycle", Lifecycle.ECONOMICALLY_POSSIBLE))

    def submission_unknown(self, operation_id: str) -> Event:
        op = self.operations[operation_id]
        if op.lifecycle not in (Lifecycle.COMMITTING, Lifecycle.ECONOMICALLY_POSSIBLE):
            raise ConstitutionalError("invalid unknown transition")
        def mutate():
            op.lifecycle = Lifecycle.ECONOMICALLY_POSSIBLE
            op.certainty = Certainty.BOUNDED_UNCERTAIN
            if op.intent.side == "BUY":
                amt = op.reservation_remaining_usd_minor
                self.state.committed_usd_minor -= amt
                self.state.uncertain_usd_minor += amt
            else:
                amt = op.reservation_remaining_eth_wei
                self.state.committed_eth_wei -= amt
                self.state.uncertain_eth_wei += amt
        return self._append("SUBMISSION_UNKNOWN", operation_id, {}, mutate)

    def fill_confirmed(self, operation_id: str, fill_id: str, quantity_wei: int, price_usd_minor_per_eth: int) -> Event:
        op = self.operations[operation_id]
        if fill_id in op.fill_ids:
            return self._append("DUPLICATE_FILL_IGNORED", operation_id, {"fill_id": fill_id}, lambda: None)
        notional = (quantity_wei * price_usd_minor_per_eth) // 10**18
        def mutate():
            op.fill_ids.add(fill_id)
            op.cumulative_fill_wei += quantity_wei
            op.cumulative_fill_notional_usd_minor += notional
            op.lifecycle = Lifecycle.OBSERVED
            if (op.cumulative_fill_wei > op.intent.max_quantity_wei or
                op.cumulative_fill_notional_usd_minor > op.intent.max_notional_usd_minor or
                price_usd_minor_per_eth > op.intent.max_price_usd_minor_per_eth):
                op.legitimacy = Legitimacy.VIOLATION
        return self._append("FILL_CONFIRMED", operation_id, {"fill_id": fill_id, "qty": quantity_wei, "price": price_usd_minor_per_eth}, mutate)

    def cancel_requested(self, operation_id: str) -> Event:
        return self._append("CANCEL_REQUESTED", operation_id, {}, lambda: None)

    def cancel_confirmed(self, operation_id: str) -> Event:
        op = self.operations[operation_id]
        if op.certainty == Certainty.BOUNDED_UNCERTAIN:
            raise ConstitutionalError("cannot release uncertain remainder without reconciliation")
        def mutate():
            if op.intent.side == "BUY":
                filled = op.cumulative_fill_notional_usd_minor
                remainder = max(0, op.intent.max_notional_usd_minor - filled)
                release = min(remainder, self.state.committed_usd_minor)
                self.state.committed_usd_minor -= release
                op.reservation_remaining_usd_minor = max(0, op.reservation_remaining_usd_minor - release)
            else:
                filled = op.cumulative_fill_wei
                remainder = max(0, op.intent.max_quantity_wei - filled)
                release = min(remainder, self.state.committed_eth_wei)
                self.state.committed_eth_wei -= release
                op.reservation_remaining_eth_wei = max(0, op.reservation_remaining_eth_wei - release)
        return self._append("CANCEL_CONFIRMED", operation_id, {}, mutate)

    def non_execution_proven(self, operation_id: str) -> Event:
        op = self.operations[operation_id]
        def mutate():
            if op.intent.side == "BUY":
                release = min(op.reservation_remaining_usd_minor, self.state.uncertain_usd_minor)
                self.state.uncertain_usd_minor -= release
                op.reservation_remaining_usd_minor -= release
            else:
                release = min(op.reservation_remaining_eth_wei, self.state.uncertain_eth_wei)
                self.state.uncertain_eth_wei -= release
                op.reservation_remaining_eth_wei -= release
            op.certainty = Certainty.KNOWN
            op.lifecycle = Lifecycle.CLOSED
        return self._append("NON_EXECUTION_PROVEN", operation_id, {}, mutate)

    def settlement_provisional(self, operation_id: str) -> Event:
        op = self.operations[operation_id]
        return self._append("SETTLEMENT_PROVISIONAL", operation_id, {}, lambda: None)

    def settlement_final(self, operation_id: str) -> Event:
        op = self.operations[operation_id]
        if op.lifecycle == Lifecycle.FINAL:
            raise ConstitutionalError("finality already applied")
        def mutate():
            if op.intent.side == "BUY":
                occupied = op.intent.max_notional_usd_minor
                self.state.committed_usd_minor = max(0, self.state.committed_usd_minor - occupied)
                self.state.uncertain_usd_minor = max(0, self.state.uncertain_usd_minor - occupied)
                self.state.final_eth_wei += op.cumulative_fill_wei
            else:
                occupied = op.intent.max_quantity_wei
                self.state.committed_eth_wei = max(0, self.state.committed_eth_wei - occupied)
                self.state.uncertain_eth_wei = max(0, self.state.uncertain_eth_wei - occupied)
                self.state.final_eth_wei -= op.cumulative_fill_wei
            self.state.position_epoch += 1
            op.lifecycle = Lifecycle.FINAL
            op.certainty = Certainty.KNOWN
        return self._append("SETTLEMENT_FINAL", operation_id, {}, mutate)

    def revoke(self):
        self.state.authority_epoch += 1

    def assert_invariants(self):
        s = self.state
        # C1/C3: no occupancy above recognized rights for USD buy authority.
        if s.reserved_usd_minor < 0 or s.committed_usd_minor < 0 or s.uncertain_usd_minor < 0:
            raise ConstitutionalError("negative occupancy")
        if s.reserved_usd_minor + s.committed_usd_minor + s.uncertain_usd_minor > s.rights_capacity_usd_minor:
            raise ConstitutionalError("authority non-conservation")
        # C7: provisional assets do not increase final position; enforced by only modifying final position in settlement_final.
        if s.final_eth_wei < 0:
            raise ConstitutionalError("negative final ETH")
        # C13 deterministic state projection is guaranteed by canonical digest and integer-only state.

    def receipt(self, operation_id: str) -> dict:
        op = self.operations[operation_id]
        payload = {
            "operation_id": operation_id,
            "authorization_id": op.intent.authorization_id,
            "lifecycle": op.lifecycle.value,
            "legitimacy": op.legitimacy.value,
            "certainty": op.certainty.value,
            "cumulative_fill_wei": op.cumulative_fill_wei,
            "cumulative_fill_notional_usd_minor": op.cumulative_fill_notional_usd_minor,
            "state_digest": self.state.digest(),
            "sequence": self.state.sequence,
        }
        payload["receipt_digest"] = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return payload


def make_intent(rt: NuminaRuntime, *, op="op1", side="BUY", qty_wei=10**18, px_minor=300_000, notional_minor=300_000, rail="SIM_A", nonce="n1") -> Intent:
    return Intent(
        operation_id=op,
        authorization_id=f"auth-{op}",
        reservation_id=f"res-{op}",
        principal_id="principal-1",
        agent_id="agent-1",
        mandate_id="mandate-1",
        side=side,
        asset="ETH",
        rail=rail,
        max_quantity_wei=qty_wei,
        max_price_usd_minor_per_eth=px_minor,
        max_notional_usd_minor=notional_minor,
        nonce=nonce,
        deps=rt._current_deps(rail),
    )

# --- v1.1 Adaptive Authority Control Layer ---------------------------------

@dataclass(frozen=True)
class AuthorityDomainSample:
    domain_id: str
    live_authority_usd_minor: int
    reserved_usd_minor: int = 0
    committed_usd_minor: int = 0
    uncertain_usd_minor: int = 0
    pending_legitimate_demand_usd_minor: int = 0
    activation_delay_seq: int = 0
    revocation_delay_seq: int = 0
    authority_velocity_usd_minor_per_seq: int = 0
    observation_lag_seq: int = 0
    dependency_ids: Tuple[str, ...] = ()

    def __post_init__(self):
        vals = (
            self.live_authority_usd_minor,
            self.reserved_usd_minor,
            self.committed_usd_minor,
            self.uncertain_usd_minor,
            self.pending_legitimate_demand_usd_minor,
            self.activation_delay_seq,
            self.revocation_delay_seq,
            self.authority_velocity_usd_minor_per_seq,
            self.observation_lag_seq,
        )
        if any(v < 0 for v in vals):
            raise ConstitutionalError("negative authority-field sample")

    def occupied_usd_minor(self) -> int:
        return self.reserved_usd_minor + self.committed_usd_minor + self.uncertain_usd_minor

    def liquid_usd_minor(self) -> int:
        return max(0, self.live_authority_usd_minor - self.occupied_usd_minor())


@dataclass(frozen=True)
class SafetyEnvelope:
    max_mrec_usd_minor: int
    max_uncertain_usd_minor: int
    max_authority_velocity_usd_minor_per_seq: int
    max_observation_lag_seq: int
    max_dependency_concentration_bps: int
    max_pressure_bps: int
    min_liquidity_usd_minor: int = 0

    def __post_init__(self):
        if any(v < 0 for v in asdict(self).values()):
            raise ConstitutionalError("negative safety-envelope bound")
        if self.max_dependency_concentration_bps > 10_000 or self.max_pressure_bps > 10_000_000:
            raise ConstitutionalError("invalid basis-point bound")

    def digest(self) -> str:
        raw = json.dumps(asdict(self), sort_keys=True, separators=(",", ":")).encode()
        return sha256(raw).hexdigest()


@dataclass(frozen=True)
class FieldMetrics:
    mrec_usd_minor: int
    liquid_authority_usd_minor: int
    uncertain_usd_minor: int
    max_velocity_usd_minor_per_seq: int
    max_observation_lag_seq: int
    dependency_concentration_bps: int
    pressure_bps: int
    entropy_index: int
    sample_count: int

    def digest(self) -> str:
        raw = json.dumps(asdict(self), sort_keys=True, separators=(",", ":")).encode()
        return sha256(raw).hexdigest()


class AuthorityPhysicsV11:
    """Pure, deterministic derived-field calculations. Never mutates authority."""

    @staticmethod
    def metrics(samples: List[AuthorityDomainSample], horizon_seq: int = 1) -> FieldMetrics:
        if horizon_seq < 0:
            raise ConstitutionalError("negative horizon")
        if not samples:
            return FieldMetrics(0, 0, 0, 0, 0, 0, 0, 0, 0)

        mrec = 0
        liquid = 0
        uncertain = 0
        max_velocity = 0
        max_lag = 0
        total_live = 0
        total_demand = 0
        dep_totals: Dict[str, int] = {}
        distribution: List[int] = []

        for s in sorted(samples, key=lambda x: x.domain_id):
            liquid_i = s.liquid_usd_minor()
            liquid += liquid_i
            uncertain += s.uncertain_usd_minor
            total_live += s.live_authority_usd_minor
            total_demand += s.pending_legitimate_demand_usd_minor
            max_velocity = max(max_velocity, s.authority_velocity_usd_minor_per_seq)
            max_lag = max(max_lag, s.observation_lag_seq)
            distribution.append(s.live_authority_usd_minor)

            if horizon_seq >= s.activation_delay_seq:
                active_window = horizon_seq - s.activation_delay_seq
                if s.authority_velocity_usd_minor_per_seq == 0:
                    reachable = liquid_i
                else:
                    reachable = min(liquid_i, s.authority_velocity_usd_minor_per_seq * active_window)
                # Already-live committed/uncertain consequence remains reachable/real.
                reachable += s.committed_usd_minor + s.uncertain_usd_minor
                mrec += reachable

            for dep in sorted(set(s.dependency_ids)):
                dep_totals[dep] = dep_totals.get(dep, 0) + s.live_authority_usd_minor

        concentration = 0
        if total_live > 0 and dep_totals:
            concentration = max((amt * 10_000) // total_live for amt in dep_totals.values())

        pressure = 0
        if total_demand > 0:
            if liquid == 0:
                pressure = 10_000_000
            else:
                pressure = (total_demand * 10_000) // liquid

        # Deterministic integer concentration/dispersion proxy: sum pairwise absolute gaps,
        # normalized by total live authority. This is intentionally not Shannon entropy.
        entropy = 0
        if total_live > 0:
            pair_gap = 0
            for i, a in enumerate(distribution):
                for b in distribution[i + 1:]:
                    pair_gap += abs(a - b)
            entropy = (pair_gap * 10_000) // total_live

        return FieldMetrics(
            mrec_usd_minor=mrec,
            liquid_authority_usd_minor=liquid,
            uncertain_usd_minor=uncertain,
            max_velocity_usd_minor_per_seq=max_velocity,
            max_observation_lag_seq=max_lag,
            dependency_concentration_bps=concentration,
            pressure_bps=pressure,
            entropy_index=entropy,
            sample_count=len(samples),
        )


@dataclass(frozen=True)
class EnvelopeAssessment:
    compliant: bool
    breaches: Tuple[str, ...]
    metrics_digest: str
    envelope_digest: str
    assessment_digest: str


class ContinuousSafetyEnvelope:
    @staticmethod
    def assess(metrics: FieldMetrics, envelope: SafetyEnvelope) -> EnvelopeAssessment:
        breaches: List[str] = []
        checks = (
            (metrics.mrec_usd_minor > envelope.max_mrec_usd_minor, "MREC"),
            (metrics.uncertain_usd_minor > envelope.max_uncertain_usd_minor, "UNCERTAINTY"),
            (metrics.max_velocity_usd_minor_per_seq > envelope.max_authority_velocity_usd_minor_per_seq, "VELOCITY"),
            (metrics.max_observation_lag_seq > envelope.max_observation_lag_seq, "OBSERVATION_LAG"),
            (metrics.dependency_concentration_bps > envelope.max_dependency_concentration_bps, "DEPENDENCY_CONCENTRATION"),
            (metrics.pressure_bps > envelope.max_pressure_bps, "PRESSURE"),
            (metrics.liquid_authority_usd_minor < envelope.min_liquidity_usd_minor, "LIQUIDITY"),
        )
        for failed, name in checks:
            if failed:
                breaches.append(name)
        payload = {
            "compliant": not breaches,
            "breaches": sorted(breaches),
            "metrics_digest": metrics.digest(),
            "envelope_digest": envelope.digest(),
        }
        assessment_digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return EnvelopeAssessment(not breaches, tuple(sorted(breaches)), metrics.digest(), envelope.digest(), assessment_digest)


@dataclass(frozen=True)
class ContractionInstruction:
    domain_id: str
    old_limit_usd_minor: int
    new_limit_usd_minor: int
    old_velocity_usd_minor_per_seq: int
    new_velocity_usd_minor_per_seq: int
    old_offline_horizon_seq: int
    new_offline_horizon_seq: int
    reason: str

    def __post_init__(self):
        if self.new_limit_usd_minor > self.old_limit_usd_minor:
            raise ConstitutionalError("contraction may not increase authority limit")
        if self.new_velocity_usd_minor_per_seq > self.old_velocity_usd_minor_per_seq:
            raise ConstitutionalError("contraction may not increase velocity")
        if self.new_offline_horizon_seq > self.old_offline_horizon_seq:
            raise ConstitutionalError("contraction may not increase offline horizon")


@dataclass(frozen=True)
class AdaptiveControlPlan:
    source_metrics_digest: str
    source_envelope_digest: str
    instructions: Tuple[ContractionInstruction, ...]
    plan_digest: str

    def total_old_limit(self) -> int:
        return sum(i.old_limit_usd_minor for i in self.instructions)

    def total_new_limit(self) -> int:
        return sum(i.new_limit_usd_minor for i in self.instructions)


class AdaptiveAuthorityController:
    """Produces only non-expansive automatic responses. Expansion requires external governance."""

    @staticmethod
    def plan(samples: List[AuthorityDomainSample], envelope: SafetyEnvelope, horizon_seq: int = 1) -> AdaptiveControlPlan:
        metrics = AuthorityPhysicsV11.metrics(samples, horizon_seq)
        assessment = ContinuousSafetyEnvelope.assess(metrics, envelope)
        instructions: List[ContractionInstruction] = []

        if not assessment.compliant:
            for s in sorted(samples, key=lambda x: x.domain_id):
                new_limit = s.live_authority_usd_minor
                new_velocity = s.authority_velocity_usd_minor_per_seq
                new_offline = s.revocation_delay_seq
                reasons: List[str] = []

                # Observation/control mismatch: reachable machine speed may not outrun observation.
                if "OBSERVATION_LAG" in assessment.breaches and s.observation_lag_seq > envelope.max_observation_lag_seq:
                    new_velocity = min(new_velocity, max(0, envelope.max_authority_velocity_usd_minor_per_seq))
                    new_offline = min(new_offline, envelope.max_observation_lag_seq)
                    reasons.append("OBSERVATION_LAG")

                if "VELOCITY" in assessment.breaches and s.authority_velocity_usd_minor_per_seq > envelope.max_authority_velocity_usd_minor_per_seq:
                    new_velocity = min(new_velocity, envelope.max_authority_velocity_usd_minor_per_seq)
                    reasons.append("VELOCITY")

                if "UNCERTAINTY" in assessment.breaches and s.uncertain_usd_minor > 0:
                    # Preserve occupied/uncertain consequence; contract only reusable headroom.
                    floor = s.occupied_usd_minor()
                    new_limit = min(new_limit, floor)
                    reasons.append("UNCERTAINTY")

                if "DEPENDENCY_CONCENTRATION" in assessment.breaches and s.dependency_ids:
                    # Automatic response is strictly contractive; reallocation requires governance.
                    new_limit = min(new_limit, max(s.occupied_usd_minor(), s.live_authority_usd_minor // 2))
                    reasons.append("DEPENDENCY_CONCENTRATION")

                if "MREC" in assessment.breaches:
                    new_limit = min(new_limit, max(s.occupied_usd_minor(), s.live_authority_usd_minor // 2))
                    reasons.append("MREC")

                if "PRESSURE" in assessment.breaches:
                    # Pressure never justifies expansion. Automatic controller leaves capacity unchanged.
                    reasons.append("PRESSURE_NO_AUTO_EXPANSION")

                if reasons:
                    instructions.append(ContractionInstruction(
                        domain_id=s.domain_id,
                        old_limit_usd_minor=s.live_authority_usd_minor,
                        new_limit_usd_minor=new_limit,
                        old_velocity_usd_minor_per_seq=s.authority_velocity_usd_minor_per_seq,
                        new_velocity_usd_minor_per_seq=new_velocity,
                        old_offline_horizon_seq=s.revocation_delay_seq,
                        new_offline_horizon_seq=new_offline,
                        reason="+".join(sorted(set(reasons))),
                    ))

        payload = {
            "source_metrics_digest": metrics.digest(),
            "source_envelope_digest": envelope.digest(),
            "instructions": [asdict(i) for i in instructions],
        }
        digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        plan = AdaptiveControlPlan(metrics.digest(), envelope.digest(), tuple(instructions), digest)
        if plan.total_new_limit() > plan.total_old_limit():
            raise ConstitutionalError("adaptive plan is authority expansive")
        return plan


@dataclass(frozen=True)
class StressScenario:
    scenario_id: str
    authority_multiplier_bps: int = 10_000
    demand_multiplier_bps: int = 10_000
    uncertainty_add_usd_minor: int = 0
    observation_lag_add_seq: int = 0
    velocity_multiplier_bps: int = 10_000

    def __post_init__(self):
        if min(self.authority_multiplier_bps, self.demand_multiplier_bps, self.uncertainty_add_usd_minor,
               self.observation_lag_add_seq, self.velocity_multiplier_bps) < 0:
            raise ConstitutionalError("negative stress parameter")


@dataclass(frozen=True)
class StressResult:
    scenario_id: str
    before_metrics: FieldMetrics
    stressed_metrics: FieldMetrics
    result_digest: str


class AuthorityStressEngine:
    @staticmethod
    def simulate(samples: List[AuthorityDomainSample], scenario: StressScenario, horizon_seq: int = 1) -> StressResult:
        before = AuthorityPhysicsV11.metrics(samples, horizon_seq)
        stressed: List[AuthorityDomainSample] = []
        count = max(1, len(samples))
        per_sample_uncertainty = scenario.uncertainty_add_usd_minor // count
        remainder = scenario.uncertainty_add_usd_minor % count
        for idx, s in enumerate(sorted(samples, key=lambda x: x.domain_id)):
            authority = (s.live_authority_usd_minor * scenario.authority_multiplier_bps) // 10_000
            occupied_floor = s.occupied_usd_minor()
            # A hypothetical contraction cannot erase already occupied economic consequence.
            authority = max(authority, occupied_floor)
            uncertainty = s.uncertain_usd_minor + per_sample_uncertainty + (1 if idx < remainder else 0)
            authority = max(authority, s.reserved_usd_minor + s.committed_usd_minor + uncertainty)
            stressed.append(AuthorityDomainSample(
                domain_id=s.domain_id,
                live_authority_usd_minor=authority,
                reserved_usd_minor=s.reserved_usd_minor,
                committed_usd_minor=s.committed_usd_minor,
                uncertain_usd_minor=uncertainty,
                pending_legitimate_demand_usd_minor=(s.pending_legitimate_demand_usd_minor * scenario.demand_multiplier_bps) // 10_000,
                activation_delay_seq=s.activation_delay_seq,
                revocation_delay_seq=s.revocation_delay_seq,
                authority_velocity_usd_minor_per_seq=(s.authority_velocity_usd_minor_per_seq * scenario.velocity_multiplier_bps) // 10_000,
                observation_lag_seq=s.observation_lag_seq + scenario.observation_lag_add_seq,
                dependency_ids=s.dependency_ids,
            ))
        after = AuthorityPhysicsV11.metrics(stressed, horizon_seq)
        payload = {"scenario_id": scenario.scenario_id, "before": asdict(before), "after": asdict(after)}
        digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return StressResult(scenario.scenario_id, before, after, digest)


@dataclass(frozen=True)
class PlacementDomain:
    domain_id: str
    current_limit_usd_minor: int
    occupied_usd_minor: int
    legitimate_demand_usd_minor: int
    max_limit_usd_minor: int

    def __post_init__(self):
        if min(self.current_limit_usd_minor, self.occupied_usd_minor, self.legitimate_demand_usd_minor, self.max_limit_usd_minor) < 0:
            raise ConstitutionalError("negative placement value")
        if self.occupied_usd_minor > self.current_limit_usd_minor:
            raise ConstitutionalError("occupied exceeds current limit")
        if self.current_limit_usd_minor > self.max_limit_usd_minor:
            raise ConstitutionalError("current exceeds domain maximum")


@dataclass(frozen=True)
class PlacementPlan:
    parent_capacity_usd_minor: int
    allocations: Tuple[Tuple[str, int], ...]
    requires_release_proof: Tuple[str, ...]
    plan_digest: str

    def allocation_map(self) -> Dict[str, int]:
        return dict(self.allocations)


class DynamicAuthorityPlacement:
    """Plans conservation-preserving redistribution. Does not activate it."""

    @staticmethod
    def plan(parent_capacity_usd_minor: int, domains: List[PlacementDomain]) -> PlacementPlan:
        if parent_capacity_usd_minor < 0:
            raise ConstitutionalError("negative parent capacity")
        if sum(d.occupied_usd_minor for d in domains) > parent_capacity_usd_minor:
            raise ConstitutionalError("occupied authority exceeds parent capacity")

        remaining = parent_capacity_usd_minor
        alloc: Dict[str, int] = {}
        # First preserve every occupied amount.
        for d in sorted(domains, key=lambda x: x.domain_id):
            alloc[d.domain_id] = d.occupied_usd_minor
            remaining -= d.occupied_usd_minor

        # Then satisfy legitimate demand in descending unmet-demand order, deterministic tie by id.
        ranked = sorted(domains, key=lambda d: (-d.legitimate_demand_usd_minor, d.domain_id))
        for d in ranked:
            if remaining <= 0:
                break
            target = min(d.max_limit_usd_minor, max(d.occupied_usd_minor, d.legitimate_demand_usd_minor))
            add = min(remaining, max(0, target - alloc[d.domain_id]))
            alloc[d.domain_id] += add
            remaining -= add

        # Any leftover stays with parent; never force allocation.
        release = tuple(sorted(d.domain_id for d in domains if alloc[d.domain_id] < d.current_limit_usd_minor))
        allocations = tuple(sorted(alloc.items()))
        if sum(v for _, v in allocations) > parent_capacity_usd_minor:
            raise ConstitutionalError("placement manufactured authority")
        payload = {
            "parent_capacity_usd_minor": parent_capacity_usd_minor,
            "allocations": allocations,
            "requires_release_proof": release,
        }
        digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return PlacementPlan(parent_capacity_usd_minor, allocations, release, digest)


@dataclass(frozen=True)
class NonExpansionProof:
    pre_total_limit_usd_minor: int
    post_total_limit_usd_minor: int
    pre_max_velocity_usd_minor_per_seq: int
    post_max_velocity_usd_minor_per_seq: int
    valid: bool
    proof_digest: str


class AdaptiveResponseProofs:
    @staticmethod
    def prove_non_expansion(plan: AdaptiveControlPlan) -> NonExpansionProof:
        pre_limit = sum(i.old_limit_usd_minor for i in plan.instructions)
        post_limit = sum(i.new_limit_usd_minor for i in plan.instructions)
        pre_vel = max((i.old_velocity_usd_minor_per_seq for i in plan.instructions), default=0)
        post_vel = max((i.new_velocity_usd_minor_per_seq for i in plan.instructions), default=0)
        valid = post_limit <= pre_limit and post_vel <= pre_vel
        payload = {
            "pre_total_limit_usd_minor": pre_limit,
            "post_total_limit_usd_minor": post_limit,
            "pre_max_velocity_usd_minor_per_seq": pre_vel,
            "post_max_velocity_usd_minor_per_seq": post_vel,
            "valid": valid,
            "plan_digest": plan.plan_digest,
        }
        digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return NonExpansionProof(pre_limit, post_limit, pre_vel, post_vel, valid, digest)

# --- v1.2 Autonomous Institutional Controller -----------------------------

@dataclass(frozen=True)
class HomeostasisTarget:
    """Desired operating band. Targets guide optimization; they do not grant power."""
    target_liquidity_usd_minor: int
    target_pressure_bps: int
    target_uncertainty_usd_minor: int
    target_observation_lag_seq: int
    target_dependency_concentration_bps: int
    max_horizon_mrec_usd_minor: int

    def __post_init__(self):
        if any(v < 0 for v in asdict(self).values()):
            raise ConstitutionalError("negative homeostasis target")

    def digest(self) -> str:
        return sha256(json.dumps(asdict(self), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class AuthorityAdjustment:
    domain_id: str
    new_limit_usd_minor: int
    new_velocity_usd_minor_per_seq: int
    reason: str

    def __post_init__(self):
        if self.new_limit_usd_minor < 0 or self.new_velocity_usd_minor_per_seq < 0:
            raise ConstitutionalError("negative authority adjustment")


@dataclass(frozen=True)
class PredictiveTrajectory:
    trajectory_id: str
    horizon_seq: int
    adjustments: Tuple[AuthorityAdjustment, ...]
    projected_metrics: FieldMetrics
    score: int
    constitutionally_valid: bool
    requires_governance: bool
    trajectory_digest: str


class PredictiveAuthorityController:
    """Deterministic MPC-like planner over candidate authority configurations.

    It may select a non-expansive trajectory for automatic application. Any
    trajectory that increases a live authority limit or velocity is only an
    expansion proposal and requires an external GovernanceExpansionProof.
    """

    @staticmethod
    def _apply_adjustments(samples: List[AuthorityDomainSample], adjustments: Tuple[AuthorityAdjustment, ...]) -> List[AuthorityDomainSample]:
        by_id = {a.domain_id: a for a in adjustments}
        out: List[AuthorityDomainSample] = []
        for s in sorted(samples, key=lambda x: x.domain_id):
            a = by_id.get(s.domain_id)
            if a is None:
                out.append(s)
                continue
            if a.new_limit_usd_minor < s.occupied_usd_minor():
                raise ConstitutionalError("predictive trajectory erases occupied consequence")
            out.append(AuthorityDomainSample(
                domain_id=s.domain_id,
                live_authority_usd_minor=a.new_limit_usd_minor,
                reserved_usd_minor=s.reserved_usd_minor,
                committed_usd_minor=s.committed_usd_minor,
                uncertain_usd_minor=s.uncertain_usd_minor,
                pending_legitimate_demand_usd_minor=s.pending_legitimate_demand_usd_minor,
                activation_delay_seq=s.activation_delay_seq,
                revocation_delay_seq=s.revocation_delay_seq,
                authority_velocity_usd_minor_per_seq=a.new_velocity_usd_minor_per_seq,
                observation_lag_seq=s.observation_lag_seq,
                dependency_ids=s.dependency_ids,
            ))
        unknown = set(by_id) - {s.domain_id for s in samples}
        if unknown:
            raise ConstitutionalError("trajectory references unknown authority domain")
        return out

    @staticmethod
    def _score(metrics: FieldMetrics, target: HomeostasisTarget) -> int:
        # Integer-only distance from target. Lower is better. MREC excess is
        # deliberately weighted heavily because the controller optimizes only
        # inside the constitutional safety region.
        excess_mrec = max(0, metrics.mrec_usd_minor - target.max_horizon_mrec_usd_minor)
        liquidity_gap = max(0, target.target_liquidity_usd_minor - metrics.liquid_authority_usd_minor)
        pressure_gap = abs(metrics.pressure_bps - target.target_pressure_bps)
        uncertainty_gap = abs(metrics.uncertain_usd_minor - target.target_uncertainty_usd_minor)
        lag_gap = abs(metrics.max_observation_lag_seq - target.target_observation_lag_seq)
        dep_gap = abs(metrics.dependency_concentration_bps - target.target_dependency_concentration_bps)
        return (
            excess_mrec * 100
            + liquidity_gap * 10
            + uncertainty_gap * 25
            + pressure_gap
            + lag_gap * 10_000
            + dep_gap
        )

    @classmethod
    def evaluate(cls, samples: List[AuthorityDomainSample], target: HomeostasisTarget,
                 candidates: Tuple[Tuple[str, Tuple[AuthorityAdjustment, ...]], ...],
                 horizon_seq: int) -> Tuple[PredictiveTrajectory, ...]:
        if horizon_seq < 0:
            raise ConstitutionalError("negative predictive horizon")
        original = {s.domain_id: s for s in samples}
        trajectories: List[PredictiveTrajectory] = []
        for trajectory_id, adjustments in sorted(candidates, key=lambda x: x[0]):
            projected_samples = cls._apply_adjustments(samples, adjustments)
            metrics = AuthorityPhysicsV11.metrics(projected_samples, horizon_seq)
            valid = metrics.mrec_usd_minor <= target.max_horizon_mrec_usd_minor
            requires_governance = False
            for a in adjustments:
                old = original[a.domain_id]
                if a.new_limit_usd_minor > old.live_authority_usd_minor or a.new_velocity_usd_minor_per_seq > old.authority_velocity_usd_minor_per_seq:
                    requires_governance = True
            score = cls._score(metrics, target)
            payload = {
                "trajectory_id": trajectory_id,
                "horizon_seq": horizon_seq,
                "adjustments": [asdict(a) for a in adjustments],
                "projected_metrics_digest": metrics.digest(),
                "score": score,
                "constitutionally_valid": valid,
                "requires_governance": requires_governance,
            }
            td = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            trajectories.append(PredictiveTrajectory(
                trajectory_id, horizon_seq, adjustments, metrics, score, valid,
                requires_governance, td
            ))
        return tuple(trajectories)

    @staticmethod
    def choose_automatic(trajectories: Tuple[PredictiveTrajectory, ...]) -> PredictiveTrajectory:
        eligible = [t for t in trajectories if t.constitutionally_valid and not t.requires_governance]
        if not eligible:
            raise ConstitutionalError("no constitutionally valid non-expansive trajectory")
        return min(eligible, key=lambda t: (t.score, t.trajectory_id))


@dataclass(frozen=True)
class ExpansionProposal:
    proposal_id: str
    source_state_digest: str
    adjustments: Tuple[AuthorityAdjustment, ...]
    maximum_post_total_authority_usd_minor: int
    justification_digest: str
    proposal_digest: str


@dataclass(frozen=True)
class GovernanceExpansionProof:
    proposal_digest: str
    approver_ids: Tuple[str, ...]
    required_threshold: int
    governance_epoch: int
    proof_digest: str

    def __post_init__(self):
        if self.required_threshold <= 0 or self.governance_epoch < 0:
            raise ConstitutionalError("invalid governance expansion proof")
        if len(set(self.approver_ids)) != len(self.approver_ids):
            raise ConstitutionalError("duplicate governance approver")


class GovernedExpansion:
    @staticmethod
    def propose(samples: List[AuthorityDomainSample], adjustments: Tuple[AuthorityAdjustment, ...],
                proposal_id: str, justification: str) -> ExpansionProposal:
        state = {s.domain_id: s for s in samples}
        if not adjustments:
            raise ConstitutionalError("empty expansion proposal")
        expansive = False
        total = sum(s.live_authority_usd_minor for s in samples)
        post = total
        seen = set()
        for a in adjustments:
            if a.domain_id in seen or a.domain_id not in state:
                raise ConstitutionalError("invalid expansion domain")
            seen.add(a.domain_id)
            old = state[a.domain_id]
            if a.new_limit_usd_minor < old.occupied_usd_minor():
                raise ConstitutionalError("proposal erases occupied consequence")
            post += a.new_limit_usd_minor - old.live_authority_usd_minor
            if a.new_limit_usd_minor > old.live_authority_usd_minor or a.new_velocity_usd_minor_per_seq > old.authority_velocity_usd_minor_per_seq:
                expansive = True
        if not expansive:
            raise ConstitutionalError("governed expansion proposal is not expansive")
        source = sha256(json.dumps([asdict(s) for s in sorted(samples, key=lambda x: x.domain_id)], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        jd = sha256(justification.encode()).hexdigest()
        payload = {
            "proposal_id": proposal_id,
            "source_state_digest": source,
            "adjustments": [asdict(a) for a in adjustments],
            "maximum_post_total_authority_usd_minor": post,
            "justification_digest": jd,
        }
        pd = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return ExpansionProposal(proposal_id, source, adjustments, post, jd, pd)

    @staticmethod
    def make_proof(proposal: ExpansionProposal, approver_ids: Tuple[str, ...], required_threshold: int,
                   governance_epoch: int) -> GovernanceExpansionProof:
        ids = tuple(sorted(set(approver_ids)))
        payload = {
            "proposal_digest": proposal.proposal_digest,
            "approver_ids": ids,
            "required_threshold": required_threshold,
            "governance_epoch": governance_epoch,
        }
        proof_digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return GovernanceExpansionProof(proposal.proposal_digest, ids, required_threshold, governance_epoch, proof_digest)

    @staticmethod
    def authorize(proposal: ExpansionProposal, proof: GovernanceExpansionProof,
                  current_governance_epoch: int, parent_capacity_usd_minor: int) -> bool:
        if proof.proposal_digest != proposal.proposal_digest:
            return False
        if proof.governance_epoch != current_governance_epoch:
            return False
        if len(proof.approver_ids) < proof.required_threshold:
            return False
        if proposal.maximum_post_total_authority_usd_minor > parent_capacity_usd_minor:
            return False
        return True


@dataclass(frozen=True)
class ShadowUniverse:
    universe_id: str
    scenario_id: str
    metrics: FieldMetrics
    envelope_assessment: EnvelopeAssessment
    universe_digest: str


class CounterfactualShadowEngine:
    @staticmethod
    def run(samples: List[AuthorityDomainSample], scenarios: Tuple[StressScenario, ...],
            envelope: SafetyEnvelope, horizon_seq: int) -> Tuple[ShadowUniverse, ...]:
        universes: List[ShadowUniverse] = []
        for idx, scenario in enumerate(sorted(scenarios, key=lambda x: x.scenario_id)):
            result = AuthorityStressEngine.simulate(samples, scenario, horizon_seq)
            assessment = ContinuousSafetyEnvelope.assess(result.stressed_metrics, envelope)
            uid = f"shadow-{idx:04d}-{scenario.scenario_id}"
            payload = {
                "universe_id": uid,
                "scenario_id": scenario.scenario_id,
                "metrics_digest": result.stressed_metrics.digest(),
                "assessment_digest": assessment.assessment_digest,
            }
            ud = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            universes.append(ShadowUniverse(uid, scenario.scenario_id, result.stressed_metrics, assessment, ud))
        return tuple(universes)


@dataclass(frozen=True)
class ChaosInvariantResult:
    experiment_id: str
    steps: int
    invariant_failures: Tuple[str, ...]
    maximum_observed_authority_usd_minor: int
    initial_authority_usd_minor: int
    result_digest: str

    @property
    def passed(self) -> bool:
        return not self.invariant_failures


class ConstitutionalChaosEngine:
    """Deterministic fault-sequence tester for authority non-expansion.

    Faults can contract limits, add uncertainty, increase observation lag, or
    contract velocity. The chaos engine itself has no expansion opcode.
    """
    ALLOWED_FAULTS = ("CONTRACT", "ADD_UNCERTAINTY", "ADD_LAG", "CONTRACT_VELOCITY")

    @staticmethod
    def run(samples: List[AuthorityDomainSample], faults: Tuple[Tuple[str, str, int], ...],
            experiment_id: str) -> ChaosInvariantResult:
        state = {s.domain_id: s for s in samples}
        initial = sum(s.live_authority_usd_minor for s in state.values())
        maximum = initial
        failures: List[str] = []
        for step, (fault, domain_id, value) in enumerate(faults, 1):
            if fault not in ConstitutionalChaosEngine.ALLOWED_FAULTS or value < 0 or domain_id not in state:
                failures.append(f"INVALID_FAULT:{step}")
                continue
            s = state[domain_id]
            limit = s.live_authority_usd_minor
            uncertainty = s.uncertain_usd_minor
            lag = s.observation_lag_seq
            velocity = s.authority_velocity_usd_minor_per_seq
            if fault == "CONTRACT":
                limit = max(s.occupied_usd_minor(), min(limit, value))
            elif fault == "ADD_UNCERTAINTY":
                uncertainty += value
                limit = max(limit, s.reserved_usd_minor + s.committed_usd_minor + uncertainty)
            elif fault == "ADD_LAG":
                lag += value
            elif fault == "CONTRACT_VELOCITY":
                velocity = min(velocity, value)
            state[domain_id] = AuthorityDomainSample(
                domain_id=s.domain_id,
                live_authority_usd_minor=limit,
                reserved_usd_minor=s.reserved_usd_minor,
                committed_usd_minor=s.committed_usd_minor,
                uncertain_usd_minor=uncertainty,
                pending_legitimate_demand_usd_minor=s.pending_legitimate_demand_usd_minor,
                activation_delay_seq=s.activation_delay_seq,
                revocation_delay_seq=s.revocation_delay_seq,
                authority_velocity_usd_minor_per_seq=velocity,
                observation_lag_seq=lag,
                dependency_ids=s.dependency_ids,
            )
            current = sum(x.live_authority_usd_minor for x in state.values())
            maximum = max(maximum, current)
            # Adding uncertainty can raise the accounting floor only when new
            # possible obligation is injected. That is not reusable authority.
            reusable = sum(x.liquid_usd_minor() for x in state.values())
            initial_reusable = sum(x.liquid_usd_minor() for x in samples)
            if reusable > initial_reusable:
                failures.append(f"REUSABLE_AUTHORITY_EXPANDED:{step}")
        payload = {
            "experiment_id": experiment_id,
            "steps": len(faults),
            "failures": tuple(failures),
            "maximum_observed_authority_usd_minor": maximum,
            "initial_authority_usd_minor": initial,
        }
        rd = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return ChaosInvariantResult(experiment_id, len(faults), tuple(failures), maximum, initial, rd)


# ---- v1.3 Institutional Compiler -------------------------------------------------

class InstitutionBuildClass(str, Enum):
    CONTRACTIVE = "CONTRACTIVE"
    BEHAVIOR_PRESERVING = "BEHAVIOR_PRESERVING"
    AUTHORITY_EXPANSIVE = "AUTHORITY_EXPANSIVE"
    RIGHTS_EXPANSIVE = "RIGHTS_EXPANSIVE"
    SYSTEMIC = "SYSTEMIC"


class InstitutionLifecycle(str, Enum):
    PROPOSED = "PROPOSED"
    ACTIVE = "ACTIVE"
    WIND_DOWN = "WIND_DOWN"
    OBLIGATION_ONLY = "OBLIGATION_ONLY"
    RECONCILIATION_ONLY = "RECONCILIATION_ONLY"
    DISSOLVED = "DISSOLVED"


@dataclass(frozen=True)
class InstitutionalRight:
    right_id: str
    principal_id: str
    right_class: str
    capacity_usd_minor: int
    source_right_ids: Tuple[str, ...] = ()
    creation_rule_id: str = "ROOT"
    transferable: bool = False

    def __post_init__(self):
        if not self.right_id or not self.principal_id or not self.right_class:
            raise ConstitutionalError("right identity fields are required")
        if self.capacity_usd_minor < 0:
            raise ConstitutionalError("right capacity must be non-negative")
        if len(set(self.source_right_ids)) != len(self.source_right_ids):
            raise ConstitutionalError("duplicate source right")


@dataclass(frozen=True)
class InstitutionalAuthorityDomain:
    domain_id: str
    principal_id: str
    right_id: str
    active_authority_usd_minor: int
    occupied_usd_minor: int = 0
    uncertain_usd_minor: int = 0
    maximum_reachable_consequence_usd_minor: int = 0
    delegation_depth: int = 0

    def __post_init__(self):
        for name in ("active_authority_usd_minor", "occupied_usd_minor", "uncertain_usd_minor",
                     "maximum_reachable_consequence_usd_minor", "delegation_depth"):
            if getattr(self, name) < 0:
                raise ConstitutionalError(f"{name} must be non-negative")
        if self.occupied_usd_minor + self.uncertain_usd_minor > self.active_authority_usd_minor:
            raise ConstitutionalError("occupied + uncertain exceeds active authority")


@dataclass(frozen=True)
class InstitutionalObligation:
    obligation_id: str
    debtor_principal_id: str
    creditor_principal_id: str
    amount_usd_minor: int
    state: str = "OPEN"

    def __post_init__(self):
        if self.amount_usd_minor < 0:
            raise ConstitutionalError("obligation amount must be non-negative")
        if self.state not in ("OPEN", "DISPUTED", "FINAL", "SATISFIED"):
            raise ConstitutionalError("unsupported obligation state")


@dataclass(frozen=True)
class InstitutionalRecognitionEdge:
    source_domain: str
    target_domain: str
    max_recognized_usd_minor: int
    transitive: bool = False

    def __post_init__(self):
        if self.max_recognized_usd_minor < 0:
            raise ConstitutionalError("recognition bound must be non-negative")


@dataclass(frozen=True)
class InstitutionalRecoveryPath:
    path_id: str
    affected_domain_ids: Tuple[str, ...]
    preserves_obligations: bool = True
    may_expand_risk_authority: bool = False


@dataclass(frozen=True)
class InstitutionIR:
    institution_id: str
    constitution_digest: str
    semantics_digest: str
    principals: Tuple[str, ...]
    rights: Tuple[InstitutionalRight, ...]
    authority_domains: Tuple[InstitutionalAuthorityDomain, ...]
    obligations: Tuple[InstitutionalObligation, ...] = ()
    recognition_edges: Tuple[InstitutionalRecognitionEdge, ...] = ()
    recovery_paths: Tuple[InstitutionalRecoveryPath, ...] = ()
    child_build_digests: Tuple[str, ...] = ()

    def __post_init__(self):
        if not self.institution_id or not self.constitution_digest or not self.semantics_digest:
            raise ConstitutionalError("institution identity/semantic fields required")
        if len(set(self.principals)) != len(self.principals):
            raise ConstitutionalError("duplicate principal")
        for attr, vals, key in (
            ("right", self.rights, lambda x: x.right_id),
            ("authority domain", self.authority_domains, lambda x: x.domain_id),
            ("obligation", self.obligations, lambda x: x.obligation_id),
            ("recovery path", self.recovery_paths, lambda x: x.path_id),
        ):
            ids=[key(x) for x in vals]
            if len(ids) != len(set(ids)):
                raise ConstitutionalError(f"duplicate {attr}")

    @property
    def ir_digest(self) -> str:
        payload={
            "institution_id":self.institution_id,
            "constitution_digest":self.constitution_digest,
            "semantics_digest":self.semantics_digest,
            "principals":tuple(sorted(self.principals)),
            "rights":tuple(sorted((asdict(x) for x in self.rights), key=lambda x:x["right_id"])),
            "authority_domains":tuple(sorted((asdict(x) for x in self.authority_domains), key=lambda x:x["domain_id"])),
            "obligations":tuple(sorted((asdict(x) for x in self.obligations), key=lambda x:x["obligation_id"])),
            "recognition_edges":tuple(sorted((asdict(x) for x in self.recognition_edges), key=lambda x:(x["source_domain"],x["target_domain"]))),
            "recovery_paths":tuple(sorted((asdict(x) for x in self.recovery_paths), key=lambda x:x["path_id"])),
            "child_build_digests":tuple(sorted(self.child_build_digests)),
        }
        return sha256(json.dumps(payload,sort_keys=True,separators=(",",":"),default=list).encode()).hexdigest()


@dataclass(frozen=True)
class InstitutionViability:
    rights_valid: bool
    authority_conserved: bool
    obligations_preserved: bool
    recovery_reachable: bool
    recognition_bounded: bool
    uncertainty_bounded: bool
    violations: Tuple[str, ...]

    @property
    def viable(self) -> bool:
        return all((self.rights_valid, self.authority_conserved, self.obligations_preserved,
                    self.recovery_reachable, self.recognition_bounded, self.uncertainty_bounded))


@dataclass(frozen=True)
class InstitutionBuild:
    institution_id: str
    ir_digest: str
    constitution_digest: str
    rights_root: str
    authority_root: str
    obligation_root: str
    recognition_root: str
    recovery_root: str
    reachable_state_root: str
    total_rights_capacity_usd_minor: int
    total_active_authority_usd_minor: int
    total_obligations_usd_minor: int
    total_uncertainty_usd_minor: int
    mrec_usd_minor: int
    viability: InstitutionViability

    @property
    def build_digest(self) -> str:
        return sha256(json.dumps(asdict(self),sort_keys=True,separators=(",",":")).encode()).hexdigest()


@dataclass(frozen=True)
class InstitutionDiff:
    old_build_digest: str
    new_build_digest: str
    build_class: InstitutionBuildClass
    rights_capacity_delta_usd_minor: int
    active_authority_delta_usd_minor: int
    obligations_delta_usd_minor: int
    uncertainty_delta_usd_minor: int
    mrec_delta_usd_minor: int
    new_right_ids: Tuple[str, ...]
    removed_right_ids: Tuple[str, ...]
    new_domain_ids: Tuple[str, ...]
    removed_domain_ids: Tuple[str, ...]

    @property
    def diff_digest(self) -> str:
        return sha256(json.dumps(asdict(self),sort_keys=True,separators=(",",":")).encode()).hexdigest()


@dataclass(frozen=True)
class InstitutionLaunchProof:
    institution_build_digest: str
    governance_epoch: int
    approver_ids: Tuple[str, ...]
    required_threshold: int
    proof_digest: str


@dataclass(frozen=True)
class InstitutionInstance:
    build: InstitutionBuild
    lifecycle: InstitutionLifecycle
    activation_sequence: int
    latest_sequence: int


class InstitutionalCompiler:
    """Deterministic compiler from institutional IR to verifiable authority state.

    The compiler may describe rights and authority but does not create external legal
    rights or external recognition. It validates the declared institution under the
    supplied constitutional semantics.
    """

    @staticmethod
    def _root(items) -> str:
        raw=json.dumps(items,sort_keys=True,separators=(",",":"),default=list).encode()
        return sha256(raw).hexdigest()

    @staticmethod
    def _validate(ir: InstitutionIR) -> InstitutionViability:
        violations=[]
        principals=set(ir.principals)
        rights={r.right_id:r for r in ir.rights}
        domains={d.domain_id:d for d in ir.authority_domains}

        for r in ir.rights:
            if r.principal_id not in principals:
                violations.append(f"RIGHT_UNKNOWN_PRINCIPAL:{r.right_id}")
            for src in r.source_right_ids:
                if src not in rights:
                    violations.append(f"MISSING_SOURCE_RIGHT:{r.right_id}:{src}")
                elif rights[src].capacity_usd_minor < r.capacity_usd_minor:
                    violations.append(f"RIGHT_DERIVATION_EXPANDS:{r.right_id}")
        # Detect cycles in right lineage.
        def has_cycle(rid, stack, seen):
            if rid in stack: return True
            if rid in seen: return False
            seen.add(rid); stack.add(rid)
            for src in rights.get(rid, InstitutionalRight("_","_","_",0)).source_right_ids:
                if src in rights and has_cycle(src,stack,seen): return True
            stack.remove(rid)
            return False
        seen=set()
        for rid in rights:
            if has_cycle(rid,set(),seen):
                violations.append(f"RIGHT_LINEAGE_CYCLE:{rid}")
                break

        by_right={rid:0 for rid in rights}
        uncertainty=0
        for d in ir.authority_domains:
            if d.principal_id not in principals:
                violations.append(f"DOMAIN_UNKNOWN_PRINCIPAL:{d.domain_id}")
            if d.right_id not in rights:
                violations.append(f"DOMAIN_MISSING_RIGHT:{d.domain_id}")
            else:
                by_right[d.right_id]+=d.active_authority_usd_minor
            uncertainty+=d.uncertain_usd_minor
        for rid,total in by_right.items():
            if total > rights[rid].capacity_usd_minor:
                violations.append(f"AUTHORITY_EXCEEDS_RIGHT:{rid}")

        obligations_preserved=True
        for o in ir.obligations:
            if o.debtor_principal_id not in principals or o.creditor_principal_id not in principals:
                violations.append(f"OBLIGATION_UNKNOWN_PRINCIPAL:{o.obligation_id}")
                obligations_preserved=False

        recognition_bounded=True
        for e in ir.recognition_edges:
            if e.source_domain not in domains or e.target_domain not in domains:
                violations.append(f"RECOGNITION_UNKNOWN_DOMAIN:{e.source_domain}:{e.target_domain}")
                recognition_bounded=False
            elif e.max_recognized_usd_minor > domains[e.source_domain].active_authority_usd_minor:
                violations.append(f"RECOGNITION_EXPANDS_SOURCE:{e.source_domain}:{e.target_domain}")
                recognition_bounded=False

        recovery_reachable=True
        if ir.authority_domains:
            covered=set()
            for p in ir.recovery_paths:
                if p.may_expand_risk_authority:
                    violations.append(f"RECOVERY_MAY_EXPAND:{p.path_id}")
                    recovery_reachable=False
                if not p.preserves_obligations:
                    violations.append(f"RECOVERY_DROPS_OBLIGATIONS:{p.path_id}")
                    recovery_reachable=False
                covered.update(p.affected_domain_ids)
            uncovered=set(domains)-covered
            if uncovered:
                violations.append("RECOVERY_UNCOVERED:"+",".join(sorted(uncovered)))
                recovery_reachable=False

        rights_valid=not any(v.startswith(("RIGHT_","MISSING_SOURCE_RIGHT")) for v in violations)
        authority_conserved=not any(v.startswith(("AUTHORITY_","DOMAIN_MISSING_RIGHT")) for v in violations)
        uncertainty_bounded=all(d.uncertain_usd_minor <= d.active_authority_usd_minor for d in ir.authority_domains)
        return InstitutionViability(rights_valid,authority_conserved,obligations_preserved,
                                    recovery_reachable,recognition_bounded,uncertainty_bounded,
                                    tuple(sorted(set(violations))))

    @staticmethod
    def compile(ir: InstitutionIR) -> InstitutionBuild:
        viability=InstitutionalCompiler._validate(ir)
        rights_sorted=tuple(sorted((asdict(x) for x in ir.rights),key=lambda x:x["right_id"]))
        domains_sorted=tuple(sorted((asdict(x) for x in ir.authority_domains),key=lambda x:x["domain_id"]))
        obligations_sorted=tuple(sorted((asdict(x) for x in ir.obligations),key=lambda x:x["obligation_id"]))
        recognition_sorted=tuple(sorted((asdict(x) for x in ir.recognition_edges),key=lambda x:(x["source_domain"],x["target_domain"])))
        recovery_sorted=tuple(sorted((asdict(x) for x in ir.recovery_paths),key=lambda x:x["path_id"]))
        total_rights=sum(r.capacity_usd_minor for r in ir.rights if not r.source_right_ids)
        total_active=sum(d.active_authority_usd_minor for d in ir.authority_domains)
        total_obligations=sum(o.amount_usd_minor for o in ir.obligations if o.state not in ("SATISFIED",))
        total_uncertainty=sum(d.uncertain_usd_minor for d in ir.authority_domains)
        # Conservative institution MREC: maximum declared reachable consequence by domain,
        # plus open obligations; avoids inventing cross-domain netting.
        mrec=sum(d.maximum_reachable_consequence_usd_minor or d.active_authority_usd_minor for d in ir.authority_domains) + total_obligations
        reachable_payload={
            "domains":domains_sorted,
            "recognition":recognition_sorted,
            "obligations":obligations_sorted,
            "children":tuple(sorted(ir.child_build_digests)),
            "mrec":mrec,
        }
        return InstitutionBuild(
            ir.institution_id, ir.ir_digest, ir.constitution_digest,
            InstitutionalCompiler._root(rights_sorted),
            InstitutionalCompiler._root(domains_sorted),
            InstitutionalCompiler._root(obligations_sorted),
            InstitutionalCompiler._root(recognition_sorted),
            InstitutionalCompiler._root(recovery_sorted),
            InstitutionalCompiler._root(reachable_payload),
            total_rights,total_active,total_obligations,total_uncertainty,mrec,viability
        )

    @staticmethod
    def diff(old_ir: InstitutionIR, new_ir: InstitutionIR) -> InstitutionDiff:
        old=InstitutionalCompiler.compile(old_ir); new=InstitutionalCompiler.compile(new_ir)
        old_rights={x.right_id for x in old_ir.rights}; new_rights={x.right_id for x in new_ir.rights}
        old_domains={x.domain_id for x in old_ir.authority_domains}; new_domains={x.domain_id for x in new_ir.authority_domains}
        rights_delta=new.total_rights_capacity_usd_minor-old.total_rights_capacity_usd_minor
        auth_delta=new.total_active_authority_usd_minor-old.total_active_authority_usd_minor
        obligation_delta=new.total_obligations_usd_minor-old.total_obligations_usd_minor
        uncertainty_delta=new.total_uncertainty_usd_minor-old.total_uncertainty_usd_minor
        mrec_delta=new.mrec_usd_minor-old.mrec_usd_minor
        if rights_delta>0 or (new_rights-old_rights): cls=InstitutionBuildClass.RIGHTS_EXPANSIVE
        elif auth_delta>0: cls=InstitutionBuildClass.AUTHORITY_EXPANSIVE
        elif mrec_delta>0 or len(new_ir.recognition_edges)>len(old_ir.recognition_edges): cls=InstitutionBuildClass.SYSTEMIC
        elif any(x<0 for x in (auth_delta,mrec_delta)) and all(x<=0 for x in (auth_delta,mrec_delta)): cls=InstitutionBuildClass.CONTRACTIVE
        else: cls=InstitutionBuildClass.BEHAVIOR_PRESERVING
        return InstitutionDiff(old.build_digest,new.build_digest,cls,rights_delta,auth_delta,
                               obligation_delta,uncertainty_delta,mrec_delta,
                               tuple(sorted(new_rights-old_rights)),tuple(sorted(old_rights-new_rights)),
                               tuple(sorted(new_domains-old_domains)),tuple(sorted(old_domains-new_domains)))

    @staticmethod
    def make_launch_proof(build: InstitutionBuild, governance_epoch: int, approver_ids: Tuple[str,...], required_threshold: int) -> InstitutionLaunchProof:
        ids=tuple(sorted(set(approver_ids)))
        if governance_epoch < 0 or required_threshold < 1:
            raise ConstitutionalError("invalid launch governance parameters")
        payload={"build":build.build_digest,"epoch":governance_epoch,"approvers":ids,"threshold":required_threshold}
        pd=sha256(json.dumps(payload,sort_keys=True,separators=(",",":")).encode()).hexdigest()
        return InstitutionLaunchProof(build.build_digest,governance_epoch,ids,required_threshold,pd)

    @staticmethod
    def launch(build: InstitutionBuild, proof: InstitutionLaunchProof, expected_governance_epoch: int, activation_sequence: int) -> InstitutionInstance:
        if not build.viability.viable:
            raise ConstitutionalError("institution build is not viable")
        if proof.institution_build_digest != build.build_digest:
            raise ConstitutionalError("launch proof build mismatch")
        if proof.governance_epoch != expected_governance_epoch:
            raise ConstitutionalError("stale governance epoch")
        if len(proof.approver_ids) < proof.required_threshold:
            raise ConstitutionalError("launch approval threshold unmet")
        return InstitutionInstance(build,InstitutionLifecycle.ACTIVE,activation_sequence,activation_sequence)

    @staticmethod
    def transition_lifecycle(instance: InstitutionInstance, target: InstitutionLifecycle, sequence: int) -> InstitutionInstance:
        allowed={
            InstitutionLifecycle.ACTIVE:{InstitutionLifecycle.WIND_DOWN},
            InstitutionLifecycle.WIND_DOWN:{InstitutionLifecycle.OBLIGATION_ONLY},
            InstitutionLifecycle.OBLIGATION_ONLY:{InstitutionLifecycle.RECONCILIATION_ONLY},
            InstitutionLifecycle.RECONCILIATION_ONLY:{InstitutionLifecycle.DISSOLVED},
            InstitutionLifecycle.PROPOSED:{InstitutionLifecycle.ACTIVE},
            InstitutionLifecycle.DISSOLVED:set(),
        }
        if target not in allowed[instance.lifecycle]:
            raise ConstitutionalError("invalid institutional lifecycle transition")
        if sequence <= instance.latest_sequence:
            raise ConstitutionalError("institution sequence must advance")
        if target == InstitutionLifecycle.DISSOLVED and instance.build.total_obligations_usd_minor > 0:
            raise ConstitutionalError("cannot dissolve while obligations remain")
        return InstitutionInstance(instance.build,target,instance.activation_sequence,sequence)
