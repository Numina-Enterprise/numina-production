from __future__ import annotations

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.deploy_provider import DeployError
from numina_prod.signing import SigningIdentity, verify_envelope
from numina_prod.witness_gossip import (
    WitnessPeer,
    WitnessGossipAnalyzer,
    create_head_observation,
)


def ident():
    return SigningIdentity(Ed25519PrivateKey.generate())


def obs(identity,wid,head,seq=1):
    return create_head_observation(
        identity,
        witness_id=wid,
        deployment_id="dep",
        journal_head_digest=head,
        sequence=seq,
    )


def test_matching_gossip_produces_consistency_proof():
    local=ident(); p1=ident(); p2=ident()
    analyzer=WitnessGossipAnalyzer(local,local_witness_id="w0")
    result=analyzer.analyze(
        deployment_id="dep",
        local_observation=obs(local,"w0","head",3),
        peer_observations=(
            (WitnessPeer("w1",p1.public_key_b64),obs(p1,"w1","head",2)),
            (WitnessPeer("w2",p2.public_key_b64),obs(p2,"w2","head",4)),
        ),
        minimum_matching_witnesses=2,
    )
    assert result["consistent"]
    assert not result["split_view"]
    assert len(result["matching_witnesses"])==2
    assert verify_envelope(
        result["proof"],
        expected_public_key_b64=local.public_key_b64,
        expected_type="NUMINA_WITNESS_CONSISTENCY_PROOF",
    )


def test_conflicting_head_produces_split_view_alert():
    local=ident(); p1=ident(); p2=ident()
    analyzer=WitnessGossipAnalyzer(local,local_witness_id="w0")
    result=analyzer.analyze(
        deployment_id="dep",
        local_observation=obs(local,"w0","head-a",3),
        peer_observations=(
            (WitnessPeer("w1",p1.public_key_b64),obs(p1,"w1","head-a",2)),
            (WitnessPeer("w2",p2.public_key_b64),obs(p2,"w2","head-b",4)),
        ),
        minimum_matching_witnesses=1,
    )
    assert not result["consistent"]
    assert result["split_view"]
    assert result["conflicting_witnesses"][0]["witness_id"]=="w2"
    assert verify_envelope(
        result["alert"],
        expected_public_key_b64=local.public_key_b64,
        expected_type="NUMINA_WITNESS_SPLIT_VIEW_ALERT",
    )


def test_invalid_peer_signature_does_not_count():
    local=ident(); expected=ident(); wrong=ident()
    analyzer=WitnessGossipAnalyzer(local,local_witness_id="w0")
    with pytest.raises(DeployError,match="WITNESS_GOSSIP_QUORUM_INSUFFICIENT"):
        analyzer.analyze(
            deployment_id="dep",
            local_observation=obs(local,"w0","head"),
            peer_observations=(
                (WitnessPeer("w1",expected.public_key_b64),obs(wrong,"w1","head")),
            ),
            minimum_matching_witnesses=1,
        )


def test_duplicate_peer_id_rejected():
    local=ident(); p=ident()
    analyzer=WitnessGossipAnalyzer(local,local_witness_id="w0")
    peer=WitnessPeer("w1",p.public_key_b64)
    observation=obs(p,"w1","head")
    with pytest.raises(DeployError,match="DUPLICATE_GOSSIP_WITNESS_ID"):
        analyzer.analyze(
            deployment_id="dep",
            local_observation=obs(local,"w0","head"),
            peer_observations=((peer,observation),(peer,observation)),
            minimum_matching_witnesses=1,
        )


def test_local_identity_binding_enforced():
    local=ident()
    analyzer=WitnessGossipAnalyzer(local,local_witness_id="w0")
    with pytest.raises(DeployError,match="LOCAL_WITNESS_ID_MISMATCH"):
        analyzer.analyze(
            deployment_id="dep",
            local_observation=obs(local,"wrong","head"),
            peer_observations=(),
            minimum_matching_witnesses=1,
        )


def test_local_deployment_binding_enforced():
    local=ident()
    wrong=create_head_observation(
        local,
        witness_id="w0",
        deployment_id="other",
        journal_head_digest="head",
        sequence=1,
    )
    analyzer=WitnessGossipAnalyzer(local,local_witness_id="w0")
    with pytest.raises(DeployError,match="LOCAL_DEPLOYMENT_ID_MISMATCH"):
        analyzer.analyze(
            deployment_id="dep",
            local_observation=wrong,
            peer_observations=(),
            minimum_matching_witnesses=1,
        )
