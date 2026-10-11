#!/usr/bin/env python3
"""Public-only verification of an exact Numina request and signing result.

This checks exact document, inventory, checksum and receipt bytes against the
retained operational public key. It does not access signing custody or compile
proofs. The request and inventory hashes are required independent inputs.
"""
import argparse
import base64
from datetime import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

PUBLIC_HEX = "f29ec679836c6889ef87d41b842bfd2236004c1a6d84d4bac0814cae45a90c28"
PUBLIC_SHA256 = "b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f"
WORKFLOW_SHA256 = "25648a798550743fe2788532e56f4823e4d7b5c90d7f50cc3023528c12175709"
RECEIPT_PATH = "operational-signing-receipt.json"
MAX_REQUEST_BYTES = 64 * 1024 * 1024


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sha256_value(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def safe_path(value):
    require(isinstance(value, str) and value and value.strip() == value, "Invalid delivery path")
    require(not any(ord(c) < 32 or ord(c) == 127 for c in value), "Control character in delivery path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in value
            and str(path) == value and value != ".", "Delivery path is not a literal relative POSIX file path")
    require(value not in {RECEIPT_PATH, "signing-result.json", "request.json", "signatures"}
            and not value.startswith("signatures/"), "Reserved signing-output path")
    return value


def object_without_duplicates(pairs):
    result = {}
    for name, value in pairs:
        require(name not in result, "Duplicate JSON object member")
        result[name] = value
    return result


def json_bytes(data):
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=object_without_duplicates,
                          parse_constant=lambda _: (_ for _ in ()).throw(VerificationError("Invalid JSON number")))
    except (ValueError, UnicodeError):
        raise VerificationError("Input is not strict UTF-8 JSON") from None


def decode_base64(value):
    require(isinstance(value, str), "Base64 value must be a string")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, UnicodeError):
        raise VerificationError("Invalid base64") from None
    require(base64.b64encode(raw).decode("ascii") == value, "Base64 is not canonical")
    return raw


def run(args):
    require(sha256_value(args.request_sha256) and sha256_value(args.inventory_sha256), "Supply literal independent SHA-256 pins")
    request_path = Path(args.request)
    result_path = Path(args.result)
    require(request_path.is_file() and not request_path.is_symlink()
            and request_path.stat().st_size <= MAX_REQUEST_BYTES, "Missing regular request or request byte limit exceeded")
    request_bytes = request_path.read_bytes()
    require(digest(request_bytes) == args.request_sha256, "Request differs from independent SHA-256 pin")
    request = json_bytes(request_bytes)
    require(isinstance(request, dict) and set(request) == {"schema", "purpose", "public_key_sha256", "inventory_sha256",
            "whole_protocol_correctness_established", "independent_stream_acceptance_established", "targets"},
            "Unexpected or missing request field")
    require(request["schema"] == "numina.exact-delivery-signing-request.v1", "Unsupported request schema")
    require(isinstance(request["purpose"], str) and request["purpose"].strip(), "Missing signing purpose")
    require(request["public_key_sha256"] == PUBLIC_SHA256 and request["inventory_sha256"] == args.inventory_sha256,
            "Request public or inventory pin differs")
    require(request["whole_protocol_correctness_established"] is False
            and request["independent_stream_acceptance_established"] is False,
            "Operational signatures do not establish protocol or editorial acceptance")
    require(isinstance(request["targets"], list) and 2 <= len(request["targets"]) <= 10000, "Invalid explicit target list")
    messages = {}
    for row in request["targets"]:
        require(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256", "message_base64"}, "Invalid target record")
        name = safe_path(row["path"])
        require(name not in messages, "Duplicate target path")
        require(type(row["bytes"]) is int and row["bytes"] >= 0 and sha256_value(row["sha256"]), "Invalid target identity")
        message = decode_base64(row["message_base64"])
        require(len(message) == row["bytes"] and digest(message) == row["sha256"], "Exact target bytes differ")
        messages[name] = message
    require("inventory.json" in messages and "SHA256SUMS" in messages, "Missing inventory or checksum list")
    require(digest(messages["inventory.json"]) == args.inventory_sha256, "Exact inventory bytes differ from pin")
    inventory = json_bytes(messages["inventory.json"])
    require(isinstance(inventory, dict) and set(inventory) == {"schema", "public_key_sha256", "files"}
            and inventory["schema"] == "numina.exact-delivery-inventory.v1"
            and inventory["public_key_sha256"] == PUBLIC_SHA256 and isinstance(inventory["files"], list), "Invalid pinned inventory")
    names = set()
    lines = []
    for row in inventory["files"]:
        require(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256"}, "Invalid inventory row")
        name = safe_path(row["path"])
        require(name not in names and name not in {"inventory.json", "SHA256SUMS"}, "Duplicate or circular inventory row")
        require(type(row["bytes"]) is int and row["bytes"] >= 0 and sha256_value(row["sha256"]), "Invalid inventory identity")
        require(name in messages and len(messages[name]) == row["bytes"] and digest(messages[name]) == row["sha256"],
                "Inventory file does not match signed request bytes")
        names.add(name)
        lines.append(row["sha256"] + "  " + name + "\n")
    require(set(messages) == names | {"inventory.json", "SHA256SUMS"}, "Missing or unlisted target")
    for name in messages:
        require(not any(str(parent) in messages for parent in PurePosixPath(name).parents if str(parent) != "."),
                "File path conflicts with another target's parent directory")
    expected_checksum = ("".join(lines) + args.inventory_sha256 + "  inventory.json\n").encode("utf-8")
    require(messages["SHA256SUMS"] == expected_checksum, "Literal checksum list differs")
    require(messages.get("operational-ed25519-public.raw32", bytes.fromhex(PUBLIC_HEX)) == bytes.fromhex(PUBLIC_HEX),
            "Delivered public key differs from established raw32 pin")
    require(result_path.is_file() and not result_path.is_symlink(), "Missing regular signing result")
    result = json_bytes(result_path.read_bytes())
    require(isinstance(result, dict) and set(result) == {"schema", "status", "request_sha256", "inventory_sha256",
            "public_key_base64", "public_key_sha256", "receipt_base64", "new_signatures", "signatures", "private_key_exported"},
            "Unexpected or missing signing result field")
    require(result["schema"] == "numina.exact-delivery-signing-result.v1" and result["status"] == "PASS", "Signing result is not complete")
    require(result["request_sha256"] == args.request_sha256 and result["inventory_sha256"] == args.inventory_sha256
            and result["public_key_sha256"] == PUBLIC_SHA256 and result["private_key_exported"] is False, "Signing result binding differs")
    public = decode_base64(result["public_key_base64"])
    require(public == bytes.fromhex(PUBLIC_HEX) and digest(public) == PUBLIC_SHA256, "Signing result substitutes public identity")
    receipt_bytes = decode_base64(result["receipt_base64"])
    receipt = json_bytes(receipt_bytes)
    require(isinstance(receipt, dict) and receipt.get("schema") == "numina.exact-delivery-operational-signing-receipt.v1",
            "Invalid signed receipt schema")
    require(receipt.get("purpose") == request["purpose"] and receipt.get("request_sha256") == args.request_sha256
            and receipt.get("inventory_sha256") == args.inventory_sha256 and receipt.get("public_key_sha256") == PUBLIC_SHA256
            and receipt.get("workflow_sha256") == WORKFLOW_SHA256, "Signed receipt binding differs")
    require(receipt.get("algorithm") == "pure Ed25519"
            and receipt.get("framing") == "Exact full-file bytes; no canonicalization or prehash", "Receipt signature framing differs")
    require(receipt.get("whole_protocol_correctness_established") is False
            and receipt.get("independent_stream_acceptance_established") is False
            and receipt.get("key_generated_or_rotated") is False and receipt.get("private_key_exported") is False
            and receipt.get("custody_mutated") is False and receipt.get("existing_workflow_unchanged") is True,
            "Signed receipt scope differs")
    timestamp = datetime.fromisoformat(receipt["signed_at_utc"])
    require(timestamp.utcoffset() is not None and timestamp.utcoffset().total_seconds() == 0, "Receipt date must include UTC offset")
    expected_documents = [{"path": name, "bytes": len(message), "sha256": digest(message)} for name, message in messages.items()]
    require(receipt.get("documents") == expected_documents, "Receipt document inventory differs from exact request")
    messages[RECEIPT_PATH] = receipt_bytes
    delivered_files_checked = 0
    if args.delivery_root is not None:
        delivery_root = Path(args.delivery_root)
        require(delivery_root.is_dir() and not delivery_root.is_symlink(), "Delivery root must be a regular directory")
        for name, message in messages.items():
            path = delivery_root / name
            require(not any((delivery_root / str(parent)).is_symlink()
                            for parent in PurePosixPath(name).parents if str(parent) != ".")
                    and not path.is_symlink() and path.is_file(), "Delivery file is missing or uses a symbolic link")
            require(path.read_bytes() == message, "Delivered file differs from exact signed request bytes")
            delivered_files_checked += 1
    signatures = result["signatures"]
    require(isinstance(signatures, list) and len(signatures) == len(messages)
            and type(result["new_signatures"]) is int and result["new_signatures"] == len(messages), "Signature coverage count differs")
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    key = Ed25519PublicKey.from_public_bytes(public)
    seen = set()
    for row in signatures:
        require(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256", "signature_base64", "verified"}, "Invalid signature record")
        name = row["path"]
        require(isinstance(name, str) and name in messages and name not in seen, "Missing, duplicate or unlisted signature target")
        message = messages[name]
        require(type(row["bytes"]) is int and row["bytes"] == len(message)
                and row["sha256"] == digest(message) and row["verified"] is True, "Signature record exact identity differs")
        signature = decode_base64(row["signature_base64"])
        require(len(signature) == 64, "Detached Ed25519 signature must be exactly 64 bytes")
        key.verify(signature, message)
        seen.add(name)
    require(seen == set(messages), "Incomplete direct signature coverage")
    print(json.dumps({"status": "PASS", "signatures_verified": len(seen), "delivered_file_bytes_checked": delivered_files_checked,
                      "request_sha256": args.request_sha256,
                      "inventory_sha256": args.inventory_sha256, "public_key_sha256": PUBLIC_SHA256,
                      "receipt_sha256": digest(receipt_bytes), "signed_at_utc": receipt["signed_at_utc"],
                      "whole_protocol_correctness_established": False, "independent_stream_acceptance_established": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--request-sha256", required=True)
    parser.add_argument("--inventory-sha256", required=True)
    parser.add_argument("--delivery-root", help="Optional directory whose actual target and receipt bytes must match")
    args = parser.parse_args()
    try:
        run(args)
    except VerificationError as error:
        print(json.dumps({"status": "FAIL", "reason": str(error)}))
        return 1
    except Exception as error:
        print(json.dumps({"status": "FAIL", "exception_type": type(error).__name__}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
