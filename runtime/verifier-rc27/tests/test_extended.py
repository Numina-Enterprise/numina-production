import os, tempfile, unittest, random
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from numina_core import *
from numina.eac import *
from numina.store import SQLiteEventStore
from numina.shards import ShardAllocator
from numina.oracle import oracle_buy_decision

CONSTITUTION="numina-c1-c14-v0.2"
class ExtendedTests(unittest.TestCase):
    def test_21_signed_eac_valid(self):
        sk,pk=generate_keypair(); rt=NuminaRuntime(State(rights_capacity_usd_minor=1_000_000)); i=make_intent(rt)
        e=EAC(i.authorization_id,i.operation_id,i.principal_id,i.agent_id,i.mandate_id,i.asset,i.side,i.rail,i.max_quantity_wei,i.max_price_usd_minor_per_eth,i.max_notional_usd_minor,i.nonce,dependency_root(i.deps),rt.state.digest(),CONSTITUTION,"issuer-1",rt.state.sequence,rt.state.sequence+10)
        ok,reason=verify(sign(e,sk),pk,RecognitionProfile("rp",("issuer-1",),(CONSTITUTION,),("SIM_A",)),rt.state.sequence,rt.state.consumed_nonces)
        self.assertTrue(ok); self.assertEqual(reason,"VALID_FOR_COMMIT")
    def test_22_signature_tamper(self):
        sk,pk=generate_keypair(); e=EAC("a","o","p","g","m","ETH","BUY","SIM_A",1,1,1,"n","d","s",CONSTITUTION,"issuer-1",0,10); s=sign(e,sk)
        bad=SignedEAC(EAC(**{**e.__dict__,"max_notional_usd_minor":2}),s.signature_hex)
        self.assertFalse(verify(bad,pk,RecognitionProfile("rp",("issuer-1",),(CONSTITUTION,),("SIM_A",)),0,set())[0])
    def test_23_unrecognized_issuer(self):
        sk,pk=generate_keypair(); e=EAC("a","o","p","g","m","ETH","BUY","SIM_A",1,1,1,"n","d","s",CONSTITUTION,"bad",0,10)
        self.assertEqual(verify(sign(e,sk),pk,RecognitionProfile("rp",("good",),(CONSTITUTION,),("SIM_A",)),0,set())[1],"UNRECOGNIZED_ISSUER")
    def test_24_eac_expired(self):
        sk,pk=generate_keypair(); e=EAC("a","o","p","g","m","ETH","BUY","SIM_A",1,1,1,"n","d","s",CONSTITUTION,"issuer-1",0,1)
        self.assertEqual(verify(sign(e,sk),pk,RecognitionProfile("rp",("issuer-1",),(CONSTITUTION,),("SIM_A",)),2,set())[1],"EXPIRED")
    def test_25_persistent_event_chain(self):
        fd,path=tempfile.mkstemp(); os.close(fd)
        try:
            st=SQLiteEventStore(path); st.append(1,"X","o",{},"a","b"); st.append(2,"Y","o",{},"b","c"); self.assertTrue(st.verify_chain("a"))
        finally:
            try: st.close()
            except Exception: pass
            os.remove(path)
    def test_26_event_chain_rejects_wrong_pre(self):
        fd,path=tempfile.mkstemp(); os.close(fd)
        try:
            st=SQLiteEventStore(path); st.append(1,"X","o",{},"a","b")
            with self.assertRaises(RuntimeError): st.append(2,"Y","o",{},"z","c")
        finally:
            try: st.close()
            except Exception: pass
            os.remove(path)
    def test_27_shard_conservation(self):
        a=ShardAllocator(100); a.allocate("A",60)
        with self.assertRaises(RuntimeError): a.allocate("B",50)
    def test_28_fencing(self):
        a=ShardAllocator(100); s=a.allocate("A",100); epoch=s.fencing_epoch; s.recall()
        with self.assertRaises(RuntimeError): s.reserve(1,epoch)
    def test_29_release_requires_clear(self):
        a=ShardAllocator(100); s=a.allocate("A",100); s.reserve(10,s.fencing_epoch)
        with self.assertRaises(RuntimeError): s.release_proof()
    def test_30_oracle_equivalence_randomized(self):
        rnd=random.Random(42)
        for n in range(1000):
            cap=rnd.randint(0,2_000_000); r=rnd.randint(0,cap); c=rnd.randint(0,max(0,cap-r)); u=rnd.randint(0,max(0,cap-r-c)); rt=NuminaRuntime(State(rights_capacity_usd_minor=cap,reserved_usd_minor=r,committed_usd_minor=c,uncertain_usd_minor=u))
            q=rnd.randint(0,10**18); px=rnd.randint(1,500_000); notional=rnd.randint(0,1_000_000); i=make_intent(rt,qty_wei=q,px_minor=px,notional_minor=notional,nonce=f"n{n}")
            got=rt.evaluate(i)[0].value; exp=oracle_buy_decision(rights_capacity=cap,reserved=r,committed=c,uncertain=u,qty_wei=q,price_minor=px,notional_minor=notional)
            self.assertEqual(got,exp)
    def test_31_randomized_conservation(self):
        rnd=random.Random(7)
        for _ in range(300):
            cap=rnd.randint(1,1_000_000); rt=NuminaRuntime(State(rights_capacity_usd_minor=cap)); amount=rnd.randint(0,cap)
            i=make_intent(rt,notional_minor=amount,qty_wei=0,nonce=str(_))
            rt.create_reservation(i); rt.assert_invariants()
            self.assertLessEqual(rt.state.reserved_usd_minor+rt.state.committed_usd_minor+rt.state.uncertain_usd_minor,cap)
    def test_32_failure_never_frees_unknown(self):
        rt=NuminaRuntime(State(rights_capacity_usd_minor=500_000)); i=make_intent(rt); rt.create_reservation(i); rt.begin_commit(i.operation_id); before=rt.state.available_usd_minor(); rt.submission_unknown(i.operation_id); self.assertLessEqual(rt.state.available_usd_minor(),before)

if __name__=='__main__': unittest.main()
