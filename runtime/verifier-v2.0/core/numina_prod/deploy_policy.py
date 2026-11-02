from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from urllib.parse import urlparse

from .deploy_provider import DeployError, DeploySpec, verify_sidecars
from .signing import verify_envelope
from .supply_chain import sha256_file


@dataclass(frozen=True)
class DeployAdmissionPolicy:
    policy_id: str
    allowed_roles: tuple[str, ...] = ("public-verifier",)
    allowed_environments: tuple[str, ...] = ("production",)
    allowed_providers: tuple[str, ...] = ("docker","oci","kubernetes","k8s","https","remote")
    allowed_targets: tuple[str, ...] = ()
    allowed_public_domains: tuple[str, ...] = ()
    accepted_predicate_types: tuple[str, ...] = ("https://slsa.dev/provenance/v1",)
    accepted_builder_ids: tuple[str, ...] = ("urn:numina:builder:release-gate:v1",)
    require_sbom: bool = True
    expected_sbom_sha256: str | None = None
    require_persistent_signing_key: bool = True
    minimum_hosted_attestations: int = 0
    accepted_attestation_identities: tuple[str, ...] = ()
    accepted_attestation_oidc_issuers: tuple[str, ...] = ()
    require_transparency_log: bool = True
    hosted_attestation_backend: str = "reference"
    allow_reference_attestation_in_production: bool = False
    hosted_attestation_backend: str = "reference"
    allow_reference_attestation_in_production: bool = False

    def digest(self) -> str:
        raw=json.dumps(asdict(self),sort_keys=True,separators=(",",":")).encode()
        return hashlib.sha256(raw).hexdigest()

    @classmethod
    def from_json(cls,path:Path)->"DeployAdmissionPolicy":
        data=json.loads(path.read_text())
        for k in ("allowed_roles","allowed_environments","allowed_providers","allowed_targets",
                  "allowed_public_domains","accepted_predicate_types","accepted_builder_ids",
                  "accepted_attestation_identities","accepted_attestation_oidc_issuers"):
            if k in data:
                data[k]=tuple(data[k])
        return cls(**data)


@dataclass(frozen=True)
class AdmissionDecision:
    allowed: bool
    policy_id: str
    policy_digest: str
    reasons: tuple[str,...]
    evidence: dict


def _builder_id(provenance:dict)->str|None:
    try:
        return provenance["predicate"]["runDetails"]["builder"]["id"]
    except Exception:
        return None


def _domain(url:str|None)->str|None:
    if not url:
        return None
    try:
        return (urlparse(url).hostname or "").lower() or None
    except Exception:
        return None


def evaluate_admission(
    spec:DeploySpec,
    policy:DeployAdmissionPolicy,
    *,
    signing_key_persistent:bool,
    hosted_attestation_count:int=0,
    hosted_attestation_paths: tuple[str,...]=(),
)->AdmissionDecision:
    reasons=[]
    evidence={}
    try:
        verified=verify_sidecars(spec)
        evidence.update(verified)
    except DeployError as e:
        reasons.append(str(e))
        return AdmissionDecision(False,policy.policy_id,policy.digest(),tuple(reasons),evidence)

    if spec.role not in policy.allowed_roles:
        reasons.append("ROLE_NOT_ALLOWED")
    if spec.environment not in policy.allowed_environments:
        reasons.append("ENVIRONMENT_NOT_ALLOWED")
    if spec.provider not in policy.allowed_providers:
        reasons.append("PROVIDER_NOT_ALLOWED")
    if policy.allowed_targets and spec.target not in policy.allowed_targets:
        reasons.append("TARGET_NOT_ALLOWED")

    domain=_domain(spec.public_url)
    if policy.allowed_public_domains:
        if not domain or domain not in {x.lower() for x in policy.allowed_public_domains}:
            reasons.append("PUBLIC_DOMAIN_NOT_ALLOWED")

    artifact=Path(spec.artifact)
    provenance_path=artifact.with_suffix(artifact.suffix+".intoto.json")
    provenance=json.loads(provenance_path.read_text())
    predicate_type=provenance.get("predicateType")
    builder_id=_builder_id(provenance)
    evidence["predicate_type"]=predicate_type
    evidence["builder_id"]=builder_id

    if predicate_type not in policy.accepted_predicate_types:
        reasons.append("PROVENANCE_PREDICATE_NOT_ALLOWED")
    if policy.accepted_builder_ids and builder_id not in policy.accepted_builder_ids:
        reasons.append("BUILDER_NOT_ALLOWED")

    if policy.require_sbom:
        sbom=artifact.parent/"software-bom.spdx.json"
        if not sbom.exists():
            # packaged release may carry SBOM internally; local operator copy may use sidecar.
            internal_sbom=Path(spec.metadata.get("sbom_path","")) if spec.metadata else Path("")
            sbom=internal_sbom if str(internal_sbom) else sbom
        if not sbom.exists():
            reasons.append("SBOM_MISSING")
        else:
            digest=sha256_file(sbom)
            evidence["sbom_sha256"]=digest
            if policy.expected_sbom_sha256 and digest!=policy.expected_sbom_sha256:
                reasons.append("SBOM_DIGEST_MISMATCH")

    if policy.require_persistent_signing_key and not signing_key_persistent:
        reasons.append("PERSISTENT_SIGNING_KEY_REQUIRED")

    verified_attestations=[]
    attestation_backend=policy.hosted_attestation_backend.strip().lower()
    evidence["hosted_attestation_backend"]=attestation_backend

    if (
        spec.environment=="production"
        and policy.minimum_hosted_attestations > 0
        and attestation_backend=="reference"
        and not policy.allow_reference_attestation_in_production
    ):
        reasons.append("REFERENCE_ATTESTATION_BACKEND_FORBIDDEN_IN_PRODUCTION")

    evidence["caller_reported_hosted_attestation_count"]=hosted_attestation_count
    effective_hosted_attestation_count=0

    if hosted_attestation_paths:
        from .hosted_attestation import verifier_for_backend, verify_bundle_files
        try:
            verifier=verifier_for_backend(attestation_backend)
        except ValueError:
            verifier=None
            reasons.append("HOSTED_ATTESTATION_BACKEND_UNKNOWN")

        if verifier is not None:
            results=verify_bundle_files(
                [Path(x) for x in hosted_attestation_paths],
                verifier,
                accepted_identities=policy.accepted_attestation_identities,
                accepted_oidc_issuers=policy.accepted_attestation_oidc_issuers,
                expected_artifact_sha256=spec.artifact_sha256,
                accepted_predicate_types=policy.accepted_predicate_types,
                accepted_builder_ids=policy.accepted_builder_ids,
                require_transparency_log=policy.require_transparency_log,
            )
            verified_attestations=[{
                "backend":r.backend,
                "identity":r.identity,
                "oidc_issuer":r.oidc_issuer,
                "artifact_sha256":r.artifact_sha256,
                "predicate_type":r.predicate_type,
                "builder_id":r.builder_id,
                "transparency_included":r.transparency_included,
                "evidence_digest":r.evidence_digest,
            } for r in results if r.valid]
            effective_hosted_attestation_count=len(verified_attestations)
            invalid=[list(r.reasons) for r in results if not r.valid]
            if invalid:
                evidence["invalid_hosted_attestations"]=invalid

    if effective_hosted_attestation_count < policy.minimum_hosted_attestations:
        reasons.append("HOSTED_ATTESTATIONS_INSUFFICIENT")
    evidence["hosted_attestation_count"]=effective_hosted_attestation_count
    evidence["verified_hosted_attestations"]=verified_attestations

    return AdmissionDecision(
        allowed=not reasons,
        policy_id=policy.policy_id,
        policy_digest=policy.digest(),
        reasons=tuple(reasons),
        evidence=evidence,
    )
