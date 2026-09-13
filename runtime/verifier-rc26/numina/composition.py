from __future__ import annotations
from dataclasses import dataclass
from typing import FrozenSet, Iterable, Tuple

@dataclass(frozen=True)
class AuthorityGrant:
    grant_id: str
    principal_id: str
    authority_classes: FrozenSet[str]
    max_consequence_usd_minor: int

@dataclass(frozen=True)
class MultiPrincipalPolicy:
    required_principals: FrozenSet[str]
    required_threshold: int
    max_consequence_usd_minor: int


def authorize_multi_principal(grants: Iterable[AuthorityGrant], policy: MultiPrincipalPolicy, *, authority_class: str, consequence_usd_minor: int):
    valid = [g for g in grants if g.principal_id in policy.required_principals and authority_class in g.authority_classes and consequence_usd_minor <= g.max_consequence_usd_minor]
    principals = frozenset(g.principal_id for g in valid)
    if consequence_usd_minor > policy.max_consequence_usd_minor:
        return False, 'MULTI_PRINCIPAL_BOUND_EXCEEDED'
    if len(principals) < policy.required_threshold:
        return False, 'MULTI_PRINCIPAL_THRESHOLD_NOT_MET'
    return True, 'MULTI_PRINCIPAL_AUTHORIZED'

@dataclass(frozen=True)
class CoalitionPolicy:
    coalition_id: str
    member_ids: FrozenSet[str]
    allowed_joint_actions: FrozenSet[str]
    aggregate_max_consequence_usd_minor: int


def coalition_authorized(policy: CoalitionPolicy, *, participants: Iterable[str], joint_action: str, aggregate_consequence_usd_minor: int):
    ps=frozenset(participants)
    if not ps <= policy.member_ids: return False, 'COALITION_MEMBER_OUTSIDE_POLICY'
    if joint_action not in policy.allowed_joint_actions: return False, 'COALITION_ACTION_NOT_AUTHORIZED'
    if aggregate_consequence_usd_minor > policy.aggregate_max_consequence_usd_minor: return False, 'COALITION_BOUND_EXCEEDED'
    return True, 'COALITION_AUTHORIZED'
