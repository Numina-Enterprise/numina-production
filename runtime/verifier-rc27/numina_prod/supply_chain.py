from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from urllib.parse import quote

from . import CORE_VERSION, PRODUCTION_VERSION
from .frozen import ROOT, verify_frozen_core

REPRODUCIBLE_EPOCH = int(os.getenv("SOURCE_DATE_EPOCH", "1788998400"))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _canonical_json(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _normalize_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _requirement_name(line: str) -> str | None:
    line = line.strip()
    if not line or line.startswith("#") or line.startswith("-"):
        return None
    m = re.match(r"([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?", line)
    return m.group(1) if m else None


def declared_requirements(path: Path | None = None, _seen: set[Path] | None = None) -> list[dict]:
    path = (path or ROOT / "requirements.production.txt").resolve()
    seen = _seen if _seen is not None else set()
    if path in seen:
        return []
    seen.add(path)
    out: list[dict] = []
    for raw in path.read_text().splitlines():
        line=raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(("-r ","--requirement ")):
            included=line.split(None,1)[1].strip()
            out.extend(declared_requirements(path.parent/included,seen))
            continue
        name = _requirement_name(line)
        if not name:
            continue
        out.append({"name": name, "normalized_name": _normalize_name(name), "requirement": line})
    # Deduplicate by normalized project name while preserving first declaration.
    unique={}
    for item in out:
        unique.setdefault(item["normalized_name"],item)
    return list(unique.values())


def observed_version(name: str) -> str | None:
    candidates = [name]
    if _normalize_name(name) == "sqlalchemy":
        candidates += ["SQLAlchemy"]
    if _normalize_name(name) == "prometheus-client":
        candidates += ["prometheus_client"]
    for candidate in candidates:
        try:
            return metadata.version(candidate)
        except metadata.PackageNotFoundError:
            pass
    return None


def dependency_inventory(path: Path | None = None) -> list[dict]:
    result = []
    for item in declared_requirements(path):
        version = observed_version(item["name"])
        result.append({**item, "observed_version": version, "observed": version is not None})
    return result


def _spdx_id(name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9.-]+", "-", name)
    return "SPDXRef-Package-" + safe


def build_spdx_sbom(*, build_id: str, production_files_root: str) -> dict:
    frozen = verify_frozen_core()
    created = datetime.fromtimestamp(REPRODUCIBLE_EPOCH, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    packages = [
        {
            "SPDXID": "SPDXRef-Package-NuminaProductionPlane",
            "name": "numina-production-plane",
            "versionInfo": PRODUCTION_VERSION,
            "downloadLocation": "NOASSERTION",
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": "NOASSERTION",
            "supplier": "Organization: Numina Labs",
            "externalRefs": [
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": f"pkg:generic/numina-production-plane@{quote(PRODUCTION_VERSION)}?build_id={build_id}",
                }
            ],
        },
        {
            "SPDXID": "SPDXRef-Package-NuminaCore",
            "name": "numina-core",
            "versionInfo": CORE_VERSION,
            "downloadLocation": "NOASSERTION",
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": "NOASSERTION",
            "supplier": "Organization: Numina Labs",
            "checksums": [{"algorithm": "SHA256", "checksumValue": frozen.manifest_root}],
        },
    ]
    relationships = [
        {
            "spdxElementId": "SPDXRef-Package-NuminaProductionPlane",
            "relationshipType": "DEPENDS_ON",
            "relatedSpdxElement": "SPDXRef-Package-NuminaCore",
        }
    ]

    for dep in dependency_inventory():
        pkg_id = _spdx_id(dep["normalized_name"])
        package = {
            "SPDXID": pkg_id,
            "name": dep["name"],
            "versionInfo": dep["observed_version"] or dep["requirement"],
            "downloadLocation": "NOASSERTION",
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": "NOASSERTION",
            "supplier": "NOASSERTION",
            "comment": (
                "Observed in the release-gate environment."
                if dep["observed"]
                else "Declared production dependency; not installed in this release-gate environment."
            ),
        }
        if dep["observed_version"]:
            package["externalRefs"] = [
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": f"pkg:pypi/{quote(dep['normalized_name'])}@{quote(dep['observed_version'])}",
                }
            ]
        packages.append(package)
        relationships.append(
            {
                "spdxElementId": "SPDXRef-Package-NuminaProductionPlane",
                "relationshipType": "DEPENDS_ON",
                "relatedSpdxElement": pkg_id,
            }
        )

    return {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"numina-production-plane-{PRODUCTION_VERSION}",
        "documentNamespace": f"urn:numina:spdx:{build_id}",
        "creationInfo": {
            "created": created,
            "creators": ["Tool: numina-prod/supply-chain"],
            "comment": "Reproducible SBOM metadata timestamp is controlled by SOURCE_DATE_EPOCH.",
        },
        "documentDescribes": ["SPDXRef-Package-NuminaProductionPlane"],
        "packages": packages,
        "relationships": relationships,
        "annotations": [
            {
                "annotationDate": created,
                "annotationType": "OTHER",
                "annotator": "Tool: numina-prod/supply-chain",
                "comment": f"production_files_root_sha256={production_files_root}",
            }
        ],
    }


def build_slsa_provenance(*, subject_name: str, subject_sha256: str, build_id: str, production_files_root: str) -> dict:
    frozen = verify_frozen_core()
    frozen_manifest = ROOT / "FROZEN-CORE-v1.8.sha256"
    prod_manifest = ROOT / "MANIFEST.production.sha256"
    deps = [
        {
            "uri": "urn:numina:frozen-core:v1.8",
            "digest": {"sha256": frozen.manifest_root},
        }
    ]
    for requirement_name in (
        "requirements.production.txt",
        "requirements.public-verifier.txt",
        "requirements.authority-node.txt",
    ):
        req=ROOT/requirement_name
        deps.append({
            "uri":f"file:{requirement_name}",
            "digest":{"sha256":sha256_file(req)},
        })
    if frozen_manifest.exists():
        deps.append({"uri": "file:FROZEN-CORE-v1.8.sha256", "digest": {"sha256": sha256_file(frozen_manifest)}})
    if prod_manifest.exists():
        deps.append({"uri": "file:MANIFEST.production.sha256", "digest": {"sha256": sha256_file(prod_manifest)}})

    return {
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{"name": subject_name, "digest": {"sha256": subject_sha256}}],
        "predicateType": "https://slsa.dev/provenance/v1",
        "predicate": {
            "buildDefinition": {
                "buildType": "urn:numina:build:production-plane:v1",
                "externalParameters": {
                    "coreVersion": CORE_VERSION,
                    "productionVersion": PRODUCTION_VERSION,
                    "buildId": build_id,
                    "sourceDateEpoch": REPRODUCIBLE_EPOCH,
                },
                "internalParameters": {
                    "productionFilesRoot": production_files_root,
                    "runtimeControlsConfigurable": True,
                    "defaultPublicExecutionApiEnabled": False,
                    "defaultRealFundsEnabled": False,
                    "defaultEmployerIpEnabled": False,
                },
                "resolvedDependencies": deps,
            },
            "runDetails": {
                "builder": {
                    "id": "urn:numina:builder:release-gate:v1",
                    "version": {"numina-production-plane": PRODUCTION_VERSION},
                },
                "metadata": {"invocationId": build_id},
            },
        },
    }


def write_supply_chain_artifacts(*, build_id: str, production_files_root: str) -> dict:
    artifacts = ROOT / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    sbom = build_spdx_sbom(build_id=build_id, production_files_root=production_files_root)
    sbom_path = artifacts / "software-bom.spdx.json"
    sbom_path.write_text(json.dumps(sbom, indent=2, sort_keys=True) + "\n")

    manifest_path = ROOT / "MANIFEST.production.sha256"
    subject_hash = sha256_file(manifest_path)
    provenance = build_slsa_provenance(
        subject_name="MANIFEST.production.sha256",
        subject_sha256=subject_hash,
        build_id=build_id,
        production_files_root=production_files_root,
    )
    provenance_path = artifacts / "build-provenance.intoto.json"
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")

    return {
        "spdx_sbom_sha256": sha256_file(sbom_path),
        "slsa_provenance_sha256": sha256_file(provenance_path),
        "slsa_predicate_type": "https://slsa.dev/provenance/v1",
        "slsa_level_claimed": None,
        "dependency_inventory": dependency_inventory(),
    }


def verify_supply_chain_artifacts(*, build_id: str, production_files_root: str) -> dict:
    artifacts = ROOT / "artifacts"
    sbom_path = artifacts / "software-bom.spdx.json"
    provenance_path = artifacts / "build-provenance.intoto.json"
    failures = []
    if not sbom_path.exists():
        failures.append("SBOM_MISSING")
    if not provenance_path.exists():
        failures.append("SLSA_PROVENANCE_MISSING")
    if failures:
        return {"valid": False, "failures": failures}

    try:
        sbom = json.loads(sbom_path.read_text())
        if sbom.get("spdxVersion") != "SPDX-2.3":
            failures.append("SBOM_FORMAT")
        if sbom.get("documentNamespace") != f"urn:numina:spdx:{build_id}":
            failures.append("SBOM_BUILD_BINDING")
    except Exception:
        failures.append("SBOM_INVALID_JSON")

    try:
        provenance = json.loads(provenance_path.read_text())
        if provenance.get("_type") != "https://in-toto.io/Statement/v1":
            failures.append("PROVENANCE_STATEMENT_TYPE")
        if provenance.get("predicateType") != "https://slsa.dev/provenance/v1":
            failures.append("PROVENANCE_PREDICATE_TYPE")
        params = provenance["predicate"]["buildDefinition"]["externalParameters"]
        internal = provenance["predicate"]["buildDefinition"]["internalParameters"]
        if params.get("buildId") != build_id:
            failures.append("PROVENANCE_BUILD_BINDING")
        if internal.get("productionFilesRoot") != production_files_root:
            failures.append("PROVENANCE_SOURCE_ROOT_BINDING")
        subject = provenance.get("subject", [])
        if len(subject) != 1 or subject[0].get("name") != "MANIFEST.production.sha256":
            failures.append("PROVENANCE_SUBJECT")
        elif subject[0].get("digest", {}).get("sha256") != sha256_file(ROOT / "MANIFEST.production.sha256"):
            failures.append("PROVENANCE_SUBJECT_DIGEST")
    except Exception:
        failures.append("PROVENANCE_INVALID_JSON")

    return {
        "valid": not failures,
        "failures": failures,
        "spdx_sbom_sha256": sha256_file(sbom_path),
        "slsa_provenance_sha256": sha256_file(provenance_path),
    }
