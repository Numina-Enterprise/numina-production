from __future__ import annotations
from numina.canonical import digest
from numina.eac import verify as verify_eac
from numina.program import verify_program
from numina.status import verify_witness
from numina.live_conformance import verify_live_conformance
from numina.control_mesh import EndpointDecision
from numina.continuous_runtime import NetworkExecutionReceipt

class ProductionContinuousRuntime:
    """Database-portable production execution shell over frozen v1.8 verification semantics.

    It does not connect to exchanges, custodians, wallets, payment rails, or employer systems.
    It commits only Numina authority/session/obligation state.
    """
    def __init__(self,*,store,vm,eac_public_keys,program_public_key,witness_public_key,
                 required_constitution_digest:str,expected_compiler_digest:str|None=None):
        self.store=store;self.vm=vm;self.eac_public_keys=dict(eac_public_keys)
        self.program_public_key=program_public_key;self.witness_public_key=witness_public_key
        self.required_constitution_digest=required_constitution_digest;self.expected_compiler_digest=expected_compiler_digest
    def open_session(self,*a,**k):return self.store.open_session(*a,**k)
    def set_route_fence(self,*a,**k):return self.store.set_route_fence(*a,**k)
    def close_session(self,*a,**k):return self.store.close_session(*a,**k)
    def session_state(self,*a,**k):return self.store.session_state(*a,**k)
    def obligation_state(self,*a,**k):return self.store.obligation_state(*a,**k)
    def reconcile_obligation(self,*a,**k):return self.store.reconcile_obligation(*a,**k)
    def close(self):return self.store.close()

    def execute(self,*,signed_eac,recognition_profile,endpoint,authority_class,consequence_usd_minor,
                status_age_ms,proof_program,witness,conformance,current_sequence,highest_seen_witness,
                expected_prev_witness,context,session_id,route_id,route_epoch,obligation_id,
                creditor_domain,debtor_domain,risk_adding,health):
        e=signed_eac.credential
        pk=self.eac_public_keys.get(e.issuer_id)
        if pk is None:return "UNRECOGNIZED_ISSUER_KEY",None
        ok,reason=verify_eac(signed_eac,pk,recognition_profile,current_sequence,self.store.consumed_nonces())
        if not ok:return reason,None
        if e.constitution_digest!=self.required_constitution_digest:return "CONSTITUTION_MISMATCH",None
        if e.operation_id=="" or e.authorization_id=="":return "INVALID_OPERATION_BINDING",None
        if consequence_usd_minor>e.max_notional_usd_minor:return "EAC_CONSEQUENCE_BOUND_EXCEEDED",None
        ep_decision,ep_reason=endpoint.verify_request(authority_class=authority_class,consequence_usd_minor=consequence_usd_minor,constitution_digest=e.constitution_digest,issuer=e.issuer_id,status_age_ms=status_age_ms)
        if ep_decision!=EndpointDecision.VALID_FOR_COMMIT:return ep_reason,None
        ok,reason=verify_program(proof_program,self.program_public_key,self.required_constitution_digest,self.expected_compiler_digest)
        if not ok:return reason,None
        ok,reason=verify_witness(witness,self.witness_public_key,current_sequence,highest_seen_witness,expected_prev_witness)
        if not ok:return reason,None
        if witness.witness.dependency_closure_root!=e.dependency_root:return "DEPENDENCY_ROOT_MISMATCH",None
        ok,reason=verify_live_conformance(conformance,required_constitution_digest=self.required_constitution_digest,required_program_digest=proof_program.program.program_digest())
        if not ok:return reason,None
        decision,trace=self.vm.execute(proof_program.program,context)
        if decision!="ALLOW":return decision,None
        # Store repeats all state-dependent limits and health contraction against the
        # session policy under the database lock.
        payload={
            "operation_id":e.operation_id,"authorization_id":e.authorization_id,"session_id":session_id,
            "route_id":route_id,"route_epoch":route_epoch,"program_digest":proof_program.program.program_digest(),
            "status_root":witness.witness.status_root,"context_digest":digest(context),
            "conformance_root":conformance.conformance_root,"vm_trace_digest":digest(trace),
            "consequence_usd_minor":consequence_usd_minor,"health_state":health.state.value,
        }
        status,commit_digest=self.store.commit_execution(eac=e,session_id=session_id,route_id=route_id,route_epoch=route_epoch,
            current_sequence=current_sequence,authority_class=authority_class,consequence_usd_minor=consequence_usd_minor,
            health=health,risk_adding=risk_adding,obligation_id=obligation_id,creditor_domain=creditor_domain,debtor_domain=debtor_domain,payload=payload)
        if status!="COMMITTED":return status,None
        receipt=NetworkExecutionReceipt(e.operation_id,e.authorization_id,session_id,route_id,route_epoch,obligation_id,
            proof_program.program.program_digest(),witness.witness.status_root,digest(context),commit_digest,conformance.conformance_root)
        return "COMMITTED",receipt
