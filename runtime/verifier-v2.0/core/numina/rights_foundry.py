from __future__ import annotations
from dataclasses import dataclass, asdict
from enum import Enum
from hashlib import sha256
import json
from typing import Dict, Tuple, Iterable

from .rights_runtime import (
    RightsRuntime, RightsError, RightCreationAuthority, RightGenesisRequest,
    RightKind, BackingKind, RuntimeRight, RightsObligation
)


def _digest(v) -> str:
    return sha256(json.dumps(v, sort_keys=True, separators=(",", ":"), default=list).encode()).hexdigest()


class FoundryError(RightsError):
    pass


class Exclusivity(str, Enum):
    NON_EXCLUSIVE = "NON_EXCLUSIVE"
    EXCLUSIVE = "EXCLUSIVE"


class NovelTypeState(str, Enum):
    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


@dataclass(frozen=True)
class RightTemplate:
    template_id: str
    right_class: str
    right_kind: RightKind
    backing_kind: BackingKind
    max_capacity: int
    transferable: bool = False
    priority: int = 0
    exclusivity: Exclusivity = Exclusivity.NON_EXCLUSIVE
    allowed_source_classes: Tuple[str, ...] = ()
    requires_counterparty: bool = False

    def __post_init__(self):
        if not self.template_id or not self.right_class or self.max_capacity < 0 or self.priority < 0:
            raise FoundryError("invalid right template")

    @property
    def digest(self): return _digest(asdict(self))


@dataclass(frozen=True)
class RightTypeProposal:
    proposal_id: str
    right_class: str
    semantics_digest: str
    requested_max_capacity: int
    state: NovelTypeState = NovelTypeState.PROPOSED

    def __post_init__(self):
        if not self.proposal_id or not self.right_class or not self.semantics_digest or self.requested_max_capacity < 0:
            raise FoundryError("invalid right type proposal")

    @property
    def digest(self): return _digest(asdict(self))


@dataclass(frozen=True)
class RightTypeGovernanceProof:
    proposal_digest: str
    approver_ids: Tuple[str, ...]
    required_threshold: int
    governance_epoch: int

    def __post_init__(self):
        if self.required_threshold <= 0 or self.governance_epoch < 0:
            raise FoundryError("invalid type governance proof")
        if len(set(self.approver_ids)) != len(self.approver_ids):
            raise FoundryError("duplicate approver")

    @property
    def digest(self): return _digest(asdict(self))


@dataclass(frozen=True)
class RightsTransformationRule:
    rule_id: str
    source_class: str
    destination_class: str
    numerator: int
    denominator: int
    haircut_bps: int = 0

    def __post_init__(self):
        if not self.rule_id or self.numerator < 0 or self.denominator <= 0 or not 0 <= self.haircut_bps <= 10000:
            raise FoundryError("invalid transformation rule")

    def destination_capacity(self, source_capacity: int) -> int:
        gross = source_capacity * self.numerator // self.denominator
        return gross * (10000 - self.haircut_bps) // 10000


@dataclass(frozen=True)
class ContractParty:
    principal_id: str
    role: str
    creation_authority_id: str


@dataclass(frozen=True)
class ContractTerm:
    right_id: str
    right_template_id: str
    creditor_principal_id: str
    debtor_principal_id: str
    amount: int
    source_right_ids: Tuple[str, ...] = ()


@dataclass(frozen=True)
class AutonomousContract:
    contract_id: str
    parties: Tuple[ContractParty, ...]
    terms: Tuple[ContractTerm, ...]
    required_approvals: Tuple[str, ...]
    contract_epoch: int

    @property
    def digest(self): return _digest(asdict(self))


@dataclass(frozen=True)
class ContractCommitProof:
    contract_digest: str
    approver_principals: Tuple[str, ...]
    contract_epoch: int

    @property
    def digest(self): return _digest(asdict(self))


@dataclass(frozen=True)
class ContractExecutionResult:
    contract_digest: str
    created_right_ids: Tuple[str, ...]
    created_obligation_ids: Tuple[str, ...]
    pre_root: str
    post_root: str


@dataclass(frozen=True)
class GenesisCut:
    target_right_class: str
    authority_ids: Tuple[str, ...]
    cut_size: int


class RightsFoundry:
    """Governed constructor for right instances and autonomous contracts.

    It can instantiate approved right types and atomically form reciprocal rights/
    obligations. Novel type creation is explicitly separated from instance creation.
    """
    def __init__(self, runtime: RightsRuntime, governance_epoch: int = 0):
        self.runtime = runtime
        self.governance_epoch = governance_epoch
        self.templates: Dict[str, RightTemplate] = {}
        self.approved_right_types: Dict[str, str] = {}
        self.transformations: Dict[str, RightsTransformationRule] = {}
        self.type_proposals: Dict[str, RightTypeProposal] = {}

    def register_template(self, t: RightTemplate):
        if t.template_id in self.templates: raise FoundryError("duplicate template")
        self.templates[t.template_id] = t
        self.approved_right_types.setdefault(t.right_class, t.digest)

    def propose_right_type(self, p: RightTypeProposal):
        if p.proposal_id in self.type_proposals: raise FoundryError("duplicate type proposal")
        self.type_proposals[p.proposal_id] = p
        return p

    def approve_right_type(self, proposal_id: str, proof: RightTypeGovernanceProof):
        p = self.type_proposals.get(proposal_id)
        if p is None: raise FoundryError("unknown type proposal")
        if proof.proposal_digest != p.digest or proof.governance_epoch != self.governance_epoch:
            raise FoundryError("invalid type governance proof")
        if len(proof.approver_ids) < proof.required_threshold:
            raise FoundryError("insufficient type governance threshold")
        self.approved_right_types[p.right_class] = p.semantics_digest
        self.type_proposals[proposal_id] = RightTypeProposal(p.proposal_id,p.right_class,p.semantics_digest,p.requested_max_capacity,NovelTypeState.APPROVED)

    def register_transformation(self, rule: RightsTransformationRule):
        if rule.rule_id in self.transformations: raise FoundryError("duplicate transformation")
        self.transformations[rule.rule_id]=rule

    def instantiate(self, template_id: str, authority_id: str, right_id: str, principal_id: str,
                    capacity: int, source_right_ids: Tuple[str,...]=()) -> RuntimeRight:
        t=self.templates.get(template_id)
        if t is None: raise FoundryError("unknown template")
        if t.right_class not in self.approved_right_types: raise FoundryError("right type not approved")
        if capacity < 0 or capacity > t.max_capacity: raise FoundryError("template capacity exceeded")
        if t.allowed_source_classes:
            for rid in source_right_ids:
                r=self.runtime.rights.get(rid)
                if r is None or r.right_class not in t.allowed_source_classes:
                    raise FoundryError("source class not permitted")
        if t.exclusivity == Exclusivity.EXCLUSIVE:
            for r in self.runtime.rights.values():
                if r.lifecycle.value != "EXTINGUISHED" and r.principal_id == principal_id and r.right_class == t.right_class:
                    raise FoundryError("exclusive right already active")
        req=RightGenesisRequest(right_id,principal_id,t.right_class,t.right_kind,t.backing_kind,capacity,source_right_ids,t.transferable,t.priority)
        return self.runtime.create_right(authority_id,req)

    def transform(self, rule_id: str, authority_id: str, source_right_id: str, new_right_id: str,
                  principal_id: str, requested_capacity: int | None = None) -> RuntimeRight:
        rule=self.transformations.get(rule_id)
        src=self.runtime.rights.get(source_right_id)
        if rule is None or src is None: raise FoundryError("unknown transformation/source")
        if src.right_class != rule.source_class: raise FoundryError("transformation source class mismatch")
        maxcap=rule.destination_capacity(src.available)
        cap=maxcap if requested_capacity is None else requested_capacity
        if cap > maxcap: raise FoundryError("transformation exceeds conserved capacity")
        # transformation uses normal derived-right backing, so source becomes encumbered
        req=RightGenesisRequest(new_right_id,principal_id,rule.destination_class,RightKind.USE,BackingKind.RESOURCE_BACKED,cap,(source_right_id,),False,src.priority)
        return self.runtime.create_right(authority_id,req)

    def _validate_contract(self, contract: AutonomousContract, proof: ContractCommitProof):
        if proof.contract_digest != contract.digest or proof.contract_epoch != contract.contract_epoch:
            raise FoundryError("contract proof mismatch")
        if len(set(proof.approver_principals)) != len(proof.approver_principals):
            raise FoundryError("duplicate contract approver")
        if not set(contract.required_approvals).issubset(set(proof.approver_principals)):
            raise FoundryError("missing contract approval")
        party_ids={p.principal_id for p in contract.parties}
        if not party_ids: raise FoundryError("contract requires parties")
        for term in contract.terms:
            if term.creditor_principal_id not in party_ids or term.debtor_principal_id not in party_ids:
                raise FoundryError("term principal not party")
            if term.amount < 0: raise FoundryError("negative contract amount")
            if term.right_template_id not in self.templates: raise FoundryError("unknown term template")

    def execute_contract(self, contract: AutonomousContract, proof: ContractCommitProof) -> ContractExecutionResult:
        self._validate_contract(contract,proof)
        pre=self.runtime.state_root
        # Snapshot reference state for all-or-nothing rollback.
        snap=(dict(self.runtime.rights),dict(self.runtime.obligations),dict(self.runtime.reciprocal_pairs),
              dict(self.runtime.recognitions),list(self.runtime.events),self.runtime.sequence)
        created_r=[]; created_o=[]
        party_authority={p.principal_id:p.creation_authority_id for p in contract.parties}
        try:
            for idx,term in enumerate(contract.terms):
                tmpl=self.templates[term.right_template_id]
                if tmpl.right_kind != RightKind.CLAIM:
                    raise FoundryError("contract term must create claim right")
                aid=party_authority.get(term.creditor_principal_id)
                if not aid: raise FoundryError("creditor lacks creation authority")
                rid=term.right_id
                oid=f"{contract.contract_id}:OBL:{idx}"
                if rid in self.runtime.rights or oid in self.runtime.obligations:
                    raise FoundryError("duplicate contract economic object")
                self.instantiate(term.right_template_id,aid,rid,term.creditor_principal_id,term.amount,term.source_right_ids)
                self.runtime.obligations[oid]=RightsObligation(oid,term.debtor_principal_id,term.creditor_principal_id,term.amount)
                created_r.append(rid); created_o.append(oid)
            # record one deterministic terminal event for contract formation by nudging sequence via runtime event helper if available
            return ContractExecutionResult(contract.digest,tuple(created_r),tuple(created_o),pre,self.runtime.state_root)
        except Exception:
            self.runtime.rights,self.runtime.obligations,self.runtime.reciprocal_pairs,self.runtime.recognitions,self.runtime.events,self.runtime.sequence=snap
            raise

    def rights_genesis_min_cut(self, target_right_class: str) -> GenesisCut:
        ids=[]
        for aid,a in sorted(self.runtime.creation_authorities.items()):
            if target_right_class in a.allowed_right_classes:
                ids.append(aid)
        # conservative reference metric: each independent creation authority is a genesis path.
        return GenesisCut(target_right_class,tuple(ids),len(ids))

    def priority_conflicts(self) -> Tuple[Tuple[str,str], ...]:
        out=[]
        rights=[r for r in self.runtime.rights.values() if r.lifecycle.value != "EXTINGUISHED"]
        for i,a in enumerate(rights):
            for b in rights[i+1:]:
                if a.source_right_ids and b.source_right_ids and set(a.source_right_ids)&set(b.source_right_ids):
                    if a.capacity+b.capacity > sum(self.runtime.rights[s].capacity for s in set(a.source_right_ids)&set(b.source_right_ids)):
                        out.append(tuple(sorted((a.right_id,b.right_id))))
        return tuple(sorted(set(out)))
