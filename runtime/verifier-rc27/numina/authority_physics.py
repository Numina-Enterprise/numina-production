from __future__ import annotations

from dataclasses import dataclass, asdict
from itertools import combinations
from typing import FrozenSet, Iterable, Sequence

from .canonical import digest

BPS = 10_000


@dataclass(frozen=True)
class AuthorityFieldEdge:
    """A bounded path through which economic consequence can become reachable.

    `velocity_usd_minor_per_sequence == 0` means the full edge capacity may be
    mobilized once the activation delay has elapsed. No field in this module
    creates authority; all values are projections over already-recognized
    authority/capacity.
    """

    edge_id: str
    source: str
    target: str
    capacity_usd_minor: int
    activation_delay_sequences: int = 0
    velocity_usd_minor_per_sequence: int = 0
    risk_adding: bool = True
    dependencies: FrozenSet[str] = frozenset()

    def __post_init__(self):
        for name in (
            "capacity_usd_minor",
            "activation_delay_sequences",
            "velocity_usd_minor_per_sequence",
        ):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} must be non-negative")

    def mobilizable(self, horizon_sequences: int) -> int:
        if horizon_sequences < 0:
            raise ValueError("horizon_sequences must be non-negative")
        if horizon_sequences < self.activation_delay_sequences:
            return 0
        available_window = horizon_sequences - self.activation_delay_sequences + 1
        if self.velocity_usd_minor_per_sequence == 0:
            return self.capacity_usd_minor
        return min(
            self.capacity_usd_minor,
            self.velocity_usd_minor_per_sequence * available_window,
        )


@dataclass(frozen=True)
class ReachabilityResult:
    horizon_sequences: int
    start: str
    max_by_node: tuple[tuple[str, int], ...]
    mrec_usd_minor: int
    path: tuple[str, ...]

    @property
    def state_digest(self) -> str:
        return digest(asdict(self))


@dataclass(frozen=True)
class AuthorityLiquidityBucket:
    bucket_id: str
    amount_usd_minor: int
    mobilizable_after_sequences: int

    def __post_init__(self):
        if self.amount_usd_minor < 0 or self.mobilizable_after_sequences < 0:
            raise ValueError("liquidity bucket values must be non-negative")


@dataclass(frozen=True)
class AuthorityPhysicsMetrics:
    horizon_sequences: int
    mrec_usd_minor: int
    authority_liquidity_usd_minor: int
    entropy_index: int
    max_dependency_concentration_bps: int
    max_authority_gradient_bps: int
    compromise_min_cut_size: int
    risk_adding_edge_count: int
    total_edge_count: int

    @property
    def metrics_digest(self) -> str:
        return digest(asdict(self))


@dataclass(frozen=True)
class SafetyEnvelope:
    max_mrec_usd_minor: int
    min_authority_liquidity_usd_minor: int = 0
    max_entropy_index: int = 2**63 - 1
    max_dependency_concentration_bps: int = BPS
    max_authority_gradient_bps: int = BPS
    min_compromise_cut_size: int = 0

    def __post_init__(self):
        if self.max_mrec_usd_minor < 0 or self.min_authority_liquidity_usd_minor < 0:
            raise ValueError("envelope monetary values must be non-negative")
        if not 0 <= self.max_dependency_concentration_bps <= BPS:
            raise ValueError("dependency concentration must be basis points")
        if not 0 <= self.max_authority_gradient_bps <= BPS:
            raise ValueError("authority gradient must be basis points")
        if self.min_compromise_cut_size < 0:
            raise ValueError("min compromise cut must be non-negative")


@dataclass(frozen=True)
class SafetyEnvelopeProof:
    envelope_digest: str
    metrics_digest: str
    valid: bool
    violations: tuple[str, ...]

    @property
    def proof_digest(self) -> str:
        return digest(asdict(self))


def authority_liquidity(
    buckets: Iterable[AuthorityLiquidityBucket], horizon_sequences: int
) -> int:
    if horizon_sequences < 0:
        raise ValueError("horizon_sequences must be non-negative")
    return sum(
        b.amount_usd_minor
        for b in buckets
        if b.mobilizable_after_sequences <= horizon_sequences
    )


def structural_entropy_index(edges: Sequence[AuthorityFieldEdge]) -> int:
    """Deterministic integer structural-complexity index, not Shannon entropy.

    Higher branching, dependency fan-out, and cross-domain edges increase the
    score. It is intentionally unitless and comparison-oriented.
    """
    out_degree: dict[str, int] = {}
    dependency_count = 0
    cross_edges = 0
    for e in edges:
        out_degree[e.source] = out_degree.get(e.source, 0) + 1
        dependency_count += len(e.dependencies)
        if e.source != e.target:
            cross_edges += 1
    branching_excess = sum(max(0, n - 1) for n in out_degree.values())
    return len(edges) * 100 + branching_excess * 250 + dependency_count * 50 + cross_edges * 25


def dependency_concentration_bps(edges: Sequence[AuthorityFieldEdge]) -> dict[str, int]:
    total = sum(e.capacity_usd_minor for e in edges if e.risk_adding)
    if total <= 0:
        return {}
    by_dep: dict[str, int] = {}
    for e in edges:
        if not e.risk_adding:
            continue
        for dep in e.dependencies:
            by_dep[dep] = by_dep.get(dep, 0) + e.capacity_usd_minor
    return {k: min(BPS, (v * BPS) // total) for k, v in sorted(by_dep.items())}


def authority_gradient_bps(edges: Sequence[AuthorityFieldEdge]) -> int:
    """Largest relative capacity discontinuity among parallel economic paths."""
    groups: dict[tuple[str, str], list[int]] = {}
    for e in edges:
        groups.setdefault((e.source, e.target), []).append(e.capacity_usd_minor)
    worst = 0
    for vals in groups.values():
        if len(vals) < 2:
            continue
        hi, lo = max(vals), min(vals)
        if hi > 0:
            worst = max(worst, ((hi - lo) * BPS) // hi)
    return worst


class AuthorityPhysicsRuntime:
    def __init__(self, edges: Iterable[AuthorityFieldEdge]):
        self.edges = tuple(edges)
        ids = [e.edge_id for e in self.edges]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate authority field edge_id")

    def _adj(self, risk_adding_only: bool = True) -> dict[str, tuple[AuthorityFieldEdge, ...]]:
        out: dict[str, list[AuthorityFieldEdge]] = {}
        for e in self.edges:
            if risk_adding_only and not e.risk_adding:
                continue
            out.setdefault(e.source, []).append(e)
        return {k: tuple(sorted(v, key=lambda x: x.edge_id)) for k, v in out.items()}

    def horizon_reachability(
        self,
        start: str,
        horizon_sequences: int,
        *,
        max_depth: int = 12,
        risk_adding_only: bool = True,
    ) -> ReachabilityResult:
        if horizon_sequences < 0 or max_depth < 0:
            raise ValueError("horizon and max_depth must be non-negative")
        adj = self._adj(risk_adding_only)
        best: dict[str, int] = {start: 0}
        best_path: tuple[str, ...] = (start,)
        best_value = 0

        # Simple-path traversal prevents cycles from manufacturing apparent MREC.
        stack: list[tuple[str, int, tuple[str, ...], int]] = [(start, 0, (start,), 0)]
        while stack:
            node, value, path, depth = stack.pop()
            if depth >= max_depth:
                continue
            for e in adj.get(node, ()):
                if e.target in path:
                    continue
                amount = e.mobilizable(horizon_sequences)
                if amount <= 0:
                    continue
                new_value = value + amount
                new_path = path + (e.target,)
                if new_value > best.get(e.target, -1):
                    best[e.target] = new_value
                if new_value > best_value or (new_value == best_value and new_path < best_path):
                    best_value = new_value
                    best_path = new_path
                stack.append((e.target, new_value, new_path, depth + 1))

        return ReachabilityResult(
            horizon_sequences=horizon_sequences,
            start=start,
            max_by_node=tuple(sorted(best.items())),
            mrec_usd_minor=best_value,
            path=best_path,
        )

    def compromise_min_cut_size(self, start: str, protected: str, *, max_cut: int = 6) -> int:
        """Exact small-graph edge min-cut by deterministic enumeration.

        Returns 0 when protected is unreachable. Raises when no cut <= max_cut is
        found; production implementations should use a scalable graph algorithm.
        """
        if protected == start:
            return 0
        if protected not in {n for n, _ in self.horizon_reachability(start, 2**31 - 1).max_by_node}:
            return 0
        edges = tuple(e for e in self.edges if e.risk_adding)
        for k in range(1, min(max_cut, len(edges)) + 1):
            for removed in combinations(range(len(edges)), k):
                removed_set = set(removed)
                rt = AuthorityPhysicsRuntime(e for i, e in enumerate(edges) if i not in removed_set)
                nodes = {n for n, _ in rt.horizon_reachability(start, 2**31 - 1).max_by_node}
                if protected not in nodes:
                    return k
        raise ValueError("min cut exceeds configured reference-analysis bound")

    def metrics(
        self,
        start: str,
        protected: str,
        horizon_sequences: int,
        liquidity_buckets: Iterable[AuthorityLiquidityBucket] = (),
    ) -> AuthorityPhysicsMetrics:
        reach = self.horizon_reachability(start, horizon_sequences)
        dep = dependency_concentration_bps(self.edges)
        try:
            cut = self.compromise_min_cut_size(start, protected)
        except ValueError:
            cut = 7  # strictly greater than default exact-analysis ceiling
        return AuthorityPhysicsMetrics(
            horizon_sequences=horizon_sequences,
            mrec_usd_minor=reach.mrec_usd_minor,
            authority_liquidity_usd_minor=authority_liquidity(liquidity_buckets, horizon_sequences),
            entropy_index=structural_entropy_index(self.edges),
            max_dependency_concentration_bps=max(dep.values(), default=0),
            max_authority_gradient_bps=authority_gradient_bps(self.edges),
            compromise_min_cut_size=cut,
            risk_adding_edge_count=sum(1 for e in self.edges if e.risk_adding),
            total_edge_count=len(self.edges),
        )


def prove_safety_envelope(
    metrics: AuthorityPhysicsMetrics, envelope: SafetyEnvelope
) -> SafetyEnvelopeProof:
    violations: list[str] = []
    if metrics.mrec_usd_minor > envelope.max_mrec_usd_minor:
        violations.append("MREC_EXCEEDED")
    if metrics.authority_liquidity_usd_minor < envelope.min_authority_liquidity_usd_minor:
        violations.append("AUTHORITY_LIQUIDITY_BELOW_MINIMUM")
    if metrics.entropy_index > envelope.max_entropy_index:
        violations.append("AUTHORITY_ENTROPY_EXCEEDED")
    if metrics.max_dependency_concentration_bps > envelope.max_dependency_concentration_bps:
        violations.append("DEPENDENCY_CONCENTRATION_EXCEEDED")
    if metrics.max_authority_gradient_bps > envelope.max_authority_gradient_bps:
        violations.append("AUTHORITY_GRADIENT_EXCEEDED")
    if metrics.compromise_min_cut_size < envelope.min_compromise_cut_size:
        violations.append("COMPROMISE_MIN_CUT_TOO_SMALL")
    return SafetyEnvelopeProof(
        envelope_digest=digest(asdict(envelope)),
        metrics_digest=metrics.metrics_digest,
        valid=not violations,
        violations=tuple(violations),
    )
