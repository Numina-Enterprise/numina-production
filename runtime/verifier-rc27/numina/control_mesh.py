from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import FrozenSet, Iterable, Tuple


class EndpointDecision(str, Enum):
    VALID_FOR_COMMIT = 'VALID_FOR_COMMIT'
    INVALID = 'INVALID'
    REVALIDATION_REQUIRED = 'REVALIDATION_REQUIRED'


@dataclass(frozen=True)
class ProofCarryingEndpointContract:
    endpoint_id: str
    domain_id: str
    required_authority_classes: FrozenSet[str]
    max_consequence_usd_minor: int
    accepted_constitutions: FrozenSet[str]
    accepted_issuers: FrozenSet[str]
    max_status_age_ms: int
    require_commit_attestation: bool = True

    def verify_request(self, *, authority_class: str, consequence_usd_minor: int,
                       constitution_digest: str, issuer: str, status_age_ms: int) -> Tuple[EndpointDecision, str]:
        if consequence_usd_minor < 0:
            return EndpointDecision.INVALID, 'NEGATIVE_CONSEQUENCE'
        if authority_class not in self.required_authority_classes:
            return EndpointDecision.INVALID, 'AUTHORITY_CLASS_NOT_RECOGNIZED'
        if consequence_usd_minor > self.max_consequence_usd_minor:
            return EndpointDecision.INVALID, 'ENDPOINT_CONSEQUENCE_BOUND_EXCEEDED'
        if constitution_digest not in self.accepted_constitutions:
            return EndpointDecision.INVALID, 'CONSTITUTION_NOT_RECOGNIZED'
        if issuer not in self.accepted_issuers:
            return EndpointDecision.INVALID, 'ISSUER_NOT_RECOGNIZED'
        if status_age_ms < 0:
            return EndpointDecision.INVALID, 'INVALID_STATUS_AGE'
        if status_age_ms > self.max_status_age_ms:
            return EndpointDecision.REVALIDATION_REQUIRED, 'STATUS_TOO_OLD'
        return EndpointDecision.VALID_FOR_COMMIT, 'OK'


@dataclass(frozen=True)
class MeshEdge:
    source_endpoint: str
    target_endpoint: str
    authority_classes: FrozenSet[str]
    max_consequence_usd_minor: int


@dataclass(frozen=True)
class MeshPath:
    endpoints: Tuple[str, ...]
    limiting_consequence_usd_minor: int


class EconomicControlMesh:
    def __init__(self, endpoints: Iterable[ProofCarryingEndpointContract], edges: Iterable[MeshEdge]):
        self.endpoints = {e.endpoint_id: e for e in endpoints}
        self.edges = tuple(edges)

    def path(self, source: str, target: str, authority_class: str, consequence_usd_minor: int) -> MeshPath | None:
        if source not in self.endpoints or target not in self.endpoints:
            return None
        graph = {}
        for edge in self.edges:
            graph.setdefault(edge.source_endpoint, []).append(edge)
        q = [(source, (source,), 10**30)]
        seen = set()
        while q:
            node, path, limit = q.pop(0)
            if node in seen:
                continue
            seen.add(node)
            if node == target:
                return MeshPath(path, limit)
            for edge in graph.get(node, []):
                if authority_class not in edge.authority_classes:
                    continue
                if consequence_usd_minor > edge.max_consequence_usd_minor:
                    continue
                if edge.target_endpoint in path:
                    continue
                q.append((edge.target_endpoint, path + (edge.target_endpoint,), min(limit, edge.max_consequence_usd_minor)))
        return None
