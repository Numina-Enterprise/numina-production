import unittest
from numina_core import *


class NuminaFrozenConformanceTests(unittest.TestCase):
    def setUp(self):
        self.rt = NuminaRuntime(State(rights_capacity_usd_minor=2_000_000, final_eth_wei=3 * 10**18))

    def test_01_valid_buy(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i)
        self.assertEqual(self.rt.state.reserved_usd_minor, 300_000)

    def test_02_exposure_deny(self):
        i = make_intent(self.rt, notional_minor=3_000_000, qty_wei=10**18, px_minor=3_000_000)
        d, _ = self.rt.evaluate(i)
        self.assertEqual(d, Decision.DENY)

    def test_03_concurrent_buy(self):
        a = make_intent(self.rt, op="a", notional_minor=1_500_000, qty_wei=5*10**17, px_minor=3_000_000, nonce="a")
        self.rt.create_reservation(a)
        b = make_intent(self.rt, op="b", notional_minor=1_000_000, qty_wei=5*10**17, px_minor=2_000_000, nonce="b")
        d, _ = self.rt.evaluate(b)
        self.assertEqual(d, Decision.DENY)

    def test_04_concurrent_sell(self):
        a = make_intent(self.rt, op="a", side="SELL", qty_wei=2*10**18, notional_minor=0, nonce="a")
        self.rt.create_reservation(a)
        b = make_intent(self.rt, op="b", side="SELL", qty_wei=2*10**18, notional_minor=0, nonce="b")
        d, _ = self.rt.evaluate(b)
        self.assertEqual(d, Decision.DENY)

    def test_05_stale_epoch(self):
        i = make_intent(self.rt)
        self.rt.state.policy_epoch += 1
        self.assertEqual(self.rt.evaluate(i)[0], Decision.DENY)

    def test_06_aba(self):
        i = make_intent(self.rt)
        self.rt.state.policy_epoch += 1
        self.rt.state.policy_epoch += 1
        self.assertEqual(self.rt.evaluate(i)[0], Decision.DENY)

    def test_07_revoke(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i)
        self.rt.revoke()
        with self.assertRaises(ConstitutionalError):
            self.rt.begin_commit(i.operation_id)

    def test_08_single_commit(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i)
        self.rt.begin_commit(i.operation_id)
        with self.assertRaises(ConstitutionalError):
            self.rt.begin_commit(i.operation_id)

    def test_09_duplicate_rail(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i)
        self.rt.begin_commit(i.operation_id)
        self.assertIn(i.nonce, self.rt.state.consumed_nonces)

    def test_10_duplicate_fill(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i)
        self.rt.begin_commit(i.operation_id)
        self.rt.submission_accepted(i.operation_id)
        self.rt.fill_confirmed(i.operation_id, "f1", 10**17, 300_000)
        self.rt.fill_confirmed(i.operation_id, "f1", 10**17, 300_000)
        self.assertEqual(self.rt.operations[i.operation_id].cumulative_fill_wei, 10**17)

    def test_11_cumulative_fill_violation(self):
        i = make_intent(self.rt, qty_wei=10**17, notional_minor=30_000)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id)
        self.rt.fill_confirmed(i.operation_id, "f1", 6*10**16, 300_000)
        self.rt.fill_confirmed(i.operation_id, "f2", 6*10**16, 300_000)
        self.assertEqual(self.rt.operations[i.operation_id].legitimacy, Legitimacy.VIOLATION)

    def test_12_price_bound_violation(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id)
        self.rt.fill_confirmed(i.operation_id, "f1", 10**17, 400_000)
        self.assertEqual(self.rt.operations[i.operation_id].legitimacy, Legitimacy.VIOLATION)

    def test_13_partial_residual(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id)
        self.rt.fill_confirmed(i.operation_id, "f1", 5*10**17, 300_000)
        self.assertEqual(self.rt.operations[i.operation_id].cumulative_fill_wei, 5*10**17)

    def test_14_cancel_no_release(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id)
        before = self.rt.state.committed_usd_minor
        self.rt.cancel_requested(i.operation_id)
        self.assertEqual(before, self.rt.state.committed_usd_minor)

    def test_15_confirmed_cancel_releases_remainder(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id)
        self.rt.fill_confirmed(i.operation_id, "f1", 5*10**17, 300_000)
        self.rt.cancel_confirmed(i.operation_id)
        self.assertLess(self.rt.state.committed_usd_minor, 300_000)

    def test_16_timeout_uncertainty(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id)
        self.rt.submission_unknown(i.operation_id)
        self.assertEqual(self.rt.state.uncertain_usd_minor, 300_000)

    def test_17_nonexec_release(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id); self.rt.submission_unknown(i.operation_id)
        self.rt.non_execution_proven(i.operation_id)
        self.assertEqual(self.rt.state.uncertain_usd_minor, 0)

    def test_18_provisional_no_sell(self):
        self.rt.state.final_eth_wei = 0
        i = make_intent(self.rt)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id)
        self.rt.fill_confirmed(i.operation_id, "f1", 10**18, 300_000)
        self.rt.settlement_provisional(i.operation_id)
        sell = make_intent(self.rt, op="sell", side="SELL", qty_wei=10**18, notional_minor=0, nonce="sell")
        self.assertEqual(self.rt.evaluate(sell)[0], Decision.DENY)

    def test_19_finality_once(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id)
        self.rt.fill_confirmed(i.operation_id, "f1", 10**18, 300_000)
        self.rt.settlement_final(i.operation_id)
        with self.assertRaises(ConstitutionalError):
            self.rt.settlement_final(i.operation_id)

    def test_20_replay_digest(self):
        i = make_intent(self.rt)
        self.rt.create_reservation(i); self.rt.begin_commit(i.operation_id)
        d1 = self.rt.state.digest()
        rt2 = NuminaRuntime(State(rights_capacity_usd_minor=2_000_000, final_eth_wei=3*10**18))
        i2 = make_intent(rt2)
        rt2.create_reservation(i2); rt2.begin_commit(i2.operation_id)
        self.assertEqual(d1, rt2.state.digest())


if __name__ == '__main__':
    unittest.main()
