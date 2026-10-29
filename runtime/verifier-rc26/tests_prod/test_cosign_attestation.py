from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.hosted_attestation import CosignVerifier, verifier_for_backend
from numina_prod.deploy_policy import DeployAdmissionPolicy, evaluate_admission
from numina_prod.deploy_provider import (
    DeployError, DeployResult, DeploySpec, DeploymentJournal, DeploymentManager
)
from numina_prod.signing import SigningIdentity

IDENTITY="https://github.com/numina/example/.github/workflows/release.yml@refs/heads/main"
ISSUER="https://token.actions.githubusercontent.com"
BUILDER="urn:numina:builder:release-gate:v1"
PRED="https://slsa.dev/provenance/v1"


def release(tmp_path:Path):
    artifact=tmp_path/"numina.zip"
    artifact.write_bytes(b"release")
    digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_suffix(".zip.sha256").write_text(f"{digest}  {artifact.name}\n")
    artifact.with_suffix(".zip.intoto.json").write_text(json.dumps({
        "_type":"https://in-toto.io/Statement/v1",
        "subject":[{"name":artifact.name,"digest":{"sha256":digest}}],
        "predicateType":PRED,
        "predicate":{"runDetails":{"builder":{"id":BUILDER}}}
    }))
    sbom=tmp_path/"software-bom.spdx.json"
    sbom.write_text('{"spdxVersion":"SPDX-2.3"}')
    return artifact,digest,sbom


def descriptor(tmp_path:Path,digest:str,*,subject_digest=None,builder=BUILDER,predicate=PRED):
    statement=tmp_path/"signed.intoto.json"
    statement.write_text(json.dumps({
        "_type":"https://in-toto.io/Statement/v1",
        "subject":[{"name":"numina.zip","digest":{"sha256":subject_digest or digest}}],
        "predicateType":predicate,
        "predicate":{"runDetails":{"builder":{"id":builder}}}
    }))
    bundle=tmp_path/"signed.sigstore.json"
    bundle.write_text('{"mediaType":"application/vnd.dev.sigstore.bundle+json;version=0.3"}')
    desc=tmp_path/"hosted.json"
    desc.write_text(json.dumps({
        "statement_path":statement.name,
        "sigstore_bundle_path":bundle.name
    }))
    return desc


class CP:
    def __init__(self,returncode=0,stdout="",stderr=""):
        self.returncode=returncode; self.stdout=stdout; self.stderr=stderr


def successful_runner(calls):
    def run(cmd,**kwargs):
        calls.append(cmd)
        return CP(0,"Verified OK","")
    return run


def test_cosign_backend_selection():
    assert isinstance(verifier_for_backend("cosign"),CosignVerifier)
    with pytest.raises(ValueError):
        verifier_for_backend("unknown")


def test_cosign_verifies_signed_statement_and_policy_identity(tmp_path):
    _,digest,_=release(tmp_path)
    desc=descriptor(tmp_path,digest)
    calls=[]
    r=CosignVerifier(runner=successful_runner(calls)).verify(
        json.loads(desc.read_text()),descriptor_path=desc,
        accepted_identities=(IDENTITY,),accepted_oidc_issuers=(ISSUER,),
        expected_artifact_sha256=digest,accepted_predicate_types=(PRED,),
        accepted_builder_ids=(BUILDER,),require_transparency_log=True
    )
    assert r.valid
    assert r.backend=="cosign"
    assert r.identity==IDENTITY and r.oidc_issuer==ISSUER
    assert "--certificate-identity" in calls[0]
    assert "--certificate-oidc-issuer" in calls[0]
    assert "--bundle" in calls[0]


def test_missing_cosign_fails_closed(tmp_path):
    _,digest,_=release(tmp_path)
    desc=descriptor(tmp_path,digest)
    def missing(*args,**kwargs): raise FileNotFoundError("cosign")
    r=CosignVerifier(runner=missing).verify(
        json.loads(desc.read_text()),descriptor_path=desc,
        accepted_identities=(IDENTITY,),accepted_oidc_issuers=(ISSUER,),
        expected_artifact_sha256=digest,accepted_predicate_types=(PRED,),
        accepted_builder_ids=(BUILDER,),require_transparency_log=True
    )
    assert not r.valid
    assert "COSIGN_UNAVAILABLE" in r.reasons


@pytest.mark.parametrize("kind",["identity","issuer"])
def test_wrong_identity_or_issuer_cannot_verify(tmp_path,kind):
    _,digest,_=release(tmp_path)
    desc=descriptor(tmp_path,digest)
    def rejecting(cmd,**kwargs): return CP(1,"","verification failed")
    identities=("https://wrong.invalid",) if kind=="identity" else (IDENTITY,)
    issuers=("https://wrong.invalid",) if kind=="issuer" else (ISSUER,)
    r=CosignVerifier(runner=rejecting).verify(
        json.loads(desc.read_text()),descriptor_path=desc,
        accepted_identities=identities,accepted_oidc_issuers=issuers,
        expected_artifact_sha256=digest,accepted_predicate_types=(PRED,),
        accepted_builder_ids=(BUILDER,),require_transparency_log=True
    )
    assert not r.valid
    assert "COSIGN_VERIFICATION_FAILED" in r.reasons


def test_verified_statement_digest_mismatch_denied(tmp_path):
    _,digest,_=release(tmp_path)
    desc=descriptor(tmp_path,digest,subject_digest="0"*64)
    r=CosignVerifier(runner=lambda *a,**k:CP(0)).verify(
        json.loads(desc.read_text()),descriptor_path=desc,
        accepted_identities=(IDENTITY,),accepted_oidc_issuers=(ISSUER,),
        expected_artifact_sha256=digest,accepted_predicate_types=(PRED,),
        accepted_builder_ids=(BUILDER,),require_transparency_log=True
    )
    assert not r.valid
    assert "ATTESTATION_ARTIFACT_DIGEST_MISMATCH" in r.reasons


def test_verified_statement_builder_mismatch_denied(tmp_path):
    _,digest,_=release(tmp_path)
    desc=descriptor(tmp_path,digest,builder="urn:evil:builder")
    r=CosignVerifier(runner=lambda *a,**k:CP(0)).verify(
        json.loads(desc.read_text()),descriptor_path=desc,
        accepted_identities=(IDENTITY,),accepted_oidc_issuers=(ISSUER,),
        expected_artifact_sha256=digest,accepted_predicate_types=(PRED,),
        accepted_builder_ids=(BUILDER,),require_transparency_log=True
    )
    assert not r.valid
    assert "ATTESTATION_BUILDER_NOT_ALLOWED" in r.reasons


def test_reference_backend_cannot_satisfy_production_threshold(tmp_path):
    artifact,digest,sbom=release(tmp_path)
    spec=DeploySpec(
        "dep","docker",str(artifact),digest,"public-verifier","production",
        "numina-public","numina/verifier:test","NUMINA",
        "numina-public-verifier","https://numinalabs.xyz",
        {"sbom_path":str(sbom)}
    )
    policy=DeployAdmissionPolicy(
        policy_id="strict",allowed_roles=("public-verifier",),
        allowed_environments=("production",),allowed_providers=("docker",),
        allowed_targets=("numina-public",),allowed_public_domains=("numinalabs.xyz",),
        accepted_predicate_types=(PRED,),accepted_builder_ids=(BUILDER,),
        require_sbom=True,require_persistent_signing_key=True,
        minimum_hosted_attestations=1,
        accepted_attestation_identities=(IDENTITY,),
        accepted_attestation_oidc_issuers=(ISSUER,),
        hosted_attestation_backend="reference",
        allow_reference_attestation_in_production=False,
    )
    d=evaluate_admission(spec,policy,signing_key_persistent=True,hosted_attestation_count=999)
    assert not d.allowed
    assert "REFERENCE_ATTESTATION_BACKEND_FORBIDDEN_IN_PRODUCTION" in d.reasons
    assert "HOSTED_ATTESTATIONS_INSUFFICIENT" in d.reasons
    assert d.evidence["hosted_attestation_count"]==0


class CountingProvider:
    name="counting"
    def __init__(self): self.apply_calls=0
    def preflight(self,s): return {"valid":True}
    def apply(self,s):
        self.apply_calls+=1
        return DeployResult(s.deployment_id,s.provider,s.role,s.environment,s.target,"deployed",s.artifact_sha256)
    def status(self,s): raise AssertionError
    def verify(self,s): raise AssertionError
    def rollback(self,s): raise AssertionError


def test_provider_not_called_if_native_attestation_missing(tmp_path):
    artifact,digest,sbom=release(tmp_path)
    spec=DeploySpec(
        "dep","docker",str(artifact),digest,"public-verifier","production",
        "numina-public","numina/verifier:test","NUMINA",
        "numina-public-verifier","https://numinalabs.xyz",
        {"sbom_path":str(sbom)}
    )
    policy=DeployAdmissionPolicy(
        policy_id="native",allowed_roles=("public-verifier",),
        allowed_environments=("production",),allowed_providers=("docker",),
        allowed_targets=("numina-public",),allowed_public_domains=("numinalabs.xyz",),
        accepted_predicate_types=(PRED,),accepted_builder_ids=(BUILDER,),
        require_sbom=True,require_persistent_signing_key=True,
        minimum_hosted_attestations=1,
        accepted_attestation_identities=(IDENTITY,),
        accepted_attestation_oidc_issuers=(ISSUER,),
        hosted_attestation_backend="cosign"
    )
    provider=CountingProvider()
    mgr=DeploymentManager(
        DeploymentJournal(tmp_path/"journal.json"),
        SigningIdentity(Ed25519PrivateKey.generate()),
        provider_factory=lambda _:provider
    )
    with pytest.raises(DeployError,match="DEPLOY_ADMISSION_DENIED"):
        mgr.apply(spec,admission_policy=policy,signing_key_persistent=True)
    assert provider.apply_calls==0
