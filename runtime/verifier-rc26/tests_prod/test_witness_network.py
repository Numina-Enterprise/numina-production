from __future__ import annotations

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.deploy_provider import DeployError
from numina_prod.signing import SigningIdentity, verify_envelope
from numina_prod.witness_network import (
    Witness,
    WitnessPolicy,
    WitnessCoordinator,
    create_witness_attestation,
)


def checkpoint(identity):
    return identity.sign(
        {
            "deployment_id":"dep",
            "entry_count":2,
            "journal_head_digest":"abc123",
            "deployment_entry_digests":["e1","e2"],
        },
        "NUMINA_CONVERGENCE_CHECKPOINT",
    )


class FakeClient:
    def __init__(self,responses):
        self.responses=responses
    def publish(self,witness,checkpoint):
        value=self.responses[witness.witness_id]
        if isinstance(value,Exception):
            raise value
        return value


def test_two_witness_quorum_succeeds():
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    w1id=SigningIdentity(Ed25519PrivateKey.generate())
    w2id=SigningIdentity(Ed25519PrivateKey.generate())
    cp=checkpoint(controller)

    w1=Witness("w1","https://w1.example",w1id.public_key_b64)
    w2=Witness("w2","https://w2.example",w2id.public_key_b64)

    client=FakeClient({
        "w1":{"attestation":create_witness_attestation(w1id,witness_id="w1",checkpoint=cp)},
        "w2":{"attestation":create_witness_attestation(w2id,witness_id="w2",checkpoint=cp)},
    })

    out=WitnessCoordinator(controller,client=client).corroborate(
        checkpoint=cp,
        witnesses=(w1,w2),
        policy=WitnessPolicy(minimum_valid_witnesses=2),
    )
    assert out["allowed"]
    assert len(out["valid_witnesses"])==2
    assert verify_envelope(
        out["quorum_receipt"],
        expected_public_key_b64=controller.public_key_b64,
        expected_type="NUMINA_CONVERGENCE_WITNESS_QUORUM",
    )


def test_duplicate_witness_id_rejected():
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    wid=SigningIdentity(Ed25519PrivateKey.generate())
    w1=Witness("same","https://w1.example",wid.public_key_b64)
    w2=Witness("same","https://w2.example",wid.public_key_b64)
    with pytest.raises(DeployError,match="DUPLICATE_WITNESS_ID"):
        WitnessCoordinator(controller,client=FakeClient({})).corroborate(
            checkpoint=checkpoint(controller),
            witnesses=(w1,w2),
            policy=WitnessPolicy(),
        )


def test_wrong_witness_signature_does_not_count():
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    expected=SigningIdentity(Ed25519PrivateKey.generate())
    wrong=SigningIdentity(Ed25519PrivateKey.generate())
    cp=checkpoint(controller)
    w=Witness("w1","https://w1.example",expected.public_key_b64,required=False)
    client=FakeClient({
        "w1":{"attestation":create_witness_attestation(wrong,witness_id="w1",checkpoint=cp)}
    })
    with pytest.raises(DeployError,match="WITNESS_QUORUM_FAILED"):
        WitnessCoordinator(controller,client=client).corroborate(
            checkpoint=cp,
            witnesses=(w,),
            policy=WitnessPolicy(minimum_valid_witnesses=1,require_all_required_witnesses=False),
        )


def test_required_witness_failure_blocks_even_if_quorum_met():
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    w1id=SigningIdentity(Ed25519PrivateKey.generate())
    w2id=SigningIdentity(Ed25519PrivateKey.generate())
    cp=checkpoint(controller)
    w1=Witness("w1","https://w1.example",w1id.public_key_b64,required=True)
    w2=Witness("w2","https://w2.example",w2id.public_key_b64,required=False)
    client=FakeClient({
        "w1":DeployError("offline"),
        "w2":{"attestation":create_witness_attestation(w2id,witness_id="w2",checkpoint=cp)},
    })
    with pytest.raises(DeployError,match="WITNESS_QUORUM_FAILED"):
        WitnessCoordinator(controller,client=client).corroborate(
            checkpoint=cp,
            witnesses=(w1,w2),
            policy=WitnessPolicy(minimum_valid_witnesses=1,require_all_required_witnesses=True),
        )


def test_wrong_checkpoint_head_does_not_count():
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    wid=SigningIdentity(Ed25519PrivateKey.generate())
    cp=checkpoint(controller)
    bad_cp=dict(cp)
    bad_cp["payload"]=dict(cp["payload"])
    bad_cp["payload"]["journal_head_digest"]="different"

    w=Witness("w1","https://w1.example",wid.public_key_b64,required=False)
    client=FakeClient({
        "w1":{"attestation":create_witness_attestation(wid,witness_id="w1",checkpoint=bad_cp)}
    })
    with pytest.raises(DeployError,match="WITNESS_QUORUM_FAILED"):
        WitnessCoordinator(controller,client=client).corroborate(
            checkpoint=cp,
            witnesses=(w,),
            policy=WitnessPolicy(minimum_valid_witnesses=1,require_all_required_witnesses=False),
        )


def test_no_witnesses_fails_closed():
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    with pytest.raises(DeployError,match="NO_WITNESSES_CONFIGURED"):
        WitnessCoordinator(controller,client=FakeClient({})).corroborate(
            checkpoint=checkpoint(controller),
            witnesses=(),
            policy=WitnessPolicy(),
        )
