from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Iterable

from .deploy_provider import DeployError
from .signing import SigningIdentity, verify_envelope

WITNESS_HEAD_OBSERVATION_TYPE="NUMINA_WITNESS_HEAD_OBSERVATION"
WITNESS_CONSISTENCY_PROOF_TYPE="NUMINA_WITNESS_CONSISTENCY_PROOF"
WITNESS_SPLIT_VIEW_ALERT_TYPE="NUMINA_WITNESS_SPLIT_VIEW_ALERT"


def _canonical(v:dict)->bytes:
    return json.dumps(v,sort_keys=True,separators=(",",":")).encode()


def digest_json(v:dict)->str:
    return hashlib.sha256(_canonical(v)).hexdigest()


@dataclass(frozen=True)
class WitnessPeer:
    witness_id:str
    expected_public_key_b64:str

    def __post_init__(self):
        if not self.witness_id:
            raise ValueError("witness_id is required")
        if not self.expected_public_key_b64:
            raise ValueError("expected_public_key_b64 is required")


def create_head_observation(
    identity:SigningIdentity,
    *,
    witness_id:str,
    deployment_id:str,
    journal_head_digest:str|None,
    sequence:int,
)->dict:
    if sequence < 1:
        raise ValueError("sequence must be >= 1")
    return identity.sign(
        {
            "witness_id":witness_id,
            "deployment_id":deployment_id,
            "journal_head_digest":journal_head_digest,
            "sequence":sequence,
        },
        WITNESS_HEAD_OBSERVATION_TYPE,
    )


def verify_head_observation(
    observation:dict,
    *,
    peer:WitnessPeer,
    deployment_id:str,
)->bool:
    if not verify_envelope(
        observation,
        expected_public_key_b64=peer.expected_public_key_b64,
        expected_type=WITNESS_HEAD_OBSERVATION_TYPE,
    ):
        return False
    payload=observation.get("payload",{})
    return (
        payload.get("witness_id")==peer.witness_id
        and payload.get("deployment_id")==deployment_id
        and isinstance(payload.get("sequence"),int)
        and payload.get("sequence") >= 1
    )


class WitnessGossipAnalyzer:
    def __init__(self,identity:SigningIdentity,*,local_witness_id:str):
        self.identity=identity
        self.local_witness_id=local_witness_id

    def analyze(
        self,
        *,
        deployment_id:str,
        local_observation:dict,
        peer_observations:tuple[tuple[WitnessPeer,dict],...],
        minimum_matching_witnesses:int=1,
    )->dict:
        if minimum_matching_witnesses < 1:
            raise ValueError("minimum_matching_witnesses must be >= 1")

        local_payload=local_observation.get("payload",{})
        local_head=local_payload.get("journal_head_digest")
        local_seq=local_payload.get("sequence")
        if local_payload.get("witness_id")!=self.local_witness_id:
            raise DeployError("LOCAL_WITNESS_ID_MISMATCH")
        if local_payload.get("deployment_id")!=deployment_id:
            raise DeployError("LOCAL_DEPLOYMENT_ID_MISMATCH")

        valid_peers=[]
        invalid_peers=[]
        matching=[]
        conflicting=[]

        seen=set()
        for peer,observation in peer_observations:
            if peer.witness_id in seen:
                raise DeployError("DUPLICATE_GOSSIP_WITNESS_ID")
            seen.add(peer.witness_id)

            if not verify_head_observation(
                observation,
                peer=peer,
                deployment_id=deployment_id,
            ):
                invalid_peers.append(peer.witness_id)
                continue

            payload=observation["payload"]
            item={
                "witness_id":peer.witness_id,
                "journal_head_digest":payload.get("journal_head_digest"),
                "sequence":payload.get("sequence"),
                "observation_digest":digest_json(observation),
            }
            valid_peers.append(item)

            if payload.get("journal_head_digest")==local_head:
                matching.append(item)
            else:
                conflicting.append(item)

        if conflicting:
            payload={
                "deployment_id":deployment_id,
                "local_witness_id":self.local_witness_id,
                "local_journal_head_digest":local_head,
                "local_sequence":local_seq,
                "conflicting_observations":conflicting,
                "matching_observations":matching,
                "invalid_peers":invalid_peers,
            }
            alert=self.identity.sign(payload,WITNESS_SPLIT_VIEW_ALERT_TYPE)
            return {
                "consistent":False,
                "split_view":True,
                "matching_witnesses":matching,
                "conflicting_witnesses":conflicting,
                "invalid_peers":invalid_peers,
                "alert":alert,
                "alert_digest":digest_json(payload),
            }

        if len(matching) < minimum_matching_witnesses:
            raise DeployError(
                "WITNESS_GOSSIP_QUORUM_INSUFFICIENT:"+
                json.dumps({
                    "matching":len(matching),
                    "minimum":minimum_matching_witnesses,
                    "invalid_peers":invalid_peers,
                },sort_keys=True)
            )

        payload={
            "deployment_id":deployment_id,
            "journal_head_digest":local_head,
            "local_witness_id":self.local_witness_id,
            "local_sequence":local_seq,
            "matching_observations":matching,
            "invalid_peers":invalid_peers,
            "minimum_matching_witnesses":minimum_matching_witnesses,
        }
        proof=self.identity.sign(payload,WITNESS_CONSISTENCY_PROOF_TYPE)
        return {
            "consistent":True,
            "split_view":False,
            "matching_witnesses":matching,
            "invalid_peers":invalid_peers,
            "proof":proof,
            "proof_digest":digest_json(payload),
        }
