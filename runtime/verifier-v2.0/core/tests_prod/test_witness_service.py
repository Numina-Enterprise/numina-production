from __future__ import annotations

import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from numina_prod.signing import SigningIdentity, verify_envelope
from numina_prod.witness_service import WitnessLedger, WitnessServiceConfig, create_witness_app


def write_key(path:Path,key:Ed25519PrivateKey):
    path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))


def checkpoint(controller:SigningIdentity,head:str="head-a"):
    return controller.sign(
        {
            "deployment_id":"dep",
            "entry_count":1,
            "journal_head_digest":head,
            "deployment_entry_digests":["e1"],
        },
        "NUMINA_CONVERGENCE_CHECKPOINT",
    )


def config(tmp_path:Path,controller:SigningIdentity):
    witness_key=Ed25519PrivateKey.generate()
    witness_key_path=tmp_path/"witness.pem"
    write_key(witness_key_path,witness_key)
    c=WitnessServiceConfig()
    c.witness_id="w1"
    c.signing_key_file=str(witness_key_path)
    c.controller_public_key_b64=controller.public_key_b64
    c.ledger_path=tmp_path/"ledger.json"
    return c,SigningIdentity(witness_key)


def test_witness_accepts_valid_checkpoint_and_signs_attestation(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,witness_identity=config(tmp_path,controller)
    client=TestClient(create_witness_app(cfg))
    r=client.post("/v1/witness",json=checkpoint(controller))
    assert r.status_code==200,r.text
    body=r.json()
    assert body["accepted"]
    assert verify_envelope(
        body["attestation"],
        expected_public_key_b64=witness_identity.public_key_b64,
        expected_type="NUMINA_CONVERGENCE_WITNESS_ATTESTATION",
    )


def test_invalid_controller_signature_rejected(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    wrong=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,_=config(tmp_path,controller)
    r=TestClient(create_witness_app(cfg)).post("/v1/witness",json=checkpoint(wrong))
    assert r.status_code==403
    assert r.json()["detail"]["code"]=="CHECKPOINT_SIGNATURE_INVALID"


def test_same_head_is_idempotently_accepted(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,_=config(tmp_path,controller)
    client=TestClient(create_witness_app(cfg))
    cp=checkpoint(controller,"same-head")
    assert client.post("/v1/witness",json=cp).status_code==200
    assert client.post("/v1/witness",json=cp).status_code==200


def test_conflicting_head_detects_equivocation(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,_=config(tmp_path,controller)
    client=TestClient(create_witness_app(cfg))
    assert client.post("/v1/witness",json=checkpoint(controller,"head-a")).status_code==200
    r=client.post("/v1/witness",json=checkpoint(controller,"head-b"))
    assert r.status_code==409
    assert r.json()["detail"]["code"]=="CHECKPOINT_EQUIVOCATION_DETECTED"
    assert r.json()["detail"]["previous_journal_head_digest"]=="head-a"
    assert r.json()["detail"]["observed_journal_head_digest"]=="head-b"


def test_ledger_corruption_fails_closed(tmp_path):
    path=tmp_path/"ledger.json"
    path.write_text("{broken")
    ledger=WitnessLedger(path)
    try:
        ledger.snapshot()
        assert False
    except Exception as exc:
        assert "WITNESS_LEDGER_CORRUPT" in str(exc)


def test_docs_disabled(tmp_path):
    controller=SigningIdentity(Ed25519PrivateKey.generate())
    cfg,_=config(tmp_path,controller)
    client=TestClient(create_witness_app(cfg))
    assert client.get("/docs").status_code==404
    assert client.get("/redoc").status_code==404
    assert client.get("/openapi.json").status_code==404
