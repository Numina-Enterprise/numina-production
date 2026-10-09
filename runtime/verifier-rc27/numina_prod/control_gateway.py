from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Iterable

ALLOWED_ACTIONS = {"observe", "analyze", "recommend", "prepare", "request_approval"}
ECONOMIC_ACTIONS = {"transfer", "trade", "withdraw", "deposit", "mint", "burn", "stake", "unstake"}
SUPPORTED_PROVIDERS = {"trm", "elliptic", "chainalysis", "circle", "arc", "ripple", "settlemint", "openreserve", "custom"}


def _canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _digest(value: dict) -> str:
    return sha256(_canonical(value)).hexdigest()


@dataclass(frozen=True)
class ControlDecision:
    decision: str
    reason: str
    action: str
    requires_human_approval: bool
    execution_permitted: bool
    evidence_root: str
    policy_root: str
    provider_set: tuple[str, ...]
    execution_environment: str | None = None

    def as_dict(self) -> dict:
        return {
            "decision": self.decision,
            "reason": self.reason,
            "action": self.action,
            "requires_human_approval": self.requires_human_approval,
            "execution_permitted": self.execution_permitted,
            "evidence_root": self.evidence_root,
            "policy_root": self.policy_root,
            "provider_set": list(self.provider_set),
            "execution_environment": self.execution_environment,
        }


def evaluate_control_request(*, action: str, observations: Iterable[dict], policy: dict | None = None, execution_controls: dict | None = None) -> ControlDecision:
    """Deterministic, provider-neutral policy evaluation.

    This surface never performs the requested external action. It only decides
    whether Numina may observe/analyze/recommend/prepare/request approval and
    emits stable roots over the supplied evidence and policy.
    """
    action = (action or "").strip().lower()
    policy = dict(policy or {})
    execution_controls = dict(execution_controls or {})
    observations = [dict(x) for x in observations]

    providers = []
    for obs in observations:
        provider = str(obs.get("provider", "custom")).strip().lower() or "custom"
        if provider not in SUPPORTED_PROVIDERS:
            provider = "custom"
        providers.append(provider)

    evidence = {
        "observations": observations,
        "providers": sorted(set(providers)),
    }
    evidence_root = _digest(evidence)
    policy_root = _digest(policy)

    if action in ECONOMIC_ACTIONS:
        policy_allows = bool(policy.get("economic_execution_allowed", False))
        human_required = bool(policy.get("require_human_approval", True))
        human_granted = bool(policy.get("human_approval_granted", False))
        real_funds_enabled = bool(execution_controls.get("real_funds_enabled", False))
        execution_api_enabled = bool(execution_controls.get("public_execution_api_enabled", False))
        testnet_execution_enabled = bool(execution_controls.get("testnet_execution_enabled", False))
        execution_environment = str(policy.get("execution_environment", "mainnet")).strip().lower()

        if execution_environment not in {"mainnet", "testnet"}:
            return ControlDecision(
                decision="DENY", reason="execution_environment must be mainnet or testnet", action=action,
                requires_human_approval=human_required, execution_permitted=False,
                evidence_root=evidence_root, policy_root=policy_root, provider_set=tuple(sorted(set(providers))),
                execution_environment=execution_environment,
            )
        if not policy_allows:
            return ControlDecision(
                decision="HUMAN_APPROVAL_REQUIRED",
                reason="economic execution requires an explicit policy grant", action=action,
                requires_human_approval=True, execution_permitted=False,
                evidence_root=evidence_root, policy_root=policy_root, provider_set=tuple(sorted(set(providers))),
                execution_environment=execution_environment,
            )
        if human_required and not human_granted:
            return ControlDecision(
                decision="HUMAN_APPROVAL_REQUIRED",
                reason="economic execution policy requires human approval", action=action,
                requires_human_approval=True, execution_permitted=False,
                evidence_root=evidence_root, policy_root=policy_root, provider_set=tuple(sorted(set(providers))),
                execution_environment=execution_environment,
            )
        if execution_environment == "testnet":
            gate_open = execution_api_enabled and testnet_execution_enabled
            gate_reason = "testnet execution requires public execution API and testnet execution gates"
        else:
            gate_open = execution_api_enabled and real_funds_enabled
            gate_reason = "mainnet execution requires public execution API and real-funds gates"
        if not gate_open:
            return ControlDecision(
                decision="CONTROL_GATE_CLOSED", reason=gate_reason, action=action,
                requires_human_approval=human_required, execution_permitted=False,
                evidence_root=evidence_root, policy_root=policy_root, provider_set=tuple(sorted(set(providers))),
                execution_environment=execution_environment,
            )
        return ControlDecision(
            decision="ALLOW_EXECUTION",
            reason=f"policy approval and {execution_environment} runtime controls permit provider handoff",
            action=action, requires_human_approval=human_required, execution_permitted=True,
            evidence_root=evidence_root, policy_root=policy_root, provider_set=tuple(sorted(set(providers))),
            execution_environment=execution_environment,
        )

    if action not in ALLOWED_ACTIONS:
        return ControlDecision(
            decision="DENY",
            reason="action is not in the non-mutating control vocabulary",
            action=action,
            requires_human_approval=False,
            execution_permitted=False,
            evidence_root=evidence_root,
            policy_root=policy_root,
            provider_set=tuple(sorted(set(providers))),
        )

    required = int(policy.get("minimum_observations", 0) or 0)
    if len(observations) < required:
        return ControlDecision(
            decision="DENY",
            reason="minimum evidence threshold not satisfied",
            action=action,
            requires_human_approval=False,
            execution_permitted=False,
            evidence_root=evidence_root,
            policy_root=policy_root,
            provider_set=tuple(sorted(set(providers))),
        )

    require_multi_source = bool(policy.get("require_multi_source", False))
    if require_multi_source and len(set(providers)) < 2:
        return ControlDecision(
            decision="DENY",
            reason="multi-source evidence policy not satisfied",
            action=action,
            requires_human_approval=False,
            execution_permitted=False,
            evidence_root=evidence_root,
            policy_root=policy_root,
            provider_set=tuple(sorted(set(providers))),
        )

    return ControlDecision(
        decision="ALLOW_NON_MUTATING",
        reason="request is inside the non-mutating Numina control boundary",
        action=action,
        requires_human_approval=(action == "request_approval"),
        execution_permitted=False,
        evidence_root=evidence_root,
        policy_root=policy_root,
        provider_set=tuple(sorted(set(providers))),
    )
