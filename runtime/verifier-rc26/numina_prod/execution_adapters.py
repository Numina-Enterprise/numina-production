from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Mapping

from .signing import verify_envelope

CONTROL_DECISION_TYPE = "NUMINA_CONTROL_DECISION"
EXECUTION_HANDOFF_TYPE = "NUMINA_EXECUTION_HANDOFF"
EXTERNAL_EVIDENCE_BINDING_TYPE = "NUMINA_EXTERNAL_EVIDENCE_BINDING"


def _canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value: dict) -> str:
    return sha256(_canonical(value)).hexdigest()


@dataclass(frozen=True)
class ProviderDescriptor:
    provider: str
    kind: str
    capabilities: tuple[str, ...]
    execution_capable: bool
    live_adapter_shipped: bool
    notes: str

    def as_dict(self) -> dict:
        return {
            "provider": self.provider,
            "kind": self.kind,
            "capabilities": list(self.capabilities),
            "execution_capable": self.execution_capable,
            "live_adapter_shipped": self.live_adapter_shipped,
            "notes": self.notes,
        }


_PROVIDER_REGISTRY: Mapping[str, ProviderDescriptor] = {
    "arc": ProviderDescriptor(
        "arc", "settlement-network",
        ("stablecoin-settlement", "transaction-submission", "receipt-reference"),
        True, False,
        "Arc-facing handoffs are provider-neutral in rc26; no private key or direct RPC submitter is bundled.",
    ),
    "circle": ProviderDescriptor(
        "circle", "wallet-settlement-infrastructure",
        ("wallet-action", "usdc-settlement", "crosschain-intent", "receipt-reference"),
        True, True,
        "rc26 ships an operator-side Circle Agent Wallet CLI testnet adapter; credentials and wallet session remain external to Numina.",
    ),
    "ripple": ProviderDescriptor(
        "ripple", "custody-settlement-infrastructure",
        ("custody-action", "settlement-intent", "receipt-reference"),
        True, False,
        "Ripple-facing handoffs are prepared without custody credentials.",
    ),
    "settlemint": ProviderDescriptor(
        "settlemint", "tokenization-orchestration",
        ("tokenization-intent", "workflow-action", "receipt-reference"),
        True, False,
        "SettleMint-facing handoffs are prepared as orchestration requests only.",
    ),
    "openreserve": ProviderDescriptor(
        "openreserve", "banking-custody-infrastructure",
        ("treasury-intent", "custody-intent", "receipt-reference"),
        True, False,
        "OpenReserve-facing handoffs are contract artifacts; no bank API credentials are bundled.",
    ),
    "trm": ProviderDescriptor(
        "trm", "blockchain-intelligence",
        ("risk-evidence", "screening-evidence", "investigative-evidence"),
        False, False,
        "TRM is modeled as an evidence provider, not an execution destination.",
    ),
    "elliptic": ProviderDescriptor(
        "elliptic", "blockchain-intelligence",
        ("risk-evidence", "screening-evidence", "agentic-compliance-evidence"),
        False, False,
        "Elliptic is modeled as an evidence provider, not an execution destination.",
    ),
    "chainalysis": ProviderDescriptor(
        "chainalysis", "blockchain-intelligence",
        ("risk-evidence", "screening-evidence", "investigative-evidence"),
        False, False,
        "Chainalysis is modeled as an evidence provider, not an execution destination.",
    ),
    "custom": ProviderDescriptor(
        "custom", "provider-neutral",
        ("custom-intent", "receipt-reference"),
        True, False,
        "Custom provider contract; submission remains outside the provider-neutral public verifier.",
    ),
}


def provider_catalog() -> list[dict]:
    return [_PROVIDER_REGISTRY[name].as_dict() for name in sorted(_PROVIDER_REGISTRY)]


def provider_descriptor(provider: str) -> ProviderDescriptor:
    key = (provider or "").strip().lower()
    if key not in _PROVIDER_REGISTRY:
        raise ValueError("UNKNOWN_EXECUTION_PROVIDER")
    return _PROVIDER_REGISTRY[key]


def prepare_execution_handoff(
    *,
    provider: str,
    intent: dict,
    control_receipt: dict,
    trusted_numina_public_key_b64: str,
) -> dict:
    descriptor = provider_descriptor(provider)
    if not descriptor.execution_capable:
        raise ValueError("PROVIDER_IS_EVIDENCE_ONLY")
    if not verify_envelope(
        control_receipt,
        expected_public_key_b64=trusted_numina_public_key_b64,
        expected_type=CONTROL_DECISION_TYPE,
    ):
        raise ValueError("CONTROL_DECISION_RECEIPT_INVALID")

    decision = dict(control_receipt.get("payload") or {})
    normalized_intent = dict(intent or {})
    action = str(normalized_intent.get("action", "")).strip().lower()
    if not action:
        raise ValueError("EXECUTION_INTENT_ACTION_REQUIRED")
    if str(decision.get("action", "")).strip().lower() != action:
        raise ValueError("CONTROL_DECISION_ACTION_MISMATCH")

    normalized_intent["action"] = action
    normalized_intent["provider"] = descriptor.provider
    intent_root = digest(normalized_intent)
    decision_root = digest(decision)
    provider_contract = descriptor.as_dict()
    provider_contract_root = digest(provider_contract)

    execution_permitted = bool(decision.get("execution_permitted", False))
    status = "READY_FOR_PROVIDER_SUBMISSION" if execution_permitted else "AWAITING_AUTHORIZATION"
    handoff = {
        "schema": "numina.execution-handoff.v1",
        "provider": descriptor.provider,
        "provider_kind": descriptor.kind,
        "status": status,
        "execution_permitted": execution_permitted,
        "external_execution_performed": False,
        "live_adapter_shipped": descriptor.live_adapter_shipped,
        "intent": normalized_intent,
        "intent_root": intent_root,
        "control_decision_root": decision_root,
        "control_decision_receipt_root": digest(control_receipt),
        "provider_contract_root": provider_contract_root,
        "obligations": [
            "preserve provider response without rewriting external status",
            "bind any external result to this intent_root",
            "treat authorization, submission, settlement, and verification as distinct states",
        ],
    }
    handoff["handoff_id"] = digest({
        "provider": descriptor.provider,
        "intent_root": intent_root,
        "control_decision_root": decision_root,
        "provider_contract_root": provider_contract_root,
    })
    return handoff


def bind_external_evidence(
    *,
    provider: str,
    handoff_receipt: dict,
    evidence: dict,
    trusted_numina_public_key_b64: str,
) -> dict:
    descriptor = provider_descriptor(provider)
    if not verify_envelope(
        handoff_receipt,
        expected_public_key_b64=trusted_numina_public_key_b64,
        expected_type=EXECUTION_HANDOFF_TYPE,
    ):
        raise ValueError("EXECUTION_HANDOFF_RECEIPT_INVALID")

    handoff = dict(handoff_receipt.get("payload") or {})
    if handoff.get("provider") != descriptor.provider:
        raise ValueError("EXECUTION_HANDOFF_PROVIDER_MISMATCH")
    evidence = dict(evidence or {})
    if not evidence:
        raise ValueError("EXTERNAL_EVIDENCE_REQUIRED")

    return {
        "schema": "numina.external-evidence-binding.v1",
        "provider": descriptor.provider,
        "handoff_id": handoff.get("handoff_id"),
        "intent_root": handoff.get("intent_root"),
        "handoff_receipt_root": digest(handoff_receipt),
        "evidence_root": digest(evidence),
        "evidence": evidence,
        "verification_status": "CALLER_ASSERTED_NOT_NETWORK_VERIFIED",
        "external_execution_claimed_by_numina": False,
        "note": "This receipt proves what evidence Numina received and bound; it does not independently prove the external network event.",
    }
