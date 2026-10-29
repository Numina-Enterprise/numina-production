import os,tempfile,unittest
from dataclasses import replace
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from numina.vm import AuthorityVM,AuthorityProgram,Instruction,Op
from numina.program import sign_program,verify_program
from numina.status import StatusWitness,sign_witness
from numina.live_conformance import LiveConformanceState,verify_live_conformance
from numina.pipeline import PersistentAuthorityPipeline
from numina.transaction import AtomicCommitEngine
from numina.dependency import DependencyClosure

class V04Tests(unittest.TestCase):
    def setUp(self):
        self.program_sk=Ed25519PrivateKey.generate(); self.program_pk=self.program_sk.public_key()
        self.witness_sk=Ed25519PrivateKey.generate(); self.witness_pk=self.witness_sk.public_key()
        self.constitution='c'*64
        self.compiler='d'*64
        self.program=AuthorityProgram('p',self.constitution,(
            Instruction(Op.CHECK_EQ,'asset','ETH'),
            Instruction(Op.CHECK_LE,'notional',100),
            Instruction(Op.DECIDE_ALLOW),))
        self.pc=sign_program(self.program,semantic_source_digest='s'*64,compiler_digest=self.compiler,
                             reachable_authority_digest='r'*64,approval_digest='a'*64,sk=self.program_sk)
        self.w=StatusWitness('D',10,'dep','CURRENT','0'*64,20,'W')
        self.sw=sign_witness(self.w,self.witness_sk)
        self.conf=LiveConformanceState('b'*64,self.constitution,'m'*64,self.program.program_digest(),
                                       self.w.status_root,'t'*64,44,0)
    def test_program_signature(self):
        self.assertEqual(verify_program(self.pc,self.program_pk,self.constitution,self.compiler)[1],'VALID_PROGRAM')
    def test_program_constitution_mismatch(self):
        self.assertEqual(verify_program(self.pc,self.program_pk,'x'*64,self.compiler)[1],'CONSTITUTION_MISMATCH')
    def test_program_compiler_mismatch(self):
        self.assertEqual(verify_program(self.pc,self.program_pk,self.constitution,'x'*64)[1],'COMPILER_MISMATCH')
    def test_live_conformance(self):
        self.assertEqual(verify_live_conformance(self.conf,required_constitution_digest=self.constitution,
                                                  required_program_digest=self.program.program_digest())[1],'CONFORMANT')
    def test_live_conformance_fails_closed(self):
        bad=replace(self.conf,failing_tests=1)
        self.assertEqual(verify_live_conformance(bad,required_constitution_digest=self.constitution)[1],'CONFORMANCE_UNHEALTHY')
    def test_dependency_root_deterministic(self):
        d=DependencyClosure(1,2,3,4,5,6,7,8,9)
        self.assertEqual(d.root,DependencyClosure(1,2,3,4,5,6,7,8,9).root)
    def test_dependency_dominance(self):
        self.assertTrue(DependencyClosure(2,2,2,2,2,2,2,2,2).dominates_or_equals(DependencyClosure(1,2,1,2,1,2,1,2,1)))
    def test_pipeline_commit(self):
        with tempfile.TemporaryDirectory() as d:
            e=AtomicCommitEngine(os.path.join(d,'x.db'))
            p=PersistentAuthorityPipeline(vm=AuthorityVM(),commit_engine=e,program_public_key=self.program_pk,
                witness_public_key=self.witness_pk,required_constitution_digest=self.constitution,expected_compiler_digest=self.compiler)
            status,receipt=p.execute_and_commit(proof_program=self.pc,witness=self.sw,conformance=self.conf,
                current_sequence=11,highest_seen=9,expected_prev=None,context={'asset':'ETH','notional':99},
                operation_id='op1',authorization_id='auth1',nonce='n1')
            self.assertEqual(status,'COMMITTED'); self.assertEqual(e.phase('op1'),'COMMITTING'); self.assertTrue(receipt.receipt_digest)
            e.close()
    def test_pipeline_denies_vm(self):
        with tempfile.TemporaryDirectory() as d:
            e=AtomicCommitEngine(os.path.join(d,'x.db'))
            p=PersistentAuthorityPipeline(vm=AuthorityVM(),commit_engine=e,program_public_key=self.program_pk,
                witness_public_key=self.witness_pk,required_constitution_digest=self.constitution,expected_compiler_digest=self.compiler)
            status,receipt=p.execute_and_commit(proof_program=self.pc,witness=self.sw,conformance=self.conf,
                current_sequence=11,highest_seen=9,expected_prev=None,context={'asset':'ETH','notional':101},
                operation_id='op1',authorization_id='auth1',nonce='n1')
            self.assertEqual(status,'DENY'); self.assertIsNone(receipt); self.assertIsNone(e.phase('op1')); e.close()
    def test_pipeline_replay_fails_atomically(self):
        with tempfile.TemporaryDirectory() as d:
            e=AtomicCommitEngine(os.path.join(d,'x.db'))
            p=PersistentAuthorityPipeline(vm=AuthorityVM(),commit_engine=e,program_public_key=self.program_pk,
                witness_public_key=self.witness_pk,required_constitution_digest=self.constitution,expected_compiler_digest=self.compiler)
            kwargs=dict(proof_program=self.pc,witness=self.sw,conformance=self.conf,current_sequence=11,highest_seen=9,
                expected_prev=None,context={'asset':'ETH','notional':99},authorization_id='auth1',nonce='n1')
            self.assertEqual(p.execute_and_commit(operation_id='op1',**kwargs)[0],'COMMITTED')
            with self.assertRaises(Exception): p.execute_and_commit(operation_id='op2',**kwargs)
            e.close()

if __name__=='__main__': unittest.main()
