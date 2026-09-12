from __future__ import annotations

from dataclasses import dataclass, asdict, replace
from enum import Enum
from hashlib import sha256
import json
from typing import Dict, Iterable, Tuple

from .rights_runtime import RightsRuntime, RightsError, RightLifecycle, RightRecognitionState


def _digest(v) -> str:
    return sha256(json.dumps(v, sort_keys=True, separators=(",", ":"), default=list).encode()).hexdigest()


class InstitutionNetworkError(RightsError):
    pass


class InsolvencyState(str, Enum):
    SOLVENT = "SOLVENT"
    OVER_COMMITTED = "OVER_COMMITTED"
    INSOLVENT = "INSOLVENT"


@dataclass(frozen=True)
class RightPropagationEdge:
    source_domain: str
    destination_domain: str
    right_class: str
    max_capacity: int
    transitive: bool = False

    def __post_init__(self):
        if not self.source_domain or not self.destination_domain or not self.right_class or self.max_capacity < 0:
            raise InstitutionNetworkError("invalid propagation edge")


@dataclass(frozen=True)
class RightPropagationProof:
    right_id: str
    origin_domain: str
    destination_domain: str
    route: Tuple[str, ...]
    intrinsic_capacity: int
    recognized_capacity: int
    effective_capacity: int
    recognition_root: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class RecognitionSurface:
    right_id: str
    domains: Tuple[str, ...]
    total_recognized_capacity: int
    max_single_domain_capacity: int


@dataclass(frozen=True)
class PriorityClaim:
    claim_id: str
    creditor_principal_id: str
    amount: int
    priority: int

    def __post_init__(self):
        if not self.claim_id or not self.creditor_principal_id or self.amount < 0 or self.priority < 0:
            raise InstitutionNetworkError("invalid priority claim")



@dataclass(frozen=True)
class WaterfallAllocation:
    claim_id: str
    allocated: int
    deficiency: int
    priority: int


@dataclass(frozen=True)
class InsolvencyAssessment:
    state: InsolvencyState
    available_capacity: int
    open_obligations: int
    deficiency: int
    waterfall: Tuple[WaterfallAllocation, ...]


@dataclass(frozen=True)
class ContractNetworkEdge:
    obligation_id: str
    debtor_domain: str
    creditor_domain: str
    amount: int
    state: str = "OPEN"

    def __post_init__(self):
        if not self.obligation_id or not self.debtor_domain or not self.creditor_domain or self.amount < 0:
            raise InstitutionNetworkError("invalid contract edge")


@dataclass(frozen=True)
class ContractNetworkReachability:
    origin_domain: str
    reachable_domains: Tuple[str, ...]
    gross_open_obligation: int
    max_path_consequence: int
    path_count: int


@dataclass(frozen=True)
class SettlementProof:
    obligation_id: str
    debtor_domain: str
    creditor_domain: str
    amount: int
    settlement_ref: str
    settlement_sequence: int
    prior_obligation_state: str
    resulting_obligation_state: str = "SATISFIED"

    def __post_init__(self):
        if not self.settlement_ref or self.amount < 0 or self.settlement_sequence < 0:
            raise InstitutionNetworkError("invalid settlement proof")

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class AuthoritySynthesis:
    right_id: str
    recognition_domain: str
    intrinsic_available: int
    recognized_capacity: int
    synthesized_ceiling: int
    source_digest: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))

class InstitutionalRightsNetwork:
    """Cross-institution rights/obligation synthesis layer.

    This module derives propagation, priority, solvency, settlement, and bounded
    authority ceilings from existing constitutional state. It never mints rights.
    """

    def __init__(self, runtime: RightsRuntime):
        self.runtime = runtime
        self.propagation_edges: list[RightPropagationEdge] = []
        self.contract_edges: Dict[str, ContractNetworkEdge] = {}
        self.applied_settlement_proofs: Dict[str, str] = {}

    def add_propagation_edge(self, edge: RightPropagationEdge):
        if edge in self.propagation_edges:
            raise InstitutionNetworkError("duplicate propagation edge")
        self.propagation_edges.append(edge)

    def recognition_surface(self, right_id: str) -> RecognitionSurface:
        right = self.runtime.rights.get(right_id)
        if right is None:
            raise InstitutionNetworkError("right missing")
        recs = [r for (rid, _), r in self.runtime.recognitions.items()
                if rid == right_id and r.state == RightRecognitionState.RECOGNIZED]
        domains = tuple(sorted(r.recognizer_domain for r in recs))
        vals = [r.recognized_capacity for r in recs]
        return RecognitionSurface(right_id, domains, sum(vals), max(vals, default=0))

    def propagation_proof(self, right_id: str, destination_domain: str) -> RightPropagationProof:
        right = self.runtime.rights.get(right_id)
        if right is None or right.lifecycle != RightLifecycle.ACTIVE:
            raise InstitutionNetworkError("active right missing")

        direct = self.runtime.recognitions.get((right_id, destination_domain))
        if direct and direct.state == RightRecognitionState.RECOGNIZED:
            eff = min(right.available, direct.recognized_capacity)
            root = _digest((right_id, destination_domain, direct.recognized_capacity, direct.sequence))
            return RightPropagationProof(right_id, right.origin_domain, destination_domain,
                                         (right.origin_domain, destination_domain), right.capacity,
                                         direct.recognized_capacity, eff, root)

        adj: Dict[str, list[RightPropagationEdge]] = {}
        for e in self.propagation_edges:
            if e.right_class == right.right_class:
                adj.setdefault(e.source_domain, []).append(e)

        # first_hop may always leave the origin. Every subsequent edge must explicitly
        # permit transitivity. Capacity is narrowed at every hop.
        queue = [(right.origin_domain, (right.origin_domain,), right.available, True)]
        while queue:
            node, route, cap, can_forward = queue.pop(0)
            if node != right.origin_domain and not can_forward:
                continue
            for edge in sorted(adj.get(node, ()), key=lambda x: (x.destination_domain, x.max_capacity)):
                if edge.destination_domain in route:
                    continue
                ncap = min(cap, edge.max_capacity)
                nroute = route + (edge.destination_domain,)
                if edge.destination_domain == destination_domain:
                    graph_root = _digest(tuple(
                        (e.source_domain, e.destination_domain, e.right_class, e.max_capacity, e.transitive)
                        for e in sorted(self.propagation_edges,
                                        key=lambda x: (x.source_domain, x.destination_domain,
                                                       x.right_class, x.max_capacity, x.transitive))))
                    return RightPropagationProof(right_id, right.origin_domain, destination_domain,
                                                 nroute, right.capacity, ncap, ncap, graph_root)
                queue.append((edge.destination_domain, nroute, ncap, edge.transitive))
        raise InstitutionNetworkError("no recognized propagation path")

    @staticmethod
    def allocate_priority(capacity: int, claims: Iterable[PriorityClaim]) -> Tuple[WaterfallAllocation, ...]:
        if capacity < 0:
            raise InstitutionNetworkError("negative capacity")
        remaining = capacity
        out = []
        for c in sorted(claims, key=lambda x: (x.priority, x.claim_id)):
            take = min(remaining, c.amount)
            remaining -= take
            out.append(WaterfallAllocation(c.claim_id, take, c.amount - take, c.priority))
        return tuple(out)

    @classmethod
    def assess_insolvency(cls, available_capacity: int, claims: Iterable[PriorityClaim]) -> InsolvencyAssessment:
        claims = tuple(claims)
        total = sum(c.amount for c in claims)
        waterfall = cls.allocate_priority(available_capacity, claims)
        deficiency = max(0, total - available_capacity)
        if deficiency == 0:
            state = InsolvencyState.SOLVENT
        elif available_capacity > 0:
            state = InsolvencyState.OVER_COMMITTED
        else:
            state = InsolvencyState.INSOLVENT
        return InsolvencyAssessment(state, available_capacity, total, deficiency, waterfall)

    def add_contract_edge(self, edge: ContractNetworkEdge):
        if edge.obligation_id in self.contract_edges:
            raise InstitutionNetworkError("duplicate network obligation")
        self.contract_edges[edge.obligation_id] = edge

    def network_reachability(self, origin_domain: str) -> ContractNetworkReachability:
        adj: Dict[str, list[ContractNetworkEdge]] = {}
        for e in self.contract_edges.values():
            if e.state not in ("SATISFIED", "FINAL"):
                adj.setdefault(e.debtor_domain, []).append(e)
        reachable = set()
        traversed = set()
        gross = 0
        max_path = 0
        path_count = 0

        def walk(node: str, visited_domains: frozenset[str], consequence: int):
            nonlocal gross, max_path, path_count
            for e in sorted(adj.get(node, ()), key=lambda x: x.obligation_id):
                if e.obligation_id in traversed or e.creditor_domain in visited_domains:
                    continue
                traversed.add(e.obligation_id)
                reachable.add(e.creditor_domain)
                gross += e.amount
                nxt = consequence + e.amount
                max_path = max(max_path, nxt)
                path_count += 1
                walk(e.creditor_domain, visited_domains | {e.creditor_domain}, nxt)

        walk(origin_domain, frozenset({origin_domain}), 0)
        return ContractNetworkReachability(origin_domain, tuple(sorted(reachable)), gross, max_path, path_count)

    def apply_settlement_proof(self, proof: SettlementProof):
        if proof.digest in self.applied_settlement_proofs:
            raise InstitutionNetworkError("settlement proof replay")
        obl = self.runtime.obligations.get(proof.obligation_id)
        edge = self.contract_edges.get(proof.obligation_id)
        if obl is None or edge is None:
            raise InstitutionNetworkError("obligation missing")
        if (obl.debtor_principal_id != proof.debtor_domain or
                obl.creditor_principal_id != proof.creditor_domain or
                obl.amount != proof.amount or obl.state != proof.prior_obligation_state):
            raise InstitutionNetworkError("settlement proof mismatch")
        if proof.resulting_obligation_state != "SATISFIED":
            raise InstitutionNetworkError("unsupported settlement result")
        # All checks precede mutation: both local and network obligation move together.
        self.runtime.obligations[proof.obligation_id] = replace(obl, state="SATISFIED")
        self.contract_edges[proof.obligation_id] = replace(edge, state="SATISFIED")
        self.applied_settlement_proofs[proof.digest] = proof.obligation_id
        return proof.digest

    def synthesize_authority(self, right_id: str, recognition_domain: str,
                             requested_ceiling: int) -> AuthoritySynthesis:
        if requested_ceiling < 0:
            raise InstitutionNetworkError("negative authority request")
        right = self.runtime.rights.get(right_id)
        rec = self.runtime.recognitions.get((right_id, recognition_domain))
        if right is None or right.lifecycle != RightLifecycle.ACTIVE:
            raise InstitutionNetworkError("active right missing")
        if rec is None or rec.state != RightRecognitionState.RECOGNIZED:
            raise InstitutionNetworkError("right not recognized")
        ceiling = min(requested_ceiling, right.available, rec.recognized_capacity)
        source = _digest((right.right_digest, asdict(rec)))
        return AuthoritySynthesis(right_id, recognition_domain, right.available,
                                  rec.recognized_capacity, ceiling, source)
