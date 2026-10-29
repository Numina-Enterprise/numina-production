from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

from .deploy_provider import DeployError
from .signing import SigningIdentity, verify_envelope

CONVERGENCE_CHECKPOINT_TYPE="NUMINA_CONVERGENCE_CHECKPOINT"


def _canonical(v:dict)->bytes:
    return json.dumps(v,sort_keys=True,separators=(",",":")).encode()


def digest_json(v:dict)->str:
    return hashlib.sha256(_canonical(v)).hexdigest()


@dataclass(frozen=True)
class JournalEntry:
    sequence:int
    deployment_id:str
    cycle:int
    prior_entry_digest:str|None
    routing_digest:str
    selected_room_ids:tuple[str,...]
    verified_room_ids:tuple[str,...]
    unhealthy_room_ids:tuple[str,...]
    converged:bool


class ConvergenceJournal:
    """Append-only hash-chained convergence journal.

    The journal stores every cycle as an immutable logical record. Each record
    binds the digest of the previous record. Rewriting, removing, or reordering
    entries breaks validation.
    """

    def __init__(self,path:Path):
        self.path=Path(path)

    def _load(self)->dict:
        if not self.path.exists():
            return {"entries":[]}
        try:
            state=json.loads(self.path.read_text())
        except Exception as exc:
            raise DeployError("CONVERGENCE_JOURNAL_CORRUPT") from exc
        if not isinstance(state,dict) or not isinstance(state.get("entries"),list):
            raise DeployError("CONVERGENCE_JOURNAL_CORRUPT")
        return state

    def _save(self,state:dict)->None:
        self.path.parent.mkdir(parents=True,exist_ok=True)
        tmp=self.path.with_suffix(self.path.suffix+".tmp")
        tmp.write_text(json.dumps(state,sort_keys=True,indent=2)+"\n")
        os.replace(tmp,self.path)

    def append_cycle(
        self,
        *,
        deployment_id:str,
        cycle:int,
        routing_digest:str,
        selected_room_ids:tuple[str,...],
        verified_room_ids:tuple[str,...],
        unhealthy_room_ids:tuple[str,...],
        converged:bool,
    )->dict:
        state=self._load()
        self.validate_state(state)
        prior=state["entries"][-1]["entry_digest"] if state["entries"] else None
        entry=JournalEntry(
            sequence=len(state["entries"])+1,
            deployment_id=deployment_id,
            cycle=cycle,
            prior_entry_digest=prior,
            routing_digest=routing_digest,
            selected_room_ids=selected_room_ids,
            verified_room_ids=verified_room_ids,
            unhealthy_room_ids=unhealthy_room_ids,
            converged=converged,
        )
        payload=entry.__dict__
        entry_digest=digest_json(payload)
        stored={**payload,"entry_digest":entry_digest}
        state["entries"].append(stored)
        self._save(state)
        return stored

    @staticmethod
    def validate_state(state:dict)->bool:
        entries=state.get("entries",[])
        prior=None
        for idx,entry in enumerate(entries,1):
            if entry.get("sequence")!=idx:
                raise DeployError("CONVERGENCE_JOURNAL_SEQUENCE_INVALID")
            if entry.get("prior_entry_digest")!=prior:
                raise DeployError("CONVERGENCE_JOURNAL_CHAIN_INVALID")
            payload={k:v for k,v in entry.items() if k!="entry_digest"}
            actual=digest_json(payload)
            if actual!=entry.get("entry_digest"):
                raise DeployError("CONVERGENCE_JOURNAL_ENTRY_DIGEST_INVALID")
            prior=actual
        return True

    def validate(self)->bool:
        return self.validate_state(self._load())

    def head_digest(self)->str|None:
        state=self._load()
        self.validate_state(state)
        return state["entries"][-1]["entry_digest"] if state["entries"] else None

    def checkpoint(self,identity:SigningIdentity,*,deployment_id:str)->dict:
        state=self._load()
        self.validate_state(state)
        matching=[e for e in state["entries"] if e["deployment_id"]==deployment_id]
        payload={
            "deployment_id":deployment_id,
            "entry_count":len(matching),
            "journal_head_digest":self.head_digest(),
            "deployment_entry_digests":[e["entry_digest"] for e in matching],
        }
        return identity.sign(payload,CONVERGENCE_CHECKPOINT_TYPE)


def verify_checkpoint(
    checkpoint:dict,
    *,
    expected_public_key_b64:str,
    expected_head_digest:str|None,
)->bool:
    if not verify_envelope(
        checkpoint,
        expected_public_key_b64=expected_public_key_b64,
        expected_type=CONVERGENCE_CHECKPOINT_TYPE,
    ):
        return False
    return checkpoint["payload"].get("journal_head_digest")==expected_head_digest
