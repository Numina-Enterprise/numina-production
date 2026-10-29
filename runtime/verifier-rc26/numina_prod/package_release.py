from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from .frozen import ROOT
from .release import release_descriptor
from .signing import load_identity, verify_envelope
from .supply_chain import build_slsa_provenance, sha256_file

DEFAULT_EPOCH = int(os.getenv("SOURCE_DATE_EPOCH", "1788998400"))
EXCLUDED_PARTS = {"__pycache__", ".pytest_cache", ".git", "dist"}
EXCLUDED_SUFFIXES = {".pem", ".key", ".db", ".sqlite", ".sqlite3"}


def _iter_release_files():
    for f in sorted(ROOT.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(ROOT)
        if any(part in EXCLUDED_PARTS for part in rel.parts):
            continue
        if f.suffix.lower() in EXCLUDED_SUFFIXES:
            continue
        if f.name.startswith("numina-production-") and f.suffix == ".zip":
            continue
        yield f, rel


def _zip_datetime(epoch: int):
    epoch = max(epoch, 315532800)  # ZIP format starts at 1980-01-01.
    dt = datetime.fromtimestamp(epoch, tz=timezone.utc)
    return (dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second - (dt.second % 2))


def build_reproducible_zip(output: Path, *, epoch: int = DEFAULT_EPOCH) -> dict:
    output.parent.mkdir(parents=True, exist_ok=True)
    timestamp = _zip_datetime(epoch)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f, rel in _iter_release_files():
            info = zipfile.ZipInfo(str(rel).replace(os.sep, "/"), timestamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            mode = stat.S_IMODE(f.stat().st_mode)
            normalized_mode = 0o755 if (mode & 0o111) else 0o644
            info.external_attr = (normalized_mode & 0xFFFF) << 16
            z.writestr(info, f.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return {"path": str(output), "sha256": sha256_file(output), "bytes": output.stat().st_size}


def write_package_sidecars(output: Path, settings, *, signing_key: Path | None = None) -> dict:
    artifact_sha = sha256_file(output)
    descriptor = release_descriptor(settings)
    provenance = build_slsa_provenance(
        subject_name=output.name,
        subject_sha256=artifact_sha,
        build_id=descriptor["build_id"],
        production_files_root=descriptor["production_files_root"],
    )
    provenance_path = output.with_suffix(output.suffix + ".intoto.json")
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")

    checksum_path = output.with_suffix(output.suffix + ".sha256")
    checksum_path.write_text(f"{artifact_sha}  {output.name}\n")

    signed_path = None
    signed_valid = None
    if signing_key is not None:
        identity = load_identity(signing_key, allow_ephemeral=False)
        envelope = identity.sign(provenance, "NUMINA_RELEASE_ARTIFACT_PROVENANCE")
        signed_path = output.with_suffix(output.suffix + ".provenance.sig.json")
        signed_path.write_text(json.dumps(envelope, indent=2, sort_keys=True) + "\n")
        signed_valid = verify_envelope(
            envelope,
            expected_public_key_b64=identity.public_key_b64,
            expected_type="NUMINA_RELEASE_ARTIFACT_PROVENANCE",
        )

    return {
        "artifact_sha256": artifact_sha,
        "provenance_path": str(provenance_path),
        "provenance_sha256": sha256_file(provenance_path),
        "checksum_path": str(checksum_path),
        "signed_provenance_path": str(signed_path) if signed_path else None,
        "signed_provenance_valid": signed_valid,
    }


def main():
    from .config import load_settings
    p = argparse.ArgumentParser(prog="numina-package")
    p.add_argument("output", type=Path)
    p.add_argument("--signing-key", type=Path)
    args = p.parse_args()
    settings = load_settings()
    built = build_reproducible_zip(args.output)
    sidecars = write_package_sidecars(args.output, settings, signing_key=args.signing_key)
    print(json.dumps({**built, **sidecars}, indent=2))


if __name__ == "__main__":
    main()
