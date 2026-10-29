from __future__ import annotations
from dataclasses import dataclass
from .vm import AuthorityVM
from .program import ProofCarryingProgram, verify_program
from .status import SignedStatusWitness, verify_witness
from .live_conformance import LiveConformanceState, verify_live_conformance
from .transaction import AtomicCommitEngine
from .canonical import digest

@dataclass(frozen=True)
class ExecutionReceipt:
    operation_id:str
    authorization_id:str
    program_digest:str
    status_root:str
    context_digest:str
    commit_digest:str
    decision:str
    conformance_root:str

    @property
    def receipt_digest(self)->str:
        return digest(self)

class PersistentAuthorityPipeline:
    def __init__(self, *, vm:AuthorityVM, commit_engine:AtomicCommitEngine,
                 program_public_key, witness_public_key,
                 required_constitution_digest:str, expected_compiler_digest:str|None=None):
        self.vm=vm
        self.commit_engine=commit_engine
        self.program_public_key=program_public_key
        self.witness_public_key=witness_public_key
        self.required_constitution_digest=required_constitution_digest
        self.expected_compiler_digest=expected_compiler_digest

    def execute_and_commit(self, *, proof_program:ProofCarryingProgram, witness:SignedStatusWitness,
                           conformance:LiveConformanceState, current_sequence:int, highest_seen:int,
                           expected_prev:str|None, context:dict, operation_id:str,
                           authorization_id:str, nonce:str):
        ok,reason=verify_program(proof_program,self.program_public_key,self.required_constitution_digest,self.expected_compiler_digest)
        if not ok: return reason,None
        ok,reason=verify_witness(witness,self.witness_public_key,current_sequence,highest_seen,expected_prev)
        if not ok: return reason,None
        ok,reason=verify_live_conformance(conformance,required_constitution_digest=self.required_constitution_digest,
                                          required_program_digest=proof_program.program.program_digest())
        if not ok: return reason,None
        decision,trace=self.vm.execute(proof_program.program,context)
        if decision!='ALLOW': return decision,None
        payload={
            'operation_id':operation_id,
            'authorization_id':authorization_id,
            'nonce':nonce,
            'program_digest':proof_program.program.program_digest(),
            'status_root':witness.witness.status_root,
            'context_digest':digest(context),
            'conformance_root':conformance.conformance_root,
            'vm_trace_digest':digest(trace),
        }
        commit_digest=self.commit_engine.begin_commit(operation_id,authorization_id,nonce,payload)
        receipt=ExecutionReceipt(operation_id,authorization_id,proof_program.program.program_digest(),
                                 witness.witness.status_root,digest(context),commit_digest,decision,
                                 conformance.conformance_root)
        return 'COMMITTED',receipt
