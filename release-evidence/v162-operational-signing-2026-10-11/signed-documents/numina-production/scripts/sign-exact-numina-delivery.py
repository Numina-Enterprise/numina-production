#!/usr/bin/env python3
"""Sign a frozen public delivery with the retained Numina operational key.

The request and inventory hashes must be supplied independently on the command
line. Only the existing Mac workflow reads its existing Keychain item. This
adapter creates a new receipt and never changes an earlier delivery.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import resource
import sys

PUBLIC_SHA256 = "b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f"
PUBLIC_HEX = "f29ec679836c6889ef87d41b842bfd2236004c1a6d84d4bac0814cae45a90c28"
WORKFLOW = Path("/Users/samuelkott/Library/Application Support/PairWireSigning/operational_ed25519.py")
WORKFLOW_SHA256 = "25648a798550743fe2788532e56f4823e4d7b5c90d7f50cc3023528c12175709"
DEPENDENCIES = "/private/tmp/numina-final-document-signing-ldb2ir2_/public-dependencies"
RECEIPT_PATH = "operational-signing-receipt.json"
MAX_REQUEST_BYTES = 64 * 1024 * 1024


class DeliveryError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise DeliveryError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sha256_value(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def safe_path(value):
    require(isinstance(value, str) and value and value.strip() == value, "Invalid target path")
    require(not any(ord(c) < 32 or ord(c) == 127 for c in value), "Control character in target path")
    p = PurePosixPath(value)
    require(not p.is_absolute() and ".." not in p.parts and "\\" not in value,
            "Target path must be a relative POSIX file path")
    require(str(p) == value and value != ".", "Target path is not literal and normalized")
    require(value not in {RECEIPT_PATH, "signing-result.json", "request.json", "signatures"}
            and not value.startswith("signatures/"), "Reserved signing-output path in inventory")
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
                          parse_constant=lambda _: (_ for _ in ()).throw(DeliveryError("Invalid JSON number")))
    except (ValueError, UnicodeError):
        raise DeliveryError("Input is not strict UTF-8 JSON") from None


def read_public_request(stage, request_sha256, inventory_sha256):
    request_path = stage / "request.json"
    require(request_path.is_file() and not request_path.is_symlink(), "Missing regular request.json")
    require(request_path.stat().st_size <= MAX_REQUEST_BYTES, "Public request exceeds byte limit")
    raw = request_path.read_bytes()
    require(digest(raw) == request_sha256, "Request differs from independent SHA-256 pin")
    request = json_bytes(raw)
    require(isinstance(request, dict), "Request must be an object")
    require(set(request) == {"schema", "purpose", "public_key_sha256", "inventory_sha256",
                             "whole_protocol_correctness_established", "independent_stream_acceptance_established",
                             "targets"}, "Unexpected or missing request field")
    require(request["schema"] == "numina.exact-delivery-signing-request.v1", "Unsupported request schema")
    require(isinstance(request["purpose"], str) and request["purpose"].strip(), "Missing signing purpose")
    require(request["public_key_sha256"] == PUBLIC_SHA256, "Request substitutes the established operational public pin")
    require(request["inventory_sha256"] == inventory_sha256, "Inventory differs from independent SHA-256 pin")
    require(request["whole_protocol_correctness_established"] is False
            and request["independent_stream_acceptance_established"] is False,
            "This operational signing event does not establish protocol or editorial acceptance")
    targets = request["targets"]
    require(isinstance(targets, list) and 2 <= len(targets) <= 10000, "Invalid explicit target list")
    messages = {}
    for row in targets:
        require(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256", "message_base64"},
                "Unexpected or missing target field")
        name = safe_path(row["path"])
        require(name not in messages, "Duplicate target path")
        require(type(row["bytes"]) is int and row["bytes"] >= 0 and sha256_value(row["sha256"]),
                "Invalid target byte count or SHA-256")
        require(isinstance(row["message_base64"], str), "Target message must be base64 text")
        try:
            message = base64.b64decode(row["message_base64"], validate=True)
        except (ValueError, UnicodeError):
            raise DeliveryError("Invalid target base64") from None
        require(base64.b64encode(message).decode("ascii") == row["message_base64"],
                "Target base64 is not canonical")
        require(len(message) == row["bytes"] and digest(message) == row["sha256"],
                "Target differs from its exact byte count or SHA-256")
        messages[name] = message
    require("inventory.json" in messages and "SHA256SUMS" in messages, "Missing inventory or literal checksum list")
    require(digest(messages["inventory.json"]) == inventory_sha256, "Inventory bytes differ from pin")
    inventory = json_bytes(messages["inventory.json"])
    require(isinstance(inventory, dict)
            and set(inventory) == {"schema", "public_key_sha256", "files"}
            and inventory["schema"] == "numina.exact-delivery-inventory.v1"
            and inventory["public_key_sha256"] == PUBLIC_SHA256, "Invalid exact delivery inventory or public pin")
    require(isinstance(inventory["files"], list), "Inventory files must be an array")
    names = set()
    lines = []
    for row in inventory["files"]:
        require(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256"}, "Invalid inventory entry")
        name = safe_path(row["path"])
        require(name not in {"inventory.json", "SHA256SUMS"} and name not in names,
                "Inventory has a duplicate or circular entry")
        require(type(row["bytes"]) is int and row["bytes"] >= 0 and sha256_value(row["sha256"]),
                "Invalid inventory byte count or SHA-256")
        require(name in messages and len(messages[name]) == row["bytes"]
                and digest(messages[name]) == row["sha256"], "Inventory file differs from its exact target")
        names.add(name)
        lines.append(row["sha256"] + "  " + name + "\n")
    require(set(messages) == names | {"inventory.json", "SHA256SUMS"}, "Missing or unlisted signing target")
    for name in messages:
        require(not any(str(parent) in messages for parent in PurePosixPath(name).parents if str(parent) != "."),
                "File path conflicts with another target's parent directory")
    expected_checksum = ("".join(lines) + inventory_sha256 + "  inventory.json\n").encode("utf-8")
    require(messages["SHA256SUMS"] == expected_checksum, "Literal checksum list differs from exact inventory")
    require(messages.get("operational-ed25519-public.raw32", bytes.fromhex(PUBLIC_HEX)) == bytes.fromhex(PUBLIC_HEX),
            "Delivered public key differs from established raw32 pin")
    return request, messages


def run(args):
    sys.dont_write_bytecode = True
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    require(sha256_value(args.request_sha256) and sha256_value(args.inventory_sha256), "Supply literal independent SHA-256 pins")
    stage = Path(args.stage)
    require(stage.is_dir() and not stage.is_symlink(), "Stage must be an existing regular directory")
    output = stage / "signing-result.json"
    receipt_output = stage / RECEIPT_PATH
    require(not output.exists() and not output.is_symlink()
            and not receipt_output.exists() and not receipt_output.is_symlink(),
            "Use a fresh stage; signing outputs already exist")
    request, messages = read_public_request(stage, args.request_sha256, args.inventory_sha256)
    require(WORKFLOW.is_file() and not WORKFLOW.is_symlink()
            and digest(WORKFLOW.read_bytes()) == WORKFLOW_SHA256, "Established operational workflow differs or is unavailable")
    reference = WORKFLOW.parent / "operational-ed25519-custody.json"
    require(reference.is_file() and not reference.is_symlink(), "Established custody reference is unavailable")
    info = json_bytes(reference.read_bytes())
    require(info.get("service") == "org.pairwire.operational.ed25519"
            and info.get("account") == "sam-operational-07da8c7f-d325-46d7-a734-1cc20ab6325b"
            and info.get("public_key", {}).get("fingerprint_hex") == PUBLIC_SHA256
            and info.get("public_key", {}).get("hex") == PUBLIC_HEX,
            "Established custody reference does not match the retained signer")
    sys.path.insert(0, args.dependencies)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    import cryptography
    spec = importlib.util.spec_from_file_location("retained_numina_operational_signer", WORKFLOW)
    require(spec is not None and spec.loader is not None, "Existing workflow cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    require(digest(WORKFLOW.read_bytes()) == WORKFLOW_SHA256, "Existing workflow changed during loading")
    store = module.LocalKeychain()
    require(str(store.path) == info.get("keychain_path"), "Existing Keychain location differs from retained reference")
    seed = store.read(info["service"], info["account"])
    require(isinstance(seed, bytes) and len(seed) == 32, "Existing signer returned an invalid seed length")
    key = Ed25519PrivateKey.from_private_bytes(seed)
    del seed
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    require(public.hex() == PUBLIC_HEX and digest(public) == PUBLIC_SHA256, "Existing private signer does not match the established public pin")
    signatures = []

    def sign_exact(name, message):
        signature = key.sign(message)
        key.public_key().verify(signature, message)
        signatures.append({"path": name, "bytes": len(message), "sha256": digest(message),
                           "signature_base64": base64.b64encode(signature).decode("ascii"), "verified": True})

    for name, message in messages.items():
        sign_exact(name, message)
    receipt = {"schema": "numina.exact-delivery-operational-signing-receipt.v1",
               "signed_at_utc": datetime.now(timezone.utc).isoformat(), "purpose": request["purpose"],
               "algorithm": "pure Ed25519", "framing": "Exact full-file bytes; no canonicalization or prehash",
               "public_key_sha256": PUBLIC_SHA256, "request_sha256": args.request_sha256,
               "inventory_sha256": args.inventory_sha256, "workflow_sha256": WORKFLOW_SHA256,
               "whole_protocol_correctness_established": False, "independent_stream_acceptance_established": False,
               "existing_workflow_unchanged": True, "key_generated_or_rotated": False,
               "private_key_exported": False, "custody_mutated": False, "memory_zeroization_guaranteed": False,
               "python_version": sys.version, "cryptography_version": cryptography.__version__,
               "documents": [{"path": row["path"], "bytes": row["bytes"], "sha256": row["sha256"]} for row in signatures]}
    receipt_bytes = (json.dumps(receipt, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    sign_exact(RECEIPT_PATH, receipt_bytes)
    del key
    result = {"schema": "numina.exact-delivery-signing-result.v1", "status": "PASS",
              "request_sha256": args.request_sha256, "inventory_sha256": args.inventory_sha256,
              "public_key_base64": base64.b64encode(public).decode("ascii"), "public_key_sha256": PUBLIC_SHA256,
              "receipt_base64": base64.b64encode(receipt_bytes).decode("ascii"),
              "new_signatures": len(signatures), "signatures": signatures, "private_key_exported": False}
    with receipt_output.open("xb") as handle:
        handle.write(receipt_bytes)
    with output.open("x", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")
    print(json.dumps({"status": "PASS", "new_signatures": len(signatures),
                      "result_path": str(output), "receipt_path": str(receipt_output), "private_key_exported": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", help="Fresh directory containing exact request.json")
    parser.add_argument("--request-sha256", required=True)
    parser.add_argument("--inventory-sha256", required=True)
    parser.add_argument("--dependencies", default=DEPENDENCIES, help="Existing public Python dependencies directory")
    args = parser.parse_args()
    try:
        run(args)
    except DeliveryError as error:
        print(json.dumps({"status": "BLOCKED", "reason": str(error)}))
        return 1
    except Exception as error:
        print(json.dumps({"status": "BLOCKED", "exception_type": type(error).__name__,
                          "reason": "The existing signing workflow could not complete; no substitute signer was used."}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
