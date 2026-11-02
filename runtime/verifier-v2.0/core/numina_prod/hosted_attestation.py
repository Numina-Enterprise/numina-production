from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol


@dataclass(frozen=True)
class HostedAttestationResult:
    valid: bool
    reasons: tuple[str, ...]
    identity: str | None
    oidc_issuer: str | None
    artifact_sha256: str | None
    predicate_type: str | None
    builder_id: str | None
    transparency_included: bool
    evidence_digest: str
    backend: str = "reference"


class AttestationVerifier(Protocol):
    backend: str

    def verify(
        self,
        descriptor: dict,
        *,
        descriptor_path: Path | None = None,
        accepted_identities: tuple[str, ...],
        accepted_oidc_issuers: tuple[str, ...],
        expected_artifact_sha256: str,
        accepted_predicate_types: tuple[str, ...],
        accepted_builder_ids: tuple[str, ...],
        require_transparency_log: bool = True,
    ) -> HostedAttestationResult: ...


def _statement_subject_sha256(statement: dict) -> str | None:
    for subject in statement.get("subject", []):
        digest = subject.get("digest", {}).get("sha256")
        if digest:
            return digest
    return None


def _statement_builder_id(statement: dict) -> str | None:
    try:
        return statement["predicate"]["runDetails"]["builder"]["id"]
    except Exception:
        return None


def _evidence_digest(data: dict) -> str:
    return hashlib.sha256(
        json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class HostedAttestationVerifier:
    """Reference-only normalized verifier.

    This backend is useful for conformance tests and pre-production fixtures.
    Production admission must not silently select it when native verification
    is required.
    """

    backend = "reference"

    def verify(
        self,
        descriptor: dict,
        *,
        descriptor_path: Path | None = None,
        accepted_identities: tuple[str, ...],
        accepted_oidc_issuers: tuple[str, ...],
        expected_artifact_sha256: str,
        accepted_predicate_types: tuple[str, ...],
        accepted_builder_ids: tuple[str, ...],
        require_transparency_log: bool = True,
    ) -> HostedAttestationResult:
        reasons = []
        identity = descriptor.get("identity")
        issuer = descriptor.get("oidc_issuer")
        digest = descriptor.get("artifact_sha256")
        predicate = descriptor.get("predicate_type")
        builder = descriptor.get("builder_id")
        transparency = bool(descriptor.get("transparency_log_included"))

        if not descriptor.get("signature_valid"):
            reasons.append("ATTESTATION_SIGNATURE_INVALID")
        if not descriptor.get("certificate_valid"):
            reasons.append("ATTESTATION_CERTIFICATE_INVALID")
        if identity not in accepted_identities:
            reasons.append("ATTESTATION_IDENTITY_NOT_ALLOWED")
        if issuer not in accepted_oidc_issuers:
            reasons.append("ATTESTATION_OIDC_ISSUER_NOT_ALLOWED")
        if digest != expected_artifact_sha256:
            reasons.append("ATTESTATION_ARTIFACT_DIGEST_MISMATCH")
        if predicate not in accepted_predicate_types:
            reasons.append("ATTESTATION_PREDICATE_NOT_ALLOWED")
        if accepted_builder_ids and builder not in accepted_builder_ids:
            reasons.append("ATTESTATION_BUILDER_NOT_ALLOWED")
        if require_transparency_log and not transparency:
            reasons.append("ATTESTATION_TRANSPARENCY_LOG_REQUIRED")

        return HostedAttestationResult(
            valid=not reasons,
            reasons=tuple(reasons),
            identity=identity,
            oidc_issuer=issuer,
            artifact_sha256=digest,
            predicate_type=predicate,
            builder_id=builder,
            transparency_included=transparency,
            evidence_digest=_evidence_digest(descriptor),
            backend=self.backend,
        )


class CosignVerifier:
    """Native Sigstore/Cosign verifier for signed in-toto statements.

    Descriptor format:
      {
        "statement_path": "release.intoto.json",
        "sigstore_bundle_path": "release.sigstore.json"
      }

    The statement is the signed object. Numina does not trust identity,
    issuer, artifact digest, predicate type, or builder ID from the descriptor.
    Identity/issuer are enforced by Cosign CLI arguments. Artifact digest,
    predicate and builder are derived from the successfully verified statement.
    """

    backend = "cosign"

    def __init__(
        self,
        runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
        binary: str | None = None,
    ):
        self.runner = runner
        self.binary = binary or os.getenv("NUMINA_COSIGN_BIN", "cosign")

    @staticmethod
    def _resolve(descriptor_path: Path | None, value: str) -> Path:
        p = Path(value)
        if not p.is_absolute() and descriptor_path is not None:
            p = descriptor_path.parent / p
        return p.resolve()

    def _run_identity_pair(
        self,
        statement_path: Path,
        bundle_path: Path,
        identity: str,
        issuer: str,
    ) -> tuple[bool, str]:
        cmd = [
            self.binary,
            "verify-blob",
            str(statement_path),
            "--bundle",
            str(bundle_path),
            "--certificate-identity",
            identity,
            "--certificate-oidc-issuer",
            issuer,
        ]
        try:
            cp = self.runner(
                cmd,
                text=True,
                capture_output=True,
                timeout=60,
                check=False,
            )
        except (FileNotFoundError, PermissionError):
            return False, "COSIGN_UNAVAILABLE"
        if cp.returncode == 0:
            return True, ""
        return False, "COSIGN_VERIFICATION_FAILED"

    def verify(
        self,
        descriptor: dict,
        *,
        descriptor_path: Path | None = None,
        accepted_identities: tuple[str, ...],
        accepted_oidc_issuers: tuple[str, ...],
        expected_artifact_sha256: str,
        accepted_predicate_types: tuple[str, ...],
        accepted_builder_ids: tuple[str, ...],
        require_transparency_log: bool = True,
    ) -> HostedAttestationResult:
        reasons = []
        statement_value = descriptor.get("statement_path")
        bundle_value = descriptor.get("sigstore_bundle_path")
        if not statement_value:
            reasons.append("ATTESTATION_STATEMENT_MISSING")
        if not bundle_value:
            reasons.append("ATTESTATION_SIGSTORE_BUNDLE_MISSING")
        if reasons:
            return HostedAttestationResult(
                False, tuple(reasons), None, None, None, None, None, False,
                _evidence_digest(descriptor), self.backend
            )

        statement_path = self._resolve(descriptor_path, statement_value)
        bundle_path = self._resolve(descriptor_path, bundle_value)
        if not statement_path.is_file():
            reasons.append("ATTESTATION_STATEMENT_MISSING")
        if not bundle_path.is_file():
            reasons.append("ATTESTATION_SIGSTORE_BUNDLE_MISSING")
        if reasons:
            return HostedAttestationResult(
                False, tuple(reasons), None, None, None, None, None, False,
                _evidence_digest(descriptor), self.backend
            )

        matched_identity = None
        matched_issuer = None
        native_error = "COSIGN_VERIFICATION_FAILED"
        for identity in accepted_identities:
            for issuer in accepted_oidc_issuers:
                ok, err = self._run_identity_pair(
                    statement_path, bundle_path, identity, issuer
                )
                if ok:
                    matched_identity = identity
                    matched_issuer = issuer
                    native_error = ""
                    break
                native_error = err
            if matched_identity:
                break

        if not matched_identity:
            reasons.append(native_error)

        try:
            statement = json.loads(statement_path.read_text())
        except Exception:
            statement = {}
            reasons.append("ATTESTATION_STATEMENT_INVALID_JSON")

        digest = _statement_subject_sha256(statement)
        predicate = statement.get("predicateType")
        builder = _statement_builder_id(statement)

        if digest != expected_artifact_sha256:
            reasons.append("ATTESTATION_ARTIFACT_DIGEST_MISMATCH")
        if predicate not in accepted_predicate_types:
            reasons.append("ATTESTATION_PREDICATE_NOT_ALLOWED")
        if accepted_builder_ids and builder not in accepted_builder_ids:
            reasons.append("ATTESTATION_BUILDER_NOT_ALLOWED")

        # A successful standard cosign verify-blob with a Sigstore bundle
        # verifies the bundle's certificate/signature and transparency evidence.
        transparency = bool(matched_identity)
        if require_transparency_log and not transparency:
            if "COSIGN_UNAVAILABLE" not in reasons:
                reasons.append("ATTESTATION_TRANSPARENCY_LOG_REQUIRED")

        evidence = {
            "descriptor": descriptor,
            "statement_sha256": hashlib.sha256(statement_path.read_bytes()).hexdigest()
                if statement_path.is_file() else None,
            "sigstore_bundle_sha256": hashlib.sha256(bundle_path.read_bytes()).hexdigest()
                if bundle_path.is_file() else None,
            "identity": matched_identity,
            "oidc_issuer": matched_issuer,
            "artifact_sha256": digest,
            "predicate_type": predicate,
            "builder_id": builder,
        }

        return HostedAttestationResult(
            valid=not reasons,
            reasons=tuple(dict.fromkeys(reasons)),
            identity=matched_identity,
            oidc_issuer=matched_issuer,
            artifact_sha256=digest,
            predicate_type=predicate,
            builder_id=builder,
            transparency_included=transparency,
            evidence_digest=_evidence_digest(evidence),
            backend=self.backend,
        )


def load_bundle(path: Path) -> dict:
    return json.loads(path.read_text())


def verifier_for_backend(
    backend: str,
    *,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> AttestationVerifier:
    normalized = backend.strip().lower()
    if normalized == "reference":
        return HostedAttestationVerifier()
    if normalized == "cosign":
        return CosignVerifier(runner=runner)
    raise ValueError(f"unknown hosted attestation backend: {backend}")


def verify_bundle_files(
    paths: list[Path],
    verifier: AttestationVerifier,
    **kwargs,
):
    results = []
    seen = set()
    for path in paths:
        descriptor = load_bundle(path)
        result = verifier.verify(
            descriptor,
            descriptor_path=path,
            **kwargs,
        )
        if result.evidence_digest in seen:
            continue
        seen.add(result.evidence_digest)
        results.append(result)
    return results
