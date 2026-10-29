from __future__ import annotations
import json
from pathlib import Path
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from numina_prod.convergence_journal import ConvergenceJournal,verify_checkpoint
from numina_prod.deploy_provider import DeployError
from numina_prod.signing import SigningIdentity


def append(j,cycle,converged=False):
    return j.append_cycle(
        deployment_id="dep",
        cycle=cycle,
        routing_digest=f"route-{cycle}",
        selected_room_ids=("a",),
        verified_room_ids=("a",) if converged else (),
        unhealthy_room_ids=() if converged else ("a",),
        converged=converged,
    )


def test_hash_chain_and_checkpoint(tmp_path):
    j=ConvergenceJournal(tmp_path/"journal.json")
    e1=append(j,1,False)
    e2=append(j,2,True)
    assert e2["prior_entry_digest"]==e1["entry_digest"]
    assert j.validate()
    identity=SigningIdentity(Ed25519PrivateKey.generate())
    cp=j.checkpoint(identity,deployment_id="dep")
    assert verify_checkpoint(
        cp,
        expected_public_key_b64=identity.public_key_b64,
        expected_head_digest=j.head_digest(),
    )


def test_rewrite_detected(tmp_path):
    path=tmp_path/"journal.json"
    j=ConvergenceJournal(path)
    append(j,1,False)
    state=json.loads(path.read_text())
    state["entries"][0]["routing_digest"]="tampered"
    path.write_text(json.dumps(state))
    with pytest.raises(DeployError,match="ENTRY_DIGEST_INVALID"):
        j.validate()


def test_reorder_or_sequence_break_detected(tmp_path):
    path=tmp_path/"journal.json"
    j=ConvergenceJournal(path)
    append(j,1,False); append(j,2,True)
    state=json.loads(path.read_text())
    state["entries"][0],state["entries"][1]=state["entries"][1],state["entries"][0]
    path.write_text(json.dumps(state))
    with pytest.raises(DeployError):
        j.validate()


def test_corrupt_json_fails_closed(tmp_path):
    path=tmp_path/"journal.json"
    path.write_text("{not-json")
    with pytest.raises(DeployError,match="CONVERGENCE_JOURNAL_CORRUPT"):
        ConvergenceJournal(path).validate()
