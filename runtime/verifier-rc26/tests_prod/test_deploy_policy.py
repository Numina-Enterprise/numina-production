from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.deploy_provider import (
    DeployError,DeployResult,DeploySpec,DeploymentJournal,DeploymentManager
)
from numina_prod.deploy_policy import DeployAdmissionPolicy,evaluate_admission
from numina_prod.signing import SigningIdentity,verify_envelope


def release(tmp_path:Path,builder="urn:numina:builder:release-gate:v1",
            predicate="https://slsa.dev/provenance/v1"):
    artifact=tmp_path/"numina.zip"
    artifact.write_bytes(b"release")
    digest=hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_suffix(".zip.sha256").write_text(f"{digest}  {artifact.name}\n")
    artifact.with_suffix(".zip.intoto.json").write_text(json.dumps({
        "_type":"https://in-toto.io/Statement/v1",
        "subject":[{"name":artifact.name,"digest":{"sha256":digest}}],
        "predicateType":predicate,
        "predicate":{
            "buildDefinition":{"buildType":"urn:numina:build:production-plane:v1"},
            "runDetails":{"builder":{"id":builder}}
        }
    }))
    sbom=tmp_path/"software-bom.spdx.json"
    sbom.write_text(json.dumps({"spdxVersion":"SPDX-2.3","name":"numina"}))
    return artifact,digest,sbom


def make_spec(tmp_path:Path,**kw):
    artifact,digest,sbom=release(tmp_path)
    data=dict(
        deployment_id="d1",provider="docker",artifact=str(artifact),
        artifact_sha256=digest,role="public-verifier",environment="production",
        target="numina-public",image="numina/verifier:test",
        public_url="https://numinalabs.xyz",
        metadata={"sbom_path":str(sbom)},
    )
    data.update(kw)
    return DeploySpec(**data)


def policy(**kw):
    data=dict(
        policy_id="prod-public-v1",
        allowed_roles=("public-verifier",),
        allowed_environments=("production",),
        allowed_providers=("docker",),
        allowed_targets=("numina-public",),
        allowed_public_domains=("numinalabs.xyz",),
        accepted_predicate_types=("https://slsa.dev/provenance/v1",),
        accepted_builder_ids=("urn:numina:builder:release-gate:v1",),
        require_sbom=True,
        require_persistent_signing_key=True,
        minimum_hosted_attestations=0,
    )
    data.update(kw)
    return DeployAdmissionPolicy(**data)


@pytest.mark.parametrize("mutator,reason",[
    (lambda s:replace(s,role="witness"),"ROLE_NOT_ALLOWED"),
    (lambda s:replace(s,environment="staging"),"ENVIRONMENT_NOT_ALLOWED"),
    (lambda s:replace(s,provider="https"),"PROVIDER_NOT_ALLOWED"),
    (lambda s:replace(s,target="other"),"TARGET_NOT_ALLOWED"),
    (lambda s:replace(s,public_url="https://evil.example"),"PUBLIC_DOMAIN_NOT_ALLOWED"),
])
def test_policy_rejects_scope_mismatch(tmp_path,mutator,reason):
    d=evaluate_admission(
        mutator(make_spec(tmp_path)),policy(),
        signing_key_persistent=True
    )
    assert not d.allowed
    assert reason in d.reasons


def test_wrong_builder_rejected(tmp_path):
    s=make_spec(tmp_path)
    prov=Path(s.artifact).with_suffix(".zip.intoto.json")
    doc=json.loads(prov.read_text())
    doc["predicate"]["runDetails"]["builder"]["id"]="urn:evil:builder"
    prov.write_text(json.dumps(doc))
    d=evaluate_admission(s,policy(),signing_key_persistent=True)
    assert not d.allowed
    assert "BUILDER_NOT_ALLOWED" in d.reasons


def test_wrong_predicate_rejected(tmp_path):
    s=make_spec(tmp_path)
    prov=Path(s.artifact).with_suffix(".zip.intoto.json")
    doc=json.loads(prov.read_text())
    doc["predicateType"]="https://example.invalid/provenance"
    prov.write_text(json.dumps(doc))
    d=evaluate_admission(s,policy(),signing_key_persistent=True)
    assert not d.allowed
    assert "PROVENANCE_PREDICATE_NOT_ALLOWED" in d.reasons


def test_missing_sbom_rejected(tmp_path):
    s=make_spec(tmp_path)
    Path(s.metadata["sbom_path"]).unlink()
    d=evaluate_admission(s,policy(),signing_key_persistent=True)
    assert not d.allowed
    assert "SBOM_MISSING" in d.reasons


def test_sbom_digest_mismatch_rejected(tmp_path):
    s=make_spec(tmp_path)
    d=evaluate_admission(
        s,policy(expected_sbom_sha256="0"*64),
        signing_key_persistent=True
    )
    assert not d.allowed
    assert "SBOM_DIGEST_MISMATCH" in d.reasons


def test_persistent_key_required(tmp_path):
    d=evaluate_admission(
        make_spec(tmp_path),policy(),signing_key_persistent=False
    )
    assert not d.allowed
    assert "PERSISTENT_SIGNING_KEY_REQUIRED" in d.reasons


def test_hosted_attestation_threshold(tmp_path):
    p=policy(minimum_hosted_attestations=2)
    d=evaluate_admission(
        make_spec(tmp_path),p,signing_key_persistent=True,
        hosted_attestation_count=1
    )
    assert not d.allowed
    assert "HOSTED_ATTESTATIONS_INSUFFICIENT" in d.reasons


def test_policy_digest_is_stable():
    p=policy()
    assert len(p.digest())==64
    assert p.digest()==policy().digest()


class CountingProvider:
    name="counting"
    def __init__(self): self.apply_calls=0
    def preflight(self,s): return {"valid":True}
    def apply(self,s):
        self.apply_calls+=1
        return DeployResult(
            s.deployment_id,s.provider,s.role,s.environment,s.target,
            "deployed",s.artifact_sha256
        )
    def status(self,s): raise AssertionError
    def verify(self,s): raise AssertionError
    def rollback(self,s): raise AssertionError


def test_provider_not_invoked_when_policy_denies(tmp_path):
    provider=CountingProvider()
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    mgr=DeploymentManager(
        DeploymentJournal(tmp_path/"journal.json"),identity,
        provider_factory=lambda _:provider
    )
    with pytest.raises(DeployError,match="DEPLOY_ADMISSION_DENIED"):
        mgr.apply(
            make_spec(tmp_path),
            admission_policy=policy(allowed_roles=("witness",)),
            signing_key_persistent=True,
        )
    assert provider.apply_calls==0


def test_receipt_binds_policy_digest_and_decision(tmp_path):
    provider=CountingProvider()
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    mgr=DeploymentManager(
        DeploymentJournal(tmp_path/"journal.json"),identity,
        provider_factory=lambda _:provider
    )
    p=policy()
    result,receipt,_=mgr.apply(
        make_spec(tmp_path),admission_policy=p,
        signing_key_persistent=True
    )
    assert receipt["payload"]["admission"]["allowed"] is True
    assert receipt["payload"]["admission"]["policy_digest"]==p.digest()
    assert verify_envelope(
        receipt,
        expected_public_key_b64=identity.public_key_b64,
        expected_type="NUMINA_DEPLOYMENT_RECEIPT"
    )
