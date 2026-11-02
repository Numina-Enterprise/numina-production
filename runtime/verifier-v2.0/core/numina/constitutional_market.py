from __future__ import annotations

from dataclasses import dataclass, asdict, replace
from enum import Enum
from hashlib import sha256
import json
from typing import Dict, Iterable, Tuple


def _digest(v) -> str:
    return sha256(json.dumps(v, sort_keys=True, separators=(",", ":"), default=list).encode()).hexdigest()


class ConstitutionalMarketError(Exception):
    pass


class ClearingState(str, Enum):
    OPEN = "OPEN"
    MARGIN_DEFICIENT = "MARGIN_DEFICIENT"
    DEFAULT_PENDING = "DEFAULT_PENDING"
    DEFAULT_DECLARED = "DEFAULT_DECLARED"
    RECOVERY = "RECOVERY"
    CLOSED = "CLOSED"


@dataclass(frozen=True)
class ClearingMember:
    domain_id: str
    recognition_ceiling: int
    settlement_capacity: int
    collateral_capacity: int

    def __post_init__(self):
        if not self.domain_id or min(self.recognition_ceiling, self.settlement_capacity, self.collateral_capacity) < 0:
            raise ConstitutionalMarketError("invalid clearing member")


@dataclass(frozen=True)
class ClearingObligation:
    obligation_id: str
    debtor: str
    creditor: str
    resource: str
    amount: int
    nettable: bool = False
    state: str = "OPEN"

    def __post_init__(self):
        if not self.obligation_id or not self.debtor or not self.creditor or not self.resource or self.amount < 0:
            raise ConstitutionalMarketError("invalid clearing obligation")
        if self.debtor == self.creditor:
            raise ConstitutionalMarketError("self obligation invalid")


@dataclass(frozen=True)
class NettingRight:
    right_id: str
    clearing_domain: str
    resource: str
    participants: Tuple[str, ...]
    max_gross_amount: int

    def __post_init__(self):
        if not self.right_id or not self.clearing_domain or not self.resource or len(set(self.participants)) < 2 or self.max_gross_amount < 0:
            raise ConstitutionalMarketError("invalid netting right")


@dataclass(frozen=True)
class NettingResult:
    right_id: str
    gross_open: int
    bilateral_net: Tuple[Tuple[str, str, int], ...]
    participant_net: Tuple[Tuple[str, int], ...]
    net_abs_exposure: int
    source_root: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class CollateralLot:
    lot_id: str
    owner: str
    resource: str
    amount: int
    haircut_bps: int
    encumbered: int = 0
    uncertain: int = 0

    def __post_init__(self):
        if not self.lot_id or not self.owner or not self.resource or self.amount < 0:
            raise ConstitutionalMarketError("invalid collateral lot")
        if not (0 <= self.haircut_bps <= 10_000):
            raise ConstitutionalMarketError("invalid haircut")
        if min(self.encumbered, self.uncertain) < 0 or self.encumbered + self.uncertain > self.amount:
            raise ConstitutionalMarketError("invalid collateral occupancy")

    @property
    def eligible_after_haircut(self) -> int:
        return (self.amount * (10_000 - self.haircut_bps)) // 10_000

    @property
    def available_eligible(self) -> int:
        occupied_raw = self.encumbered + self.uncertain
        available_raw = max(0, self.amount - occupied_raw)
        return (available_raw * (10_000 - self.haircut_bps)) // 10_000


@dataclass(frozen=True)
class CollateralReservation:
    reservation_id: str
    owner: str
    eligible_amount: int
    source_lots: Tuple[Tuple[str, int], ...]
    purpose: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class DefaultAssessment:
    domain_id: str
    state: ClearingState
    open_obligations: int
    eligible_collateral: int
    settlement_capacity: int
    deficiency: int


@dataclass(frozen=True)
class CloseoutAuthority:
    authority_id: str
    domain_id: str
    max_closeout_amount: int
    permitted_resources: Tuple[str, ...]
    preauthorized: bool

    def __post_init__(self):
        if not self.authority_id or not self.domain_id or self.max_closeout_amount < 0:
            raise ConstitutionalMarketError("invalid closeout authority")


@dataclass(frozen=True)
class CloseoutPlan:
    authority_id: str
    domain_id: str
    gross_obligation: int
    closeout_amount: int
    residual_obligation: int
    resource: str
    source_root: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class ContagionEdge:
    source_domain: str
    destination_domain: str
    max_propagated_consequence: int


@dataclass(frozen=True)
class SystemicStressResult:
    origin_domain: str
    affected_domains: Tuple[str, ...]
    total_propagated_consequence: int
    max_path_consequence: int
    source_root: str

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


@dataclass(frozen=True)
class InterInstitutionSettlementProof:
    proof_id: str
    clearing_domain: str
    obligation_id: str
    debtor: str
    creditor: str
    amount: int
    resource: str
    prior_state: str
    resulting_state: str
    settlement_sequence: int
    evidence_root: str

    def __post_init__(self):
        if not self.proof_id or not self.clearing_domain or not self.obligation_id or self.amount < 0 or self.settlement_sequence < 0 or not self.evidence_root:
            raise ConstitutionalMarketError("invalid settlement proof")

    @property
    def digest(self) -> str:
        return _digest(asdict(self))


class ConstitutionalMarketRuntime:
    """Deterministic market/clearing layer over independently sovereign domains.

    The runtime can net only under an explicit NettingRight, can encumber only
    pre-existing collateral, and can close out only under pre-authorized bounded
    authority.  It never treats settlement failure/default as a source of rights.
    """

    def __init__(self, clearing_domain: str):
        if not clearing_domain:
            raise ConstitutionalMarketError("clearing domain required")
        self.clearing_domain = clearing_domain
        self.members: Dict[str, ClearingMember] = {}
        self.obligations: Dict[str, ClearingObligation] = {}
        self.netting_rights: Dict[str, NettingRight] = {}
        self.collateral: Dict[str, CollateralLot] = {}
        self.collateral_reservations: Dict[str, CollateralReservation] = {}
        self.applied_settlement_proofs: Dict[str, str] = {}
        self.contagion_edges: list[ContagionEdge] = []

    def add_member(self, member: ClearingMember):
        if member.domain_id in self.members:
            raise ConstitutionalMarketError("duplicate member")
        self.members[member.domain_id] = member

    def add_obligation(self, obligation: ClearingObligation):
        if obligation.obligation_id in self.obligations:
            raise ConstitutionalMarketError("duplicate obligation")
        if obligation.debtor not in self.members or obligation.creditor not in self.members:
            raise ConstitutionalMarketError("unknown member")
        self.obligations[obligation.obligation_id] = obligation

    def add_netting_right(self, right: NettingRight):
        if right.right_id in self.netting_rights:
            raise ConstitutionalMarketError("duplicate netting right")
        if right.clearing_domain != self.clearing_domain:
            raise ConstitutionalMarketError("wrong clearing domain")
        if any(p not in self.members for p in right.participants):
            raise ConstitutionalMarketError("unknown netting participant")
        self.netting_rights[right.right_id] = right

    def compute_netting(self, right_id: str) -> NettingResult:
        right = self.netting_rights.get(right_id)
        if right is None:
            raise ConstitutionalMarketError("netting right missing")
        open_obls = [o for o in self.obligations.values()
                     if o.state == "OPEN" and o.nettable and o.resource == right.resource
                     and o.debtor in right.participants and o.creditor in right.participants]
        gross = sum(o.amount for o in open_obls)
        if gross > right.max_gross_amount:
            raise ConstitutionalMarketError("netting right gross ceiling exceeded")
        pairs: Dict[Tuple[str, str], int] = {}
        nets: Dict[str, int] = {p: 0 for p in right.participants}
        for o in open_obls:
            pairs[(o.debtor, o.creditor)] = pairs.get((o.debtor, o.creditor), 0) + o.amount
            nets[o.debtor] -= o.amount
            nets[o.creditor] += o.amount
        # Bilateral compression is representational only; participant net preserves gross provenance.
        bilateral = []
        done = set()
        for a,b in sorted(pairs):
            if (a,b) in done:
                continue
            ab = pairs.get((a,b), 0); ba = pairs.get((b,a), 0)
            if ab > ba:
                bilateral.append((a,b,ab-ba))
            elif ba > ab:
                bilateral.append((b,a,ba-ab))
            done.add((a,b)); done.add((b,a))
        source_root = _digest(tuple(sorted((o.obligation_id,o.debtor,o.creditor,o.amount,o.resource,o.state) for o in open_obls)))
        return NettingResult(right_id, gross, tuple(sorted(bilateral)), tuple(sorted(nets.items())), sum(abs(v) for v in nets.values())//2, source_root)

    def add_collateral_lot(self, lot: CollateralLot):
        if lot.lot_id in self.collateral:
            raise ConstitutionalMarketError("duplicate collateral")
        if lot.owner not in self.members:
            raise ConstitutionalMarketError("unknown collateral owner")
        self.collateral[lot.lot_id] = lot

    def reserve_collateral(self, reservation_id: str, owner: str, eligible_amount: int, purpose: str) -> CollateralReservation:
        if not reservation_id or reservation_id in self.collateral_reservations or eligible_amount < 0:
            raise ConstitutionalMarketError("invalid collateral reservation")
        candidates = [l for l in self.collateral.values() if l.owner == owner and l.available_eligible > 0]
        candidates.sort(key=lambda l: l.lot_id)
        remaining = eligible_amount
        updates: Dict[str, CollateralLot] = {}
        used = []
        for lot in candidates:
            if remaining <= 0:
                break
            # Convert eligible requested amount back to a conservative raw encumbrance.
            factor = 10_000 - lot.haircut_bps
            if factor <= 0:
                continue
            max_eligible = lot.available_eligible
            take_eligible = min(remaining, max_eligible)
            raw = (take_eligible * 10_000 + factor - 1) // factor
            raw = min(raw, lot.amount - lot.encumbered - lot.uncertain)
            actual_eligible = (raw * factor) // 10_000
            if actual_eligible <= 0:
                continue
            updates[lot.lot_id] = replace(lot, encumbered=lot.encumbered + raw)
            used.append((lot.lot_id, actual_eligible))
            remaining -= actual_eligible
        if remaining > 0:
            raise ConstitutionalMarketError("insufficient collateral")
        self.collateral.update(updates)
        r = CollateralReservation(reservation_id, owner, eligible_amount, tuple(used), purpose)
        self.collateral_reservations[reservation_id] = r
        return r

    def assess_default(self, domain_id: str) -> DefaultAssessment:
        m = self.members.get(domain_id)
        if m is None:
            raise ConstitutionalMarketError("member missing")
        open_ob = sum(o.amount for o in self.obligations.values() if o.debtor == domain_id and o.state == "OPEN")
        collateral = sum(l.eligible_after_haircut for l in self.collateral.values() if l.owner == domain_id)
        cover = collateral + m.settlement_capacity
        deficiency = max(0, open_ob - cover)
        if deficiency == 0:
            state = ClearingState.OPEN
        elif cover > 0:
            state = ClearingState.MARGIN_DEFICIENT
        else:
            state = ClearingState.DEFAULT_PENDING
        return DefaultAssessment(domain_id, state, open_ob, collateral, m.settlement_capacity, deficiency)

    def plan_closeout(self, authority: CloseoutAuthority, resource: str) -> CloseoutPlan:
        if authority.domain_id not in self.members or not authority.preauthorized:
            raise ConstitutionalMarketError("closeout authority unavailable")
        if resource not in authority.permitted_resources:
            raise ConstitutionalMarketError("resource not permitted")
        gross = sum(o.amount for o in self.obligations.values()
                    if o.debtor == authority.domain_id and o.resource == resource and o.state == "OPEN")
        amount = min(gross, authority.max_closeout_amount)
        root = _digest(tuple(sorted((o.obligation_id,o.amount,o.state) for o in self.obligations.values()
                                    if o.debtor == authority.domain_id and o.resource == resource)))
        return CloseoutPlan(authority.authority_id, authority.domain_id, gross, amount, gross-amount, resource, root)

    def add_contagion_edge(self, edge: ContagionEdge):
        if min(edge.max_propagated_consequence, 0) < 0 or edge.source_domain not in self.members or edge.destination_domain not in self.members:
            raise ConstitutionalMarketError("invalid contagion edge")
        self.contagion_edges.append(edge)

    def systemic_stress(self, origin_domain: str, initial_consequence: int) -> SystemicStressResult:
        if origin_domain not in self.members or initial_consequence < 0:
            raise ConstitutionalMarketError("invalid stress origin")
        adj: Dict[str, list[ContagionEdge]] = {}
        for e in self.contagion_edges:
            adj.setdefault(e.source_domain, []).append(e)
        affected=set(); total=0; max_path=0
        def walk(node: str, remaining: int, visited: frozenset[str], accum: int):
            nonlocal total,max_path
            for e in sorted(adj.get(node,()), key=lambda x:(x.destination_domain,x.max_propagated_consequence)):
                if e.destination_domain in visited:
                    continue
                propagated=min(remaining,e.max_propagated_consequence)
                if propagated <= 0:
                    continue
                affected.add(e.destination_domain); total += propagated
                nxt=accum+propagated; max_path=max(max_path,nxt)
                walk(e.destination_domain,propagated,visited|{e.destination_domain},nxt)
        walk(origin_domain,initial_consequence,frozenset({origin_domain}),0)
        root=_digest(tuple(sorted((e.source_domain,e.destination_domain,e.max_propagated_consequence) for e in self.contagion_edges)))
        return SystemicStressResult(origin_domain,tuple(sorted(affected)),total,max_path,root)

    def apply_settlement_proof(self, proof: InterInstitutionSettlementProof) -> str:
        if proof.clearing_domain != self.clearing_domain:
            raise ConstitutionalMarketError("wrong clearing domain")
        if proof.digest in self.applied_settlement_proofs:
            raise ConstitutionalMarketError("settlement proof replay")
        obl=self.obligations.get(proof.obligation_id)
        if obl is None:
            raise ConstitutionalMarketError("obligation missing")
        if (obl.debtor != proof.debtor or obl.creditor != proof.creditor or obl.amount != proof.amount or
            obl.resource != proof.resource or obl.state != proof.prior_state):
            raise ConstitutionalMarketError("settlement mismatch")
        if proof.resulting_state not in ("SATISFIED","FINAL"):
            raise ConstitutionalMarketError("unsupported settlement result")
        self.obligations[proof.obligation_id]=replace(obl,state=proof.resulting_state)
        self.applied_settlement_proofs[proof.digest]=proof.obligation_id
        return proof.digest

    def state_root(self) -> str:
        return _digest({
            "clearing_domain": self.clearing_domain,
            "members": [asdict(x) for x in sorted(self.members.values(), key=lambda x:x.domain_id)],
            "obligations": [asdict(x) for x in sorted(self.obligations.values(), key=lambda x:x.obligation_id)],
            "netting_rights": [asdict(x) for x in sorted(self.netting_rights.values(), key=lambda x:x.right_id)],
            "collateral": [asdict(x) for x in sorted(self.collateral.values(), key=lambda x:x.lot_id)],
            "reservations": [asdict(x) for x in sorted(self.collateral_reservations.values(), key=lambda x:x.reservation_id)],
        })
