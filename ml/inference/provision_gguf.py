#!/usr/bin/env python3
"""Provision an approved GGUF checkpoint into a gitignored local model cache.

Only explicit HTTPS URLs and operator-provided SHA-256 are accepted. This is a
reproducible provisioner, not an endorsement of any checkpoint or license.
"""
import argparse
import hashlib
import json
import os
import struct
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

def validate_gguf(path):
    with Path(path).open("rb") as stream:
        header = stream.read(24)
    if len(header) < 24 or header[:4] != b"GGUF":
        raise ValueError("not a GGUF file")
    version = struct.unpack("<I", header[4:8])[0]
    tensors, metadata = struct.unpack("<QQ", header[8:24])
    if version not in (2, 3) or tensors < 1 or metadata < 1:
        raise ValueError("unsupported or implausible GGUF header")
    return {"version": version, "tensor_count": tensors, "metadata_count": metadata}

def provision(url, expected_sha256, destination, *, max_bytes=2_000_000_000):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("model URL must be an HTTPS URL without embedded credentials")
    if len(expected_sha256) != 64 or any(c not in "0123456789abcdef" for c in expected_sha256.lower()):
        raise ValueError("expected SHA-256 must be 64 hexadecimal characters")
    destination = Path(destination)
    if destination.suffix.lower() != ".gguf":
        raise ValueError("destination must end in .gguf")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError("refusing to overwrite an existing model")
    digest = hashlib.sha256()
    count = 0
    fd, temp_name = tempfile.mkstemp(prefix=".gguf-", dir=str(destination.parent))
    try:
        with os.fdopen(fd, "wb") as output:
            # Redirects are disabled to prevent redirecting an approved host.
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, headers, newurl):
                    raise ValueError("redirect refused; use the canonical HTTPS artifact URL")
            opener = urllib.request.build_opener(NoRedirect)
            with opener.open(urllib.request.Request(url, headers={"User-Agent": "numina-gguf-provision/1"}), timeout=45) as response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > max_bytes:
                        raise ValueError("model exceeds size limit")
                    digest.update(chunk)
                    output.write(chunk)
        actual = digest.hexdigest()
        if actual.lower() != expected_sha256.lower():
            raise ValueError("GGUF SHA-256 mismatch")
        header = validate_gguf(temp_name)
        os.replace(temp_name, destination)
        return {"schema_id": "numina.gguf-provision.v1", "model_path": str(destination),
                "sha256": actual, "bytes": count, "gguf_header": header,
                "evidence": "artifact_integrity_only_not_inference"}
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--sha256", required=True)
    p.add_argument("--output", default="ml/models/local/model.gguf")
    p.add_argument("--receipt", default="ml/models/local/provision-receipt.json")
    args = p.parse_args()
    receipt = provision(args.url, args.sha256, args.output)
    Path(args.receipt).parent.mkdir(parents=True, exist_ok=True)
    Path(args.receipt).write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print("Verified GGUF checkpoint provisioned; inference NOT executed.")

if __name__ == "__main__":
    main()
