from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
import re
from typing import Callable
from urllib import request

from .execution_adapters import (
    CONTROL_DECISION_TYPE,
    EXECUTION_HANDOFF_TYPE,
    digest,
)
from .circle_agent_adapter import PROVIDER_SUBMISSION_TYPE
from .signing import verify_envelope

EXECUTION_VERIFIED_TYPE = "NUMINA_EXECUTION_VERIFIED"
EVM_ADDRESS = re.compile(r"^0x[a-fA-F0-9]{40}$")
TX_HASH = re.compile(r"^0x[a-fA-F0-9]{64}$")
ERC20_TRANSFER_SELECTOR = "a9059cbb"
ARC_TESTNET_CHAIN_ID = 5_042_002
ARC_TESTNET_USDC_SYSTEM_CONTRACT = "0x3600000000000000000000000000000000000000"


def _canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _normalize_address(value: object) -> str:
    text = str(value or "")
    if not EVM_ADDRESS.fullmatch(text):
        raise ValueError("ARC_RPC_ADDRESS_INVALID")
    return text.lower()


def _hex_int(value: object, error: str) -> int:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise ValueError(error)
    try:
        return int(value, 16)
    except ValueError as exc:
        raise ValueError(error) from exc


def _amount_decimal(raw: int, decimals: int) -> Decimal:
    return Decimal(raw) / (Decimal(10) ** decimals)


def _normalized_amount(value: object) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("EXECUTION_INTENT_AMOUNT_INVALID") from exc
    if not amount.is_finite() or amount <= 0:
        raise ValueError("EXECUTION_INTENT_AMOUNT_INVALID")
    return amount.normalize()


def _default_rpc_transport(url: str, method: str, params: list, timeout_seconds: int) -> object:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            value = json.loads(response.read().decode())
    except Exception as exc:
        raise ValueError("ARC_RPC_TRANSPORT_FAILED") from exc
    if not isinstance(value, dict):
        raise ValueError("ARC_RPC_RESPONSE_INVALID")
    if value.get("error") is not None:
        raise ValueError("ARC_RPC_RETURNED_ERROR")
    if "result" not in value:
        raise ValueError("ARC_RPC_RESULT_MISSING")
    return value["result"]


@dataclass(frozen=True)
class ArcVerificationConfig:
    enabled: bool
    rpc_urls: tuple[str, ...]
    rpc_quorum: int
    timeout_seconds: int
    chain_id: int = ARC_TESTNET_CHAIN_ID
    usdc_system_contract: str = ARC_TESTNET_USDC_SYSTEM_CONTRACT
    native_usdc_decimals: int = 18
    erc20_usdc_decimals: int = 6
    required_confirmations: int = 1


class ArcExternalVerifier:
    """Independent, read-only Arc settlement verifier.

    Provider claims are never used as settlement truth. The verifier reconstructs
    transaction facts from configured Arc RPC endpoints, requires a quorum of
    matching observations, and compares those facts with the signed Numina control
    decision + execution handoff before a NUMINA_EXECUTION_VERIFIED receipt may be
    emitted by the service layer.
    """

    def __init__(
        self,
        config: ArcVerificationConfig,
        *,
        transport: Callable[[str, str, list, int], object] | None = None,
    ):
        self.config = config
        self.transport = transport or _default_rpc_transport

    def capability(self) -> dict:
        return {
            "verifier": "arc-json-rpc-quorum",
            "environment": "testnet",
            "enabled": bool(self.config.enabled),
            "chain_id": self.config.chain_id,
            "configured_rpc_endpoints": len(self.config.rpc_urls),
            "required_rpc_quorum": self.config.rpc_quorum,
            "required_confirmations": self.config.required_confirmations,
            "asset": "USDC",
            "usdc_system_contract": self.config.usdc_system_contract.lower(),
            "writes_to_chain": False,
            "trust_model": "provider receipt is input evidence only; settlement is reconstructed from independent RPC observations",
        }

    def _rpc(self, url: str, method: str, params: list) -> object:
        return self.transport(url, method, params, self.config.timeout_seconds)

    def _validate_receipts(
        self,
        *,
        control_receipt: dict,
        handoff_receipt: dict,
        submission_receipt: dict,
        trusted_numina_public_key_b64: str,
    ) -> tuple[dict, dict, dict]:
        if not verify_envelope(
            control_receipt,
            expected_public_key_b64=trusted_numina_public_key_b64,
            expected_type=CONTROL_DECISION_TYPE,
        ):
            raise ValueError("CONTROL_DECISION_RECEIPT_INVALID")
        if not verify_envelope(
            handoff_receipt,
            expected_public_key_b64=trusted_numina_public_key_b64,
            expected_type=EXECUTION_HANDOFF_TYPE,
        ):
            raise ValueError("EXECUTION_HANDOFF_RECEIPT_INVALID")
        if not verify_envelope(
            submission_receipt,
            expected_public_key_b64=trusted_numina_public_key_b64,
            expected_type=PROVIDER_SUBMISSION_TYPE,
        ):
            raise ValueError("PROVIDER_SUBMISSION_RECEIPT_INVALID")

        control = dict(control_receipt.get("payload") or {})
        handoff = dict(handoff_receipt.get("payload") or {})
        submission = dict(submission_receipt.get("payload") or {})
        if handoff.get("control_decision_receipt_root") != digest(control_receipt):
            raise ValueError("CONTROL_DECISION_HANDOFF_BINDING_MISMATCH")
        if not handoff.get("execution_permitted") or handoff.get("status") != "READY_FOR_PROVIDER_SUBMISSION":
            raise ValueError("EXECUTION_HANDOFF_NOT_AUTHORIZED")
        if submission.get("handoff_id") != handoff.get("handoff_id"):
            raise ValueError("SUBMISSION_HANDOFF_BINDING_MISMATCH")
        if submission.get("intent_root") != handoff.get("intent_root"):
            raise ValueError("SUBMISSION_INTENT_BINDING_MISMATCH")
        if submission.get("provider") != "circle" or submission.get("environment") != "testnet":
            raise ValueError("CIRCLE_TESTNET_SUBMISSION_RECEIPT_REQUIRED")
        if str(submission.get("chain") or "").upper() != "ARC-TESTNET":
            raise ValueError("ARC_TESTNET_SUBMISSION_REQUIRED")
        tx_hash = str(submission.get("tx_hash") or "")
        if not TX_HASH.fullmatch(tx_hash):
            raise ValueError("ARC_TRANSACTION_HASH_REQUIRED")
        return control, handoff, submission

    def _decode_transfer(self, tx: dict) -> dict:
        source = _normalize_address(tx.get("from"))
        tx_to = _normalize_address(tx.get("to"))
        input_data = str(tx.get("input") or "0x").lower()
        value_raw = _hex_int(tx.get("value") or "0x0", "ARC_TRANSACTION_VALUE_INVALID")
        usdc_contract = self.config.usdc_system_contract.lower()

        # Circle may represent Arc USDC as the network-native asset. In that shape,
        # the transaction destination is the recipient and `value` carries the amount.
        if input_data in {"", "0x", "0x0"} and value_raw > 0:
            return {
                "source_address": source,
                "destination": tx_to,
                "asset": "USDC",
                "asset_contract": usdc_contract,
                "transfer_mode": "native-usdc",
                "amount": format(_amount_decimal(value_raw, self.config.native_usdc_decimals).normalize(), "f"),
                "raw_amount": str(value_raw),
                "asset_decimals": self.config.native_usdc_decimals,
            }

        # Also support a standard ERC-20 transfer through Arc's USDC system contract.
        data = input_data[2:] if input_data.startswith("0x") else input_data
        if tx_to == usdc_contract and data.startswith(ERC20_TRANSFER_SELECTOR) and len(data) >= 8 + 64 + 64:
            destination_word = data[8:72]
            amount_word = data[72:136]
            destination = "0x" + destination_word[-40:]
            raw_amount = int(amount_word, 16)
            return {
                "source_address": source,
                "destination": _normalize_address(destination),
                "asset": "USDC",
                "asset_contract": usdc_contract,
                "transfer_mode": "erc20-transfer",
                "amount": format(_amount_decimal(raw_amount, self.config.erc20_usdc_decimals).normalize(), "f"),
                "raw_amount": str(raw_amount),
                "asset_decimals": self.config.erc20_usdc_decimals,
            }
        raise ValueError("ARC_TRANSACTION_IS_NOT_SUPPORTED_USDC_TRANSFER")

    def _observe(self, url: str, tx_hash: str) -> dict:
        chain_id = _hex_int(self._rpc(url, "eth_chainId", []), "ARC_CHAIN_ID_INVALID")
        if chain_id != self.config.chain_id:
            raise ValueError("ARC_CHAIN_ID_MISMATCH")
        tx = self._rpc(url, "eth_getTransactionByHash", [tx_hash])
        receipt = self._rpc(url, "eth_getTransactionReceipt", [tx_hash])
        head = _hex_int(self._rpc(url, "eth_blockNumber", []), "ARC_BLOCK_NUMBER_INVALID")
        if not isinstance(tx, dict) or not isinstance(receipt, dict):
            raise ValueError("ARC_TRANSACTION_NOT_INCLUDED")
        if str(tx.get("hash") or "").lower() != tx_hash.lower():
            raise ValueError("ARC_TRANSACTION_HASH_MISMATCH")
        if str(receipt.get("transactionHash") or "").lower() != tx_hash.lower():
            raise ValueError("ARC_RECEIPT_HASH_MISMATCH")
        tx_block = _hex_int(tx.get("blockNumber"), "ARC_TRANSACTION_NOT_INCLUDED")
        receipt_block = _hex_int(receipt.get("blockNumber"), "ARC_RECEIPT_BLOCK_INVALID")
        if tx_block != receipt_block:
            raise ValueError("ARC_TRANSACTION_RECEIPT_BLOCK_MISMATCH")
        status = _hex_int(receipt.get("status"), "ARC_RECEIPT_STATUS_INVALID")
        confirmations = max(0, head - receipt_block + 1)
        transfer = self._decode_transfer(tx)
        facts = {
            "chain_id": chain_id,
            "tx_hash": tx_hash.lower(),
            "block_number": receipt_block,
            "status": status,
            **transfer,
        }
        return {
            "facts": facts,
            "fact_root": digest(facts),
            "head_block": head,
            "confirmations": confirmations,
            "rpc_endpoint_id": sha256(url.encode()).hexdigest()[:16],
        }

    def verify(
        self,
        *,
        control_receipt: dict,
        handoff_receipt: dict,
        submission_receipt: dict,
        trusted_numina_public_key_b64: str,
    ) -> dict:
        if not self.config.enabled:
            raise ValueError("ARC_INDEPENDENT_VERIFICATION_DISABLED")
        if not self.config.rpc_urls:
            raise ValueError("ARC_RPC_ENDPOINT_REQUIRED")
        if self.config.rpc_quorum < 1 or self.config.rpc_quorum > len(self.config.rpc_urls):
            raise ValueError("ARC_RPC_QUORUM_INVALID")

        control, handoff, submission = self._validate_receipts(
            control_receipt=control_receipt,
            handoff_receipt=handoff_receipt,
            submission_receipt=submission_receipt,
            trusted_numina_public_key_b64=trusted_numina_public_key_b64,
        )
        tx_hash = str(submission["tx_hash"])
        observations: list[dict] = []
        failures: list[dict] = []
        for url in self.config.rpc_urls:
            endpoint_id = sha256(url.encode()).hexdigest()[:16]
            try:
                observations.append(self._observe(url, tx_hash))
            except Exception as exc:
                failures.append({"rpc_endpoint_id": endpoint_id, "error": str(exc)[:160]})

        groups: dict[str, list[dict]] = {}
        for observation in observations:
            groups.setdefault(observation["fact_root"], []).append(observation)
        winner = max(groups.values(), key=len) if groups else []
        if len(winner) < self.config.rpc_quorum:
            raise ValueError("ARC_RPC_QUORUM_NOT_REACHED")

        facts = dict(winner[0]["facts"])
        intent = dict(handoff.get("intent") or {})
        expected_source = _normalize_address(intent.get("source_address"))
        expected_destination = _normalize_address(intent.get("destination"))
        expected_amount = _normalized_amount(intent.get("amount"))
        observed_amount = _normalized_amount(facts.get("amount"))
        if facts["source_address"] != expected_source:
            raise ValueError("ARC_SOURCE_ADDRESS_MISMATCH")
        if facts["destination"] != expected_destination:
            raise ValueError("ARC_DESTINATION_ADDRESS_MISMATCH")
        if str(intent.get("asset") or "").upper() != "USDC" or facts["asset"] != "USDC":
            raise ValueError("ARC_ASSET_MISMATCH")
        if observed_amount != expected_amount:
            raise ValueError("ARC_AMOUNT_MISMATCH")
        if facts["status"] != 1:
            raise ValueError("ARC_TRANSACTION_REVERTED")

        confirmations = min(x["confirmations"] for x in winner)
        if confirmations < self.config.required_confirmations:
            raise ValueError("ARC_CONFIRMATIONS_INSUFFICIENT")

        verification = {
            "schema": "numina.execution-verification.v1",
            "release": "1.9.0-rc27",
            "verification_status": "NUMINA_EXECUTION_VERIFIED",
            "network": "ARC-TESTNET",
            "chain_id": self.config.chain_id,
            "provider": "circle",
            "handoff_id": handoff.get("handoff_id"),
            "tx_hash": tx_hash.lower(),
            "intent_root": handoff.get("intent_root"),
            "control_decision_root": handoff.get("control_decision_root"),
            "control_receipt_root": digest(control_receipt),
            "handoff_receipt_root": digest(handoff_receipt),
            "provider_submission_receipt_root": digest(submission_receipt),
            "provider_response_root": submission.get("provider_response_root"),
            "independent_network_fact_root": winner[0]["fact_root"],
            "settled_facts": facts,
            "confirmations": confirmations,
            "required_confirmations": self.config.required_confirmations,
            "rpc_quorum": len(winner),
            "required_rpc_quorum": self.config.rpc_quorum,
            "rpc_endpoint_ids": sorted(x["rpc_endpoint_id"] for x in winner),
            "rpc_failures": failures,
            "provider_claim_used_as_settlement_truth": False,
            "external_network_verified_by_numina": True,
        }
        verification["verification_root"] = digest(verification)
        return verification
