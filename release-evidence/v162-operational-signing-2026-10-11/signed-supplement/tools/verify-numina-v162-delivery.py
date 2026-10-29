#!/usr/bin/env python3
"""Verify the exact public version 162 delivery ZIP; no signing or private access.

Supply request and inventory SHA-256 pins independently. Detached .sig64 files
contain exactly 64 raw signature bytes. The binary site archive is authenticated
by its directly signed SHA-256 commitment, not a direct binary signature.
Requires the public cryptography package. No proof compilation is performed.
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
from types import SimpleNamespace
import stat
import sys
import tarfile
import tempfile
import zipfile

PUBLIC_HEX = "f29ec679836c6889ef87d41b842bfd2236004c1a6d84d4bac0814cae45a90c28"
PUBLIC_SHA256 = "b217cc5bae08acbfdb9f8cd20f420f0bee2ae39fb6f0b178ce060284c76f8e9f"
PUBLIC_VERIFIER = "tools/verify-exact-numina-delivery.py"
PUBLIC_VERIFIER_SHA256 = "ac1c9e2a5bee287012113dc44ae75392d6b3a3b86b7cb5cd188a90546fa518bd"
ARCHIVE_PATH = "artifacts/numina-cloud-site-delivery.tar.gz"
ARCHIVE_SHA256 = "7c0276be32c7a830dadb7bdf8f67ff0138c38db422dee949e4314760f1d4b792"
ARCHIVE_BYTES = 39983201
RECEIPT = "operational-signing-receipt.json"
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_ZIP_BYTES = 256 * 1024 * 1024
MAX_TAR_BYTES = 512 * 1024 * 1024


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
    p = PurePosixPath(value)
    require(not p.is_absolute() and ".." not in p.parts and "\\" not in value
            and str(p) == value and value != ".", "Unsafe or nonliteral path")
    return value


def pairs_without_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON member")
        result[key] = value
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


def run(args):
    require(sha_value(args.request_sha256) and sha_value(args.inventory_sha256),
            "Independent request and inventory SHA-256 pins are required")
    source = Path(args.zip)
    require(source.is_file() and not source.is_symlink(), "ZIP must be a regular file")
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    public = bytes.fromhex(PUBLIC_HEX)
    require(len(public) == 32 and digest(public) == PUBLIC_SHA256, "Fixed public pin differs")
    key = Ed25519PublicKey.from_public_bytes(public)
    with zipfile.ZipFile(source) as outer, tempfile.TemporaryDirectory(prefix="numina-v162-public-") as directory:
        entries = outer.infolist()
        require(len(entries) <= 30000, "Excessive ZIP members")
        names = set()
        file_names = set()
        directory_names = set()
        total = 0
        for entry in entries:
            require(entry.orig_filename == entry.filename, "ZIP filename was truncated")
            name = safe_path(entry.filename[:-1] if entry.is_dir() else entry.filename)
            require(name not in names, "Duplicate ZIP member")
            names.add(name)
            mode = entry.external_attr >> 16
            kind = stat.S_IFMT(mode)
            require(not entry.flag_bits & 1, "Encrypted ZIP member")
            require(kind in ({0, stat.S_IFDIR} if entry.is_dir() else {0, stat.S_IFREG}),
                    "ZIP links and special files are forbidden")
            require(name == "signed-documents" or name.startswith("signed-documents/")
                    or name == "artifacts" or name == ARCHIVE_PATH, "Unlisted outer scope")
            require(entry.file_size <= MAX_FILE_BYTES, "ZIP member exceeds byte boundary")
            total += entry.file_size
            require(total <= MAX_ZIP_BYTES, "ZIP exceeds public delivery byte boundary")
            (directory_names if entry.is_dir() else file_names).add(name)

        def inner(name):
            path = "signed-documents/" + name
            require(path in file_names, "Required delivery file is missing")
            return outer.read(path)

        request_raw = inner("request.json")
        require(digest(request_raw) == args.request_sha256, "Request differs from independent pin")
        request = json_bytes(request_raw)
        require(isinstance(request, dict) and set(request) == {
            "schema", "purpose", "public_key_sha256", "inventory_sha256",
            "whole_protocol_correctness_established", "independent_stream_acceptance_established", "targets"},
            "Unexpected request schema fields")
        require(request["schema"] == "numina.exact-delivery-signing-request.v1"
                and request["public_key_sha256"] == PUBLIC_SHA256
                and request["inventory_sha256"] == args.inventory_sha256
                and request["whole_protocol_correctness_established"] is False
                and request["independent_stream_acceptance_established"] is False,
                "Request identity or scope differs")
        require(isinstance(request["targets"], list) and 2 <= len(request["targets"]) <= 10000,
                "Invalid target count")
        messages = {}
        for row in request["targets"]:
            require(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256", "message_base64"},
                    "Invalid target row")
            name = safe_path(row["path"])
            require(name not in messages and name not in {RECEIPT, "request.json", "signing-result.json", "signatures"}
                    and not name.startswith("signatures/"), "Duplicate or reserved target")
            require(type(row["bytes"]) is int and 0 <= row["bytes"] <= MAX_FILE_BYTES
                    and sha_value(row["sha256"]), "Invalid target identity")
            message = decode64(row["message_base64"])
            require(len(message) == row["bytes"] and digest(message) == row["sha256"]
                    and inner(name) == message, "Exact target bytes differ")
            messages[name] = message
        require({"inventory.json", "SHA256SUMS", "archive-commitment.json", PUBLIC_VERIFIER} <= set(messages),
                "Missing required signed verifier, inventory or archive commitment")
        require(digest(messages["inventory.json"]) == args.inventory_sha256, "Inventory pin differs")
        require(digest(messages[PUBLIC_VERIFIER]) == PUBLIC_VERIFIER_SHA256,
                "Existing public verifier differs from independent source pin")
        result = json_bytes(inner("signing-result.json"))
        require(isinstance(result, dict) and result.get("request_sha256") == args.request_sha256
                and result.get("inventory_sha256") == args.inventory_sha256
                and result.get("public_key_sha256") == PUBLIC_SHA256
                and decode64(result.get("public_key_base64")) == public, "Signing result pins differ")
        receipt_raw = decode64(result.get("receipt_base64"))
        require(inner(RECEIPT) == receipt_raw, "Delivered receipt differs from result")
        messages[RECEIPT] = receipt_raw
        signatures = result.get("signatures")
        require(isinstance(signatures, list) and len(signatures) == len(messages), "Signature coverage differs")
        seen = set()
        for row in signatures:
            require(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256", "signature_base64", "verified"},
                    "Invalid signature row")
            name = row["path"]
            require(isinstance(name, str) and name in messages and name not in seen,
                    "Duplicate or unlisted signature")
            message = messages[name]
            require(type(row["bytes"]) is int and row["bytes"] == len(message)
                    and row["sha256"] == digest(message) and row["verified"] is True,
                    "Signature identity differs")
            signature = decode64(row["signature_base64"])
            require(len(signature) == 64
                    and inner("signatures/" + name + ".ed25519.sig64") == signature,
                    "Detached signature must equal exactly 64 raw bytes")
            key.verify(signature, message)
            seen.add(name)
        require(seen == set(messages), "Incomplete signature coverage")
        expected_files = {"signed-documents/" + name for name in messages}
        expected_files |= {"signed-documents/signatures/" + name + ".ed25519.sig64" for name in messages}
        expected_files |= {"signed-documents/request.json", "signed-documents/signing-result.json", ARCHIVE_PATH}
        require(file_names == expected_files, "Missing or unlisted outer file")
        expected_dirs = {str(parent) for name in expected_files for parent in PurePosixPath(name).parents
                         if str(parent) != "."}
        require(directory_names <= expected_dirs, "Unlisted empty outer directory")
        require(not expected_files.intersection(expected_dirs), "File/parent path collision")
        commitment = json_bytes(messages["archive-commitment.json"])
        require(isinstance(commitment, dict) and set(commitment) == {"schema", "archive", "regular_members"}
                and commitment["schema"] == "numina.v162-archive-commitment.v1", "Invalid archive commitment schema")
        artifact = commitment["archive"]
        require(isinstance(artifact, dict) and set(artifact) == {"path", "bytes", "sha256"}
                and artifact["path"] == ARCHIVE_PATH and type(artifact["bytes"]) is int
                and artifact["bytes"] == ARCHIVE_BYTES and artifact["sha256"] == ARCHIVE_SHA256,
                "Archive commitment differs from final version 162 gzip identity")
        require(isinstance(commitment["regular_members"], list)
                and len(commitment["regular_members"]) == 366, "Final archive member count differs")
        expected_members = {}
        for row in commitment["regular_members"]:
            require(isinstance(row, dict) and set(row) == {"archive_member", "bytes", "sha256"},
                    "Invalid archive member row")
            name = safe_path(row["archive_member"])
            require(name.startswith("dist/") and name not in expected_members
                    and type(row["bytes"]) is int and 0 <= row["bytes"] <= MAX_TAR_BYTES
                    and sha_value(row["sha256"]), "Invalid or duplicate archive member identity")
            expected_members[name] = row
        require(sum(row["bytes"] for row in expected_members.values()) <= MAX_TAR_BYTES,
                "Archive members exceed byte boundary")
        with outer.open(ARCHIVE_PATH) as handle:
            count, actual_hash = stream_identity(handle, artifact["bytes"])
        require(count == artifact["bytes"] and actual_hash == artifact["sha256"], "Binary archive differs from signed commitment")
        destination = Path(directory)
        for name in sorted(file_names):
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with outer.open(name) as handle, path.open("xb") as output:
                while True:
                    chunk = handle.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
        # Code may execute only after its independent source hash AND actual
        # fixed-public-key detached signature have both passed above.
        module_path = destination / "signed-documents" / PUBLIC_VERIFIER
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location("signed_numina_public_verifier", module_path)
        require(spec is not None and spec.loader is not None, "Signed verifier cannot be loaded")
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            verifier.run(SimpleNamespace(request=str(destination / "signed-documents/request.json"),
                         result=str(destination / "signed-documents/signing-result.json"),
                         request_sha256=args.request_sha256, inventory_sha256=args.inventory_sha256,
                         delivery_root=str(destination / "signed-documents")))
        public_verification = json.loads(captured.getvalue())
        require(public_verification.get("status") == "PASS", "Inner public verification did not pass")
        tar_names = set()
        regular_names = set()
        with tarfile.open(destination / ARCHIVE_PATH, "r:gz") as archive:
            for member in archive:
                name = safe_path(member.name.rstrip("/") if member.isdir() else member.name)
                require(name == "dist" or name.startswith("dist/"), "Unsafe archive root")
                require(name not in tar_names and (member.isdir() or member.isfile()),
                        "Duplicate archive member, link or special file")
                tar_names.add(name)
                if member.isfile():
                    require(name in expected_members, "Unlisted binary archive member")
                    expected = expected_members[name]
                    require(member.size == expected["bytes"], "Archive member size differs")
                    with archive.extractfile(member) as handle:
                        member_bytes, member_hash = stream_identity(handle, expected["bytes"])
                    require(member_bytes == expected["bytes"] and member_hash == expected["sha256"],
                            "Archive member differs from signed commitment")
                    regular_names.add(name)
        require(regular_names == set(expected_members), "Missing committed archive member")
    with source.open("rb") as handle:
        zip_bytes, zip_sha256 = stream_identity(handle, MAX_ZIP_BYTES)
    print(json.dumps({"status": "PASS", "zip_bytes": zip_bytes, "zip_sha256": zip_sha256,
                      "exact_outer_file_count": len(file_names), "archive_regular_members_verified": len(regular_names),
                      "archive_sha256": actual_hash, "archive_signature_mode": "Signed SHA-256 commitment; no direct binary signature",
                      "public_key_sha256": PUBLIC_SHA256, "inner_verification": public_verification,
                      "provider_storage_tar_independently_verified": False,
                      "whole_protocol_correctness_established": False,
                      "independent_stream_acceptance_established": False}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", help="Exact completed public outer ZIP")
    parser.add_argument("--request-sha256", required=True)
    parser.add_argument("--inventory-sha256", required=True)
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
