from __future__ import annotations
import hashlib, json
from pathlib import Path
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.hosted_attestation import HostedAttestationVerifier,verify_bundle_files
from numina_prod.deploy_policy import DeployAdmissionPolicy,evaluate_admission
from numina_prod.deploy_provider import (
    DeploySpec,DeployResult,DeployError,DeploymentJournal,DeploymentManager
)
from numina_prod.signing import SigningIdentity

IDENTITY="https://github.com/numina/build/.github/workflows/release.yml@refs/heads/main"
ISSUER="https://token.actions.githubusercontent.com"
BUILDER="urn:numina:builder:release-gate:v1"
PRED="https://slsa.dev/provenance/v1"

def release(tmp_path):
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

def bundle(digest,**kw):
    data={
        "identity":IDENTITY,
        "oidc_issuer":ISSUER,
        "artifact_sha256":digest,
        "predicate_type":PRED,
        "builder_id":BUILDER,
        "signature_valid":True,
        "certificate_valid":True,
        "transparency_log_included":True,
    }
    data.update(kw)
    return data

def write_bundle(path,data):
    path.write_text(json.dumps(data))
    return path

def policy():
    return DeployAdmissionPolicy(
        policy_id="hosted-v1",
        allowed_roles=("public-verifier",),
        allowed_environments=("production",),
        allowed_providers=("docker",),
        allowed_targets=("numina-public",),
        allowed_public_domains=("numinalabs.xyz",),
        accepted_predicate_types=(PRED,),
        accepted_builder_ids=(BUILDER,),
        require_sbom=True,
        require_persistent_signing_key=True,
        minimum_hosted_attestations=1,
        accepted_attestation_identities=(IDENTITY,),
        accepted_attestation_oidc_issuers=(ISSUER,),
        require_transparency_log=True,
        hosted_attestation_backend="reference",
        allow_reference_attestation_in_production=True,
    )

def spec(tmp_path):
    artifact,digest,sbom=release(tmp_path)
    return DeploySpec(
        "dep","docker",str(artifact),digest,"public-verifier","production",
        "numina-public","numina/verifier:test","NUMINA",
        "numina-public-verifier","https://numinalabs.xyz",
        {"sbom_path":str(sbom)}
    )

@pytest.mark.parametrize("change,reason",[
    ({"identity":"https://evil.invalid/workflow"},"ATTESTATION_IDENTITY_NOT_ALLOWED"),
    ({"oidc_issuer":"https://evil.invalid"},"ATTESTATION_OIDC_ISSUER_NOT_ALLOWED"),
    ({"transparency_log_included":False},"ATTESTATION_TRANSPARENCY_LOG_REQUIRED"),
    ({"artifact_sha256":"0"*64},"ATTESTATION_ARTIFACT_DIGEST_MISMATCH"),
    ({"builder_id":"urn:evil:builder"},"ATTESTATION_BUILDER_NOT_ALLOWED"),
    ({"predicate_type":"https://evil.invalid/predicate"},"ATTESTATION_PREDICATE_NOT_ALLOWED"),
    ({"signature_valid":False},"ATTESTATION_SIGNATURE_INVALID"),
    ({"certificate_valid":False},"ATTESTATION_CERTIFICATE_INVALID"),
])
def test_hosted_attestation_rejects_bad_evidence(tmp_path,change,reason):
    _,digest,_=release(tmp_path)
    r=HostedAttestationVerifier().verify(
        bundle(digest,**change),
        accepted_identities=(IDENTITY,),accepted_oidc_issuers=(ISSUER,),
        expected_artifact_sha256=digest,accepted_predicate_types=(PRED,),
        accepted_builder_ids=(BUILDER,),require_transparency_log=True
    )
    assert not r.valid
    assert reason in r.reasons

def test_duplicate_attestation_replay_does_not_double_count(tmp_path):
    _,digest,_=release(tmp_path)
    b=write_bundle(tmp_path/"a.json",bundle(digest))
    results=verify_bundle_files(
        [b,b],HostedAttestationVerifier(),
        accepted_identities=(IDENTITY,),accepted_oidc_issuers=(ISSUER,),
        expected_artifact_sha256=digest,accepted_predicate_types=(PRED,),
        accepted_builder_ids=(BUILDER,),require_transparency_log=True
    )
    assert len(results)==1 and results[0].valid

def test_policy_counts_only_verified_unique_attestations(tmp_path):
    s=spec(tmp_path)
    good=write_bundle(tmp_path/"good.json",bundle(s.artifact_sha256))
    bad=write_bundle(tmp_path/"bad.json",bundle(s.artifact_sha256,oidc_issuer="https://evil.invalid"))
    d=evaluate_admission(
        s,policy(),signing_key_persistent=True,
        hosted_attestation_paths=(str(good),str(good),str(bad))
    )
    assert d.allowed
    assert d.evidence["hosted_attestation_count"]==1
    assert len(d.evidence["verified_hosted_attestations"])==1

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

def test_provider_not_called_when_hosted_attestation_threshold_fails(tmp_path):
    s=spec(tmp_path)
    provider=CountingProvider()
    mgr=DeploymentManager(
        DeploymentJournal(tmp_path/"journal.json"),
        SigningIdentity(Ed25519PrivateKey.generate()),
        provider_factory=lambda _:provider
    )
    with pytest.raises(DeployError,match="DEPLOY_ADMISSION_DENIED"):
        mgr.apply(s,admission_policy=policy(),signing_key_persistent=True)
    assert provider.apply_calls==0

def test_deployment_receipt_binds_verified_attestation_digest(tmp_path):
    s=spec(tmp_path)
    good=write_bundle(tmp_path/"good.json",bundle(s.artifact_sha256))
    provider=CountingProvider()
    mgr=DeploymentManager(
        DeploymentJournal(tmp_path/"journal.json"),
        SigningIdentity(Ed25519PrivateKey.generate()),
        provider_factory=lambda _:provider
    )
    _,receipt,_=mgr.apply(
        s,admission_policy=policy(),signing_key_persistent=True,
        hosted_attestation_paths=(str(good),)
    )
    evidence=receipt["payload"]["admission"]["evidence"]["verified_hosted_attestations"]
    assert len(evidence)==1
    assert len(evidence[0]["evidence_digest"])==64
