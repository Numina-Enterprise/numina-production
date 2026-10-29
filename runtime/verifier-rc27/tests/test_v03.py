import os,tempfile,unittest
from dataclasses import replace
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from numina.cbor import encode
from numina.status import StatusWitness,sign_witness,verify_witness
from numina.vm import AuthorityVM,AuthorityProgram,Instruction,Op
from numina.reachability import AuthorityReachability,ReachabilityEdge
from numina.transaction import AtomicCommitEngine
from numina.shards import ShardAllocator
from numina.handoff import ShardHandoff

class V03Tests(unittest.TestCase):
    def test_canonical_cbor_map_order(self):
        self.assertEqual(encode({'b':1,'a':2}), encode({'a':2,'b':1}))
    def test_cbor_rejects_float(self):
        with self.assertRaises(TypeError): encode({'x':1.2})
    def test_status_witness_chain(self):
        sk=Ed25519PrivateKey.generate(); pk=sk.public_key()
        w1=StatusWitness('D',10,'dep','CURRENT','0'*64,20,'W')
        s1=sign_witness(w1,sk); self.assertEqual(verify_witness(s1,pk,12)[1],'CURRENT')
        w2=StatusWitness('D',11,'dep2','CONTRACTED',w1.status_root,20,'W')
        s2=sign_witness(w2,sk); self.assertEqual(verify_witness(s2,pk,12,10,w1.status_root)[1],'CONTRACTED')
        self.assertEqual(verify_witness(s1,pk,12,11)[1],'WITNESS_ROLLBACK')
    def test_witness_equivocation_detectable_by_root(self):
        a=StatusWitness('D',10,'A','CURRENT','0'*64,20,'W')
        b=StatusWitness('D',10,'B','CURRENT','0'*64,20,'W')
        self.assertNotEqual(a.status_root,b.status_root)
    def test_vm_allow(self):
        p=AuthorityProgram('p','c',(Instruction(Op.CHECK_EQ,'asset','ETH'),Instruction(Op.CHECK_LE,'notional',100),Instruction(Op.DECIDE_ALLOW)))
        self.assertEqual(AuthorityVM().execute(p,{'asset':'ETH','notional':99})[0],'ALLOW')
        self.assertEqual(AuthorityVM().execute(p,{'asset':'ETH','notional':101})[0],'DENY')
    def test_vm_determinism(self):
        p=AuthorityProgram('p','c',(Instruction(Op.CHECK_NONNEG,'x'),Instruction(Op.DECIDE_ALLOW)))
        a=AuthorityVM().execute(p,{'x':4}); b=AuthorityVM().execute(p,{'x':4}); self.assertEqual(a,b)
    def test_reachability_mrec(self):
        r=AuthorityReachability([ReachabilityEdge('A','B',100),ReachabilityEdge('B','C',250)])
        self.assertEqual(r.mrec('A'),350)
    def test_min_cut(self):
        r=AuthorityReachability([ReachabilityEdge('A','B',1),ReachabilityEdge('B','C',1)])
        self.assertEqual(len(r.min_cut_single_edges('A','C')),2)
    def test_atomic_commit_nonce(self):
        with tempfile.TemporaryDirectory() as d:
            e=AtomicCommitEngine(os.path.join(d,'x.db')); e.begin_commit('op1','a1','n1',{'x':1})
            self.assertEqual(e.phase('op1'),'COMMITTING')
            with self.assertRaises(Exception): e.begin_commit('op2','a2','n1',{'x':2})
            e.close()
    def test_atomic_commit_auth_unique(self):
        with tempfile.TemporaryDirectory() as d:
            e=AtomicCommitEngine(os.path.join(d,'x.db')); e.begin_commit('op1','a1','n1',{'x':1})
            with self.assertRaises(Exception): e.begin_commit('op2','a1','n2',{'x':2})
            e.close()
    def test_zero_overlap_handoff(self):
        a=ShardAllocator(1000); s=a.allocate('A',600); target,proof=ShardHandoff.transfer(a,'A','B')
        self.assertFalse(s.live); self.assertTrue(target.live); self.assertEqual(target.capacity_usd_minor,600)
        self.assertEqual(proof.to_epoch,proof.from_epoch+1)
        a.assert_conservation()
    def test_handoff_refuses_occupied(self):
        a=ShardAllocator(1000); s=a.allocate('A',600); s.reserve(1,s.fencing_epoch)
        with self.assertRaises(RuntimeError): ShardHandoff.transfer(a,'A','B')

if __name__=='__main__': unittest.main()
