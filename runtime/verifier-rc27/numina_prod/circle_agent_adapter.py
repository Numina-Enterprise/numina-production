from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
import subprocess
from typing import Callable

from .execution_adapters import EXECUTION_HANDOFF_TYPE, digest
from .signing import verify_envelope

PROVIDER_SUBMISSION_TYPE = "NUMINA_PROVIDER_SUBMISSION"
PROVIDER_RECONCILIATION_TYPE = "NUMINA_PROVIDER_RECONCILIATION"
EVM_ADDRESS = re.compile(r"^0x[a-fA-F0-9]{40}$")
SUPPORTED_TESTNET_CHAINS = frozenset({"ARC-TESTNET"})


def _canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _safe_json(stdout: str) -> dict:
    text = (stdout or "").strip()
    if not text:
        raise ValueError("CIRCLE_CLI_EMPTY_RESPONSE")
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("CIRCLE_CLI_NON_JSON_RESPONSE") from exc
    if not isinstance(value, dict):
        raise ValueError("CIRCLE_CLI_RESPONSE_NOT_OBJECT")
    return value


def _positive_amount(value: object, maximum: Decimal) -> str:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("CIRCLE_AMOUNT_INVALID") from exc
    if not amount.is_finite() or amount <= 0:
        raise ValueError("CIRCLE_AMOUNT_INVALID")
    if amount > maximum:
        raise ValueError("CIRCLE_TESTNET_AMOUNT_LIMIT_EXCEEDED")
    normalized = format(amount.normalize(), "f")
    return normalized


@dataclass(frozen=True)
class CircleTestnetConfig:
    enabled: bool
    cli_path: str
    timeout_seconds: int
    max_usdc: Decimal
    journal_dir: Path
    allowed_chains: tuple[str, ...] = ("ARC-TESTNET",)


class CircleTestnetAdapter:
    """Operator-side Circle Agent Wallet adapter.

    The adapter accepts only Numina-signed READY_FOR_PROVIDER_SUBMISSION handoffs,
    only supports USDC transfer on explicitly allowed testnets, invokes Circle CLI
    without a shell, and journals handoff IDs before submission to prevent an
    accidental same-host retry from sending twice.
    """

    def __init__(self, config: CircleTestnetConfig, *, runner: Callable[..., subprocess.CompletedProcess] | None = None):
        self.config = config
        self.runner = runner or subprocess.run

    def capability(self) -> dict:
        return {
            "adapter": "circle-agent-wallet-cli",
            "provider": "circle",
            "environment": "testnet",
            "enabled": bool(self.config.enabled),
            "allowed_chains": list(self.config.allowed_chains),
            "supported_actions": ["transfer"],
            "asset": "USDC",
            "max_usdc_per_submission": str(self.config.max_usdc),
            "requires_circle_session": True,
            "durable_idempotency_scope": "configured NUMINA_DATA_DIR filesystem",
            "network_verification": "provider-reported; independent RPC verification is separate",
        }

    def _validated_handoff(self, handoff_receipt: dict, trusted_key: str) -> dict:
        if not verify_envelope(
            handoff_receipt,
            expected_public_key_b64=trusted_key,
            expected_type=EXECUTION_HANDOFF_TYPE,
        ):
            raise ValueError("EXECUTION_HANDOFF_RECEIPT_INVALID")
        handoff = dict(handoff_receipt.get("payload") or {})
        if handoff.get("provider") != "circle":
            raise ValueError("CIRCLE_HANDOFF_PROVIDER_REQUIRED")
        if handoff.get("status") != "READY_FOR_PROVIDER_SUBMISSION" or not handoff.get("execution_permitted"):
            raise ValueError("EXECUTION_HANDOFF_NOT_AUTHORIZED")
        intent = dict(handoff.get("intent") or {})
        if str(intent.get("action", "")).lower() != "transfer":
            raise ValueError("CIRCLE_ACTION_NOT_SUPPORTED")
        chain = str(intent.get("chain") or intent.get("network") or "").upper()
        allowed = {x.upper() for x in self.config.allowed_chains}
        if chain not in allowed or chain not in SUPPORTED_TESTNET_CHAINS:
            raise ValueError("CIRCLE_TESTNET_CHAIN_NOT_ALLOWED")
        source = str(intent.get("source_address") or "")
        destination = str(intent.get("destination") or "")
        if not EVM_ADDRESS.fullmatch(source):
            raise ValueError("CIRCLE_SOURCE_ADDRESS_INVALID")
        if not EVM_ADDRESS.fullmatch(destination):
            raise ValueError("CIRCLE_DESTINATION_ADDRESS_INVALID")
        asset = str(intent.get("asset") or "USDC").upper()
        if asset != "USDC":
            raise ValueError("CIRCLE_RC23_ONLY_SUPPORTS_USDC")
        amount = _positive_amount(intent.get("amount"), self.config.max_usdc)
        intent["action"] = "transfer"
        intent["chain"] = chain
        intent["asset"] = "USDC"
        intent["amount"] = amount
        handoff["intent"] = intent
        return handoff

    def _journal_path(self, handoff_id: str) -> Path:
        self.config.journal_dir.mkdir(parents=True, exist_ok=True)
        return self.config.journal_dir / f"{handoff_id}.json"

    def _existing_result(self, path: Path) -> dict | None:
        if not path.exists():
            return None
        try:
            value = json.loads(path.read_text())
        except Exception as exc:
            raise ValueError("CIRCLE_SUBMISSION_JOURNAL_INVALID") from exc
        if value.get("status") == "COMPLETED" and isinstance(value.get("result"), dict):
            return {**value["result"], "idempotent_replay": True}
        raise ValueError("CIRCLE_HANDOFF_ALREADY_SUBMITTED_OR_IN_PROGRESS")

    def submit(self, *, handoff_receipt: dict, trusted_numina_public_key_b64: str) -> dict:
        if not self.config.enabled:
            raise ValueError("CIRCLE_TESTNET_SUBMISSION_DISABLED")
        handoff = self._validated_handoff(handoff_receipt, trusted_numina_public_key_b64)
        handoff_id = str(handoff.get("handoff_id") or "")
        if not handoff_id:
            raise ValueError("EXECUTION_HANDOFF_ID_REQUIRED")
        path = self._journal_path(handoff_id)
        existing = self._existing_result(path)
        if existing is not None:
            return existing

        cli = shutil.which(self.config.cli_path) if Path(self.config.cli_path).name == self.config.cli_path else self.config.cli_path
        if not cli or not Path(cli).exists():
            raise ValueError("CIRCLE_CLI_NOT_AVAILABLE")

        intent = handoff["intent"]
        argv = [
            str(cli), "wallet", "transfer", intent["destination"],
            "--amount", intent["amount"],
            "--address", intent["source_address"],
            "--chain", intent["chain"],
            "--output", "json",
        ]
        command_fingerprint = sha256(_canonical({"argv": argv[1:]})).hexdigest()
        # O_EXCL prevents two same-host workers from racing the same handoff.
        try:
            with path.open("x") as f:
                json.dump({"status": "IN_PROGRESS", "handoff_id": handoff_id, "command_fingerprint": command_fingerprint}, f, sort_keys=True)
        except FileExistsError:
            existing = self._existing_result(path)
            if existing is not None:
                return existing
            raise

        try:
            proc = self.runner(argv, text=True, capture_output=True, timeout=self.config.timeout_seconds, check=False)
            if proc.returncode != 0:
                failure = {
                    "schema": "numina.provider-submission.v1",
                    "provider": "circle",
                    "adapter": "circle-agent-wallet-cli",
                    "environment": "testnet",
                    "handoff_id": handoff_id,
                    "intent_root": handoff.get("intent_root"),
                    "submission_attempted": True,
                    "external_execution_performed": False,
                    "provider_reported_state": "FAILED",
                    "network_verified_by_numina": False,
                    "command_fingerprint": command_fingerprint,
                    "error": (proc.stderr or proc.stdout or "circle cli failed")[:1000],
                }
                path.write_text(json.dumps({"status": "COMPLETED", "result": failure}, sort_keys=True))
                return failure
            provider_response = _safe_json(proc.stdout)
            data = provider_response.get("data") if isinstance(provider_response.get("data"), dict) else provider_response
            state = str(data.get("state") or "UNKNOWN").upper()
            tx_hash = data.get("txHash") or data.get("tx_hash")
            provider_id = data.get("id") or data.get("transactionId")
            confirmed = state in {"CONFIRMED", "COMPLETE", "COMPLETED"}
            result = {
                "schema": "numina.provider-submission.v1",
                "provider": "circle",
                "adapter": "circle-agent-wallet-cli",
                "environment": "testnet",
                "handoff_id": handoff_id,
                "intent_root": handoff.get("intent_root"),
                "control_decision_root": handoff.get("control_decision_root"),
                "submission_attempted": True,
                "external_execution_performed": confirmed,
                "provider_reported_state": state,
                "provider_transaction_id": provider_id,
                "tx_hash": tx_hash,
                "chain": intent["chain"],
                "amount": intent["amount"],
                "asset": "USDC",
                "command_fingerprint": command_fingerprint,
                "provider_response_root": digest(provider_response),
                "provider_response": provider_response,
                "network_verified_by_numina": False,
                "verification_status": "PROVIDER_REPORTED_CONFIRMED" if confirmed else "PROVIDER_RESPONSE_RECEIVED",
                "idempotent_replay": False,
            }
            path.write_text(json.dumps({"status": "COMPLETED", "result": result}, sort_keys=True))
            return result
        except Exception:
            # Keep an IN_PROGRESS tombstone so an ambiguous transport/process failure
            # cannot be retried automatically and accidentally duplicate a transfer.
            raise

    def reconcile(self, *, submission_receipt: dict, trusted_numina_public_key_b64: str) -> dict:
        if not self.config.enabled:
            raise ValueError("CIRCLE_TESTNET_SUBMISSION_DISABLED")
        if not verify_envelope(
            submission_receipt,
            expected_public_key_b64=trusted_numina_public_key_b64,
            expected_type=PROVIDER_SUBMISSION_TYPE,
        ):
            raise ValueError("PROVIDER_SUBMISSION_RECEIPT_INVALID")
        submission = dict(submission_receipt.get("payload") or {})
        if submission.get("provider") != "circle" or submission.get("environment") != "testnet":
            raise ValueError("CIRCLE_TESTNET_SUBMISSION_RECEIPT_REQUIRED")
        provider_response = dict(submission.get("provider_response") or {})
        data = provider_response.get("data") if isinstance(provider_response.get("data"), dict) else provider_response
        source = data.get("sourceAddress")
        chain = submission.get("chain")
        if not EVM_ADDRESS.fullmatch(str(source or "")):
            raise ValueError("CIRCLE_RECONCILIATION_SOURCE_UNAVAILABLE")
        cli = shutil.which(self.config.cli_path) if Path(self.config.cli_path).name == self.config.cli_path else self.config.cli_path
        if not cli or not Path(cli).exists():
            raise ValueError("CIRCLE_CLI_NOT_AVAILABLE")
        argv = [str(cli), "transaction", "list", "--address", str(source), "--chain", str(chain), "--output", "json"]
        proc = self.runner(argv, text=True, capture_output=True, timeout=self.config.timeout_seconds, check=False)
        if proc.returncode != 0:
            raise ValueError("CIRCLE_RECONCILIATION_QUERY_FAILED")
        response = _safe_json(proc.stdout)
        rows = response.get("data", response)
        if isinstance(rows, dict):
            rows = rows.get("transactions", [])
        if not isinstance(rows, list):
            rows = []
        wanted_id = submission.get("provider_transaction_id")
        wanted_hash = submission.get("tx_hash")
        match = None
        for row in rows:
            if not isinstance(row, dict):
                continue
            if wanted_id and row.get("id") == wanted_id:
                match = row; break
            if wanted_hash and (row.get("txHash") == wanted_hash or row.get("tx_hash") == wanted_hash):
                match = row; break
        state = str((match or {}).get("state") or "NOT_FOUND").upper()
        return {
            "schema": "numina.provider-reconciliation.v1",
            "provider": "circle",
            "environment": "testnet",
            "handoff_id": submission.get("handoff_id"),
            "provider_transaction_id": wanted_id,
            "tx_hash": wanted_hash,
            "provider_reported_state": state,
            "matched": match is not None,
            "provider_record_root": digest(match) if match else None,
            "provider_record": match,
            "network_verified_by_numina": False,
            "verification_status": "PROVIDER_RECONCILED_NOT_INDEPENDENT_RPC_VERIFIED" if match else "PROVIDER_RECORD_NOT_FOUND",
        }
