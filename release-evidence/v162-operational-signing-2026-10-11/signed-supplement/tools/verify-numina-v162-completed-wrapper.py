#!/usr/bin/env python3
"""Verify the completed public Numina v162 delivery and signed supplement.

The four request/inventory SHA-256 arguments are independent trust inputs.
Detached .sig64 files contain exactly 64 raw Ed25519 signature bytes. The
supplement's signed commitment authenticates the preserved primary ZIP bytes;
the independently pinned primary request authenticates its original contents.
Requires cryptography. No signing, proof compilation or private access occurs.
"""
import argparse
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
from types import SimpleNamespace
import zipfile

PUBLIC_HEX = "f29ec679836c6889ef87d41b842bfd2236004c1a6d84d4bac0814cae45a90c28"
PUBLIC_SHA256 = "b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f"
EXACT_VERIFIER = "tools/verify-exact-numina-delivery.py"
EXACT_VERIFIER_SHA256 = "ac1c9e2a5bee287012113dc44ae75392d6b3a3b86b7cb5cd188a90546fa518bd"
PRIMARY_VERIFIER = "tools/verify-numina-v162-delivery.py"
PRIMARY_VERIFIER_SHA256 = "064cb32e19520247d10de1f73a1323358ddf21e69fa8bffed6771c2eaf8168e0"
PRIMARY_PATH = "package/numina-v162-signed-package.zip"
RECEIPT = "operational-signing-receipt.json"
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_WRAPPER_BYTES = 256 * 1024 * 1024


class DeliveryError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise DeliveryError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sha_value(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def safe_path(value):
    require(isinstance(value, str) and value and value.strip() == value,
            "Invalid literal path")
    require(not any(ord(c) < 32 or ord(c) == 127 for c in value),
            "Control character in path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in value
            and str(path) == value and value != ".", "Unsafe or nonliteral path")
    return value


def pairs_without_duplicates(pairs):
    result = {}
    for name, value in pairs:
        require(name not in result, "Duplicate JSON member")
        result[name] = value
    return result


def json_bytes(data):
    return json.loads(data.decode("utf-8"), object_pairs_hook=pairs_without_duplicates,
                      parse_constant=lambda _: (_ for _ in ()).throw(DeliveryError("Invalid JSON number")))


def decode64(value):
    require(isinstance(value, str), "Base64 must be text")
    raw = base64.b64decode(value, validate=True)
    require(base64.b64encode(raw).decode("ascii") == value, "Noncanonical base64")
    return raw


def stream_identity(handle, maximum):
    value = hashlib.sha256()
    count = 0
    while True:
        chunk = handle.read(1024 * 1024)
        if not chunk:
            return count, value.hexdigest()
        count += len(chunk)
        require(count <= maximum, "Stream exceeds declared byte boundary")
        value.update(chunk)


def load_signed_module(path, name):
    # Call only after exact source pin and detached signature have passed.
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, "Signed verifier cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def captured_run(module, arguments):
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        module.run(arguments)
    result = json.loads(captured.getvalue())
    require(result.get("status") == "PASS", "Nested public verification did not pass")
    return result


def run(args):
    pins = [args.supplement_request_sha256, args.supplement_inventory_sha256,
            args.primary_request_sha256, args.primary_inventory_sha256]
    require(all(sha_value(pin) for pin in pins), "Four independent SHA-256 pins are required")
    source = Path(args.wrapper)
    require(source.is_file() and not source.is_symlink(), "Wrapper must be a regular ZIP file")
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    public = bytes.fromhex(PUBLIC_HEX)
    require(len(public) == 32 and digest(public) == PUBLIC_SHA256, "Fixed public pin differs")
    key = Ed25519PublicKey.from_public_bytes(public)
    with zipfile.ZipFile(source) as wrapper, tempfile.TemporaryDirectory(prefix="numina-v162-wrapper-public-") as directory:
        entries = wrapper.infolist()
        require(len(entries) <= 30000, "Excessive wrapper members")
        names = set()
        file_names = set()
        directory_names = set()
        total = 0
        for entry in entries:
            require(entry.orig_filename == entry.filename, "ZIP filename was truncated")
            name = safe_path(entry.filename[:-1] if entry.is_dir() else entry.filename)
            require(name not in names, "Duplicate wrapper member")
            names.add(name)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            require(not entry.flag_bits & 1, "Encrypted wrapper member")
            require(kind in ({0, stat.S_IFDIR} if entry.is_dir() else {0, stat.S_IFREG}),
                    "Wrapper links and special files are forbidden")
            require(name == "signed-supplement" or name.startswith("signed-supplement/")
                    or name == "package" or name == PRIMARY_PATH, "Unlisted wrapper scope")
            require(entry.file_size <= MAX_FILE_BYTES, "Wrapper member exceeds byte boundary")
            total += entry.file_size
            require(total <= MAX_WRAPPER_BYTES, "Wrapper exceeds public delivery byte boundary")
            (directory_names if entry.is_dir() else file_names).add(name)

        def supplement(name):
            path = "signed-supplement/" + name
            require(path in file_names, "Required supplemental file is missing")
            return wrapper.read(path)

        request_raw = supplement("request.json")
        require(digest(request_raw) == args.supplement_request_sha256,
                "Supplement request differs from independent pin")
        request = json_bytes(request_raw)
        require(isinstance(request, dict) and set(request) == {
            "schema", "purpose", "public_key_sha256", "inventory_sha256",
            "whole_protocol_correctness_established", "independent_stream_acceptance_established", "targets"},
            "Unexpected supplemental request fields")
        require(request["schema"] == "numina.exact-delivery-signing-request.v1"
                and request["public_key_sha256"] == PUBLIC_SHA256
                and request["inventory_sha256"] == args.supplement_inventory_sha256
                and request["whole_protocol_correctness_established"] is False
                and request["independent_stream_acceptance_established"] is False,
                "Supplemental request identity or scope differs")
        require(isinstance(request["targets"], list) and 2 <= len(request["targets"]) <= 10000,
                "Invalid supplemental target count")
        messages = {}
        for row in request["targets"]:
            require(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256", "message_base64"},
                    "Invalid supplemental target row")
            name = safe_path(row["path"])
            require(name not in messages and name not in {RECEIPT, "request.json", "signing-result.json", "signatures"}
                    and not name.startswith("signatures/"), "Duplicate or reserved supplemental target")
            require(type(row["bytes"]) is int and 0 <= row["bytes"] <= MAX_FILE_BYTES
                    and sha_value(row["sha256"]), "Invalid supplemental target identity")
            message = decode64(row["message_base64"])
            require(len(message) == row["bytes"] and digest(message) == row["sha256"]
                    and supplement(name) == message, "Exact supplemental target bytes differ")
            messages[name] = message
        require({"inventory.json", "SHA256SUMS", "package-commitment.json", EXACT_VERIFIER, PRIMARY_VERIFIER}
                <= set(messages), "Missing required signed supplemental verifier, inventory or package commitment")
        require(digest(messages["inventory.json"]) == args.supplement_inventory_sha256,
                "Supplemental inventory pin differs")
        require(digest(messages[EXACT_VERIFIER]) == EXACT_VERIFIER_SHA256
                and digest(messages[PRIMARY_VERIFIER]) == PRIMARY_VERIFIER_SHA256,
                "Signed verifier source differs from independent literal pin")
        result = json_bytes(supplement("signing-result.json"))
        require(isinstance(result, dict) and result.get("request_sha256") == args.supplement_request_sha256
                and result.get("inventory_sha256") == args.supplement_inventory_sha256
                and result.get("public_key_sha256") == PUBLIC_SHA256
                and decode64(result.get("public_key_base64")) == public,
                "Supplemental signing result pins differ")
        receipt_raw = decode64(result.get("receipt_base64"))
        require(supplement(RECEIPT) == receipt_raw, "Supplemental receipt differs from result")
        messages[RECEIPT] = receipt_raw
        signatures = result.get("signatures")
        require(isinstance(signatures, list) and len(signatures) == len(messages),
                "Supplemental signature coverage differs")
        seen = set()
        for row in signatures:
            require(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256", "signature_base64", "verified"},
                    "Invalid supplemental signature row")
            name = row["path"]
            require(isinstance(name, str) and name in messages and name not in seen,
                    "Duplicate or unlisted supplemental signature")
            message = messages[name]
            require(type(row["bytes"]) is int and row["bytes"] == len(message)
                    and row["sha256"] == digest(message) and row["verified"] is True,
                    "Supplemental signature identity differs")
            signature = decode64(row["signature_base64"])
            require(len(signature) == 64
                    and supplement("signatures/" + name + ".ed25519.sig64") == signature,
                    "Supplemental detached signature must equal exactly 64 raw bytes")
            key.verify(signature, message)
            seen.add(name)
        require(seen == set(messages), "Incomplete supplemental signature coverage")
        expected_files = {"signed-supplement/" + name for name in messages}
        expected_files |= {"signed-supplement/signatures/" + name + ".ed25519.sig64" for name in messages}
        expected_files |= {"signed-supplement/request.json", "signed-supplement/signing-result.json", PRIMARY_PATH}
        require(file_names == expected_files, "Missing or unlisted completed-wrapper file")
        expected_dirs = {str(parent) for name in expected_files for parent in PurePosixPath(name).parents
                         if str(parent) != "."}
        require(directory_names <= expected_dirs, "Unlisted empty wrapper directory")
        require(not expected_files.intersection(expected_dirs), "Wrapper file/parent path collision")
        commitment = json_bytes(messages["package-commitment.json"])
        require(isinstance(commitment, dict) and set(commitment) == {
            "schema", "package", "primary_request_sha256", "primary_inventory_sha256"}
                and commitment["schema"] == "numina.v162-package-commitment.v1",
                "Invalid primary-package commitment schema")
        require(commitment["primary_request_sha256"] == args.primary_request_sha256
                and commitment["primary_inventory_sha256"] == args.primary_inventory_sha256,
                "Primary-package commitment differs from independent request/inventory pins")
        package = commitment["package"]
        require(isinstance(package, dict) and set(package) == {"path", "bytes", "sha256"}
                and package["path"] == PRIMARY_PATH and type(package["bytes"]) is int
                and 0 < package["bytes"] <= MAX_FILE_BYTES and sha_value(package["sha256"]),
                "Invalid committed primary-package identity")
        with wrapper.open(PRIMARY_PATH) as handle:
            primary_bytes, primary_sha256 = stream_identity(handle, package["bytes"])
        require(primary_bytes == package["bytes"] and primary_sha256 == package["sha256"],
                "Preserved primary ZIP differs from signed supplemental commitment")
        destination = Path(directory)
        for name in sorted(file_names):
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            # Every source member was checked as regular. Only the primary ZIP
            # file is copied here; its entries are handled by its signed verifier.
            with wrapper.open(name) as handle, path.open("xb") as output:
                while True:
                    chunk = handle.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
        supplemental_root = destination / "signed-supplement"
        exact_verifier = load_signed_module(supplemental_root / EXACT_VERIFIER,
                                           "signed_numina_supplement_exact_verifier")
        supplement_verification = captured_run(exact_verifier, SimpleNamespace(
            request=str(supplemental_root / "request.json"), result=str(supplemental_root / "signing-result.json"),
            request_sha256=args.supplement_request_sha256, inventory_sha256=args.supplement_inventory_sha256,
            delivery_root=str(supplemental_root)))
        primary_verifier = load_signed_module(supplemental_root / PRIMARY_VERIFIER,
                                             "signed_numina_primary_outer_verifier")
        primary_verification = captured_run(primary_verifier, SimpleNamespace(
            zip=str(destination / PRIMARY_PATH), request_sha256=args.primary_request_sha256,
            inventory_sha256=args.primary_inventory_sha256))
    with source.open("rb") as handle:
        wrapper_bytes, wrapper_sha256 = stream_identity(handle, MAX_WRAPPER_BYTES)
    print(json.dumps({"status": "PASS", "wrapper_bytes": wrapper_bytes, "wrapper_sha256": wrapper_sha256,
                      "exact_outer_file_count": len(file_names), "primary_package_bytes": primary_bytes,
                      "primary_package_sha256": primary_sha256, "primary_package_preserved_exactly": True,
                      "package_signature_mode": "Signed SHA-256 commitment; no direct primary-ZIP binary signature",
                      "public_key_sha256": PUBLIC_SHA256, "supplement_verification": supplement_verification,
                      "primary_verification": primary_verification, "provider_storage_tar_independently_verified": False,
                      "whole_protocol_correctness_established": False,
                      "independent_stream_acceptance_established": False}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wrapper", help="Exact completed public wrapper ZIP")
    parser.add_argument("--supplement-request-sha256", required=True)
    parser.add_argument("--supplement-inventory-sha256", required=True)
    parser.add_argument("--primary-request-sha256", required=True)
    parser.add_argument("--primary-inventory-sha256", required=True)
    args = parser.parse_args()
    try:
        run(args)
    except DeliveryError as error:
        print(json.dumps({"status": "FAIL", "reason": str(error)}))
        return 1
    except Exception as error:
        print(json.dumps({"status": "FAIL", "exception_type": type(error).__name__}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
