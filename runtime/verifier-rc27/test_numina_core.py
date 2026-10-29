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

class NuminaAdaptiveControlV11Tests(unittest.TestCase):
    def samples(self):
        return [
            AuthorityDomainSample("A", 1_000_000, reserved_usd_minor=100_000, committed_usd_minor=100_000,
                                  uncertain_usd_minor=50_000, pending_legitimate_demand_usd_minor=700_000,
                                  activation_delay_seq=0, revocation_delay_seq=3,
                                  authority_velocity_usd_minor_per_seq=200_000, observation_lag_seq=3,
                                  dependency_ids=("issuer-1", "oracle-1")),
            AuthorityDomainSample("B", 600_000, reserved_usd_minor=50_000, committed_usd_minor=0,
                                  uncertain_usd_minor=0, pending_legitimate_demand_usd_minor=100_000,
                                  activation_delay_seq=2, revocation_delay_seq=1,
                                  authority_velocity_usd_minor_per_seq=100_000, observation_lag_seq=1,
                                  dependency_ids=("issuer-1",)),
        ]

    def test_145_physics_is_deterministic(self):
        a = AuthorityPhysicsV11.metrics(self.samples(), 10)
        b = AuthorityPhysicsV11.metrics(list(reversed(self.samples())), 10)
        self.assertEqual(a.digest(), b.digest())

    def test_146_horizon_mrec_respects_activation_delay(self):
        early = AuthorityPhysicsV11.metrics(self.samples(), 1)
        late = AuthorityPhysicsV11.metrics(self.samples(), 10)
        self.assertLessEqual(early.mrec_usd_minor, late.mrec_usd_minor)

    def test_147_liquidity_excludes_occupancy(self):
        m = AuthorityPhysicsV11.metrics(self.samples(), 10)
        self.assertEqual(m.liquid_authority_usd_minor, 1_300_000)

    def test_148_dependency_concentration_detected(self):
        m = AuthorityPhysicsV11.metrics(self.samples(), 10)
        self.assertEqual(m.dependency_concentration_bps, 10_000)

    def test_149_envelope_detects_multiple_breaches(self):
        m = AuthorityPhysicsV11.metrics(self.samples(), 10)
        env = SafetyEnvelope(100_000, 10_000, 50_000, 1, 5_000, 2_000)
        a = ContinuousSafetyEnvelope.assess(m, env)
        self.assertFalse(a.compliant)
        self.assertIn("MREC", a.breaches)
        self.assertIn("OBSERVATION_LAG", a.breaches)

    def test_150_envelope_assessment_is_deterministic(self):
        m = AuthorityPhysicsV11.metrics(self.samples(), 10)
        env = SafetyEnvelope(10_000_000, 1_000_000, 1_000_000, 10, 10_000, 100_000)
        self.assertEqual(ContinuousSafetyEnvelope.assess(m, env).assessment_digest,
                         ContinuousSafetyEnvelope.assess(m, env).assessment_digest)

    def test_151_adaptive_plan_never_expands_limits(self):
        env = SafetyEnvelope(300_000, 10_000, 50_000, 1, 5_000, 1_000)
        p = AdaptiveAuthorityController.plan(self.samples(), env, 10)
        self.assertTrue(all(i.new_limit_usd_minor <= i.old_limit_usd_minor for i in p.instructions))

    def test_152_adaptive_plan_never_expands_velocity(self):
        env = SafetyEnvelope(300_000, 10_000, 50_000, 1, 5_000, 1_000)
        p = AdaptiveAuthorityController.plan(self.samples(), env, 10)
        self.assertTrue(all(i.new_velocity_usd_minor_per_seq <= i.old_velocity_usd_minor_per_seq for i in p.instructions))

    def test_153_pressure_never_auto_expands(self):
        env = SafetyEnvelope(10_000_000, 1_000_000, 1_000_000, 10, 10_000, 100)
        p = AdaptiveAuthorityController.plan(self.samples(), env, 10)
        self.assertTrue(all(i.new_limit_usd_minor <= i.old_limit_usd_minor for i in p.instructions))

    def test_154_uncertainty_contraction_preserves_occupied_floor(self):
        env = SafetyEnvelope(10_000_000, 1, 1_000_000, 10, 10_000, 100_000)
        p = AdaptiveAuthorityController.plan(self.samples(), env, 10)
        a = [i for i in p.instructions if i.domain_id == "A"][0]
        occupied = self.samples()[0].occupied_usd_minor()
        self.assertGreaterEqual(a.new_limit_usd_minor, occupied)

    def test_155_non_expansion_proof_valid(self):
        env = SafetyEnvelope(300_000, 10_000, 50_000, 1, 5_000, 1_000)
        p = AdaptiveAuthorityController.plan(self.samples(), env, 10)
        proof = AdaptiveResponseProofs.prove_non_expansion(p)
        self.assertTrue(proof.valid)

    def test_156_expansive_instruction_rejected(self):
        with self.assertRaises(ConstitutionalError):
            ContractionInstruction("A", 10, 11, 1, 1, 1, 1, "bad")

    def test_157_stress_simulation_does_not_mutate_input(self):
        samples = self.samples()
        before = tuple(samples)
        AuthorityStressEngine.simulate(samples, StressScenario("shock", demand_multiplier_bps=20_000), 10)
        self.assertEqual(tuple(samples), before)

    def test_158_stress_uncertainty_increases_uncertain_metric(self):
        r = AuthorityStressEngine.simulate(self.samples(), StressScenario("u", uncertainty_add_usd_minor=100_000), 10)
        self.assertEqual(r.stressed_metrics.uncertain_usd_minor, r.before_metrics.uncertain_usd_minor + 100_000)

    def test_159_stress_contraction_cannot_erase_occupied_effect(self):
        r = AuthorityStressEngine.simulate(self.samples(), StressScenario("c", authority_multiplier_bps=0), 10)
        self.assertGreaterEqual(r.stressed_metrics.mrec_usd_minor, r.stressed_metrics.uncertain_usd_minor)

    def test_160_placement_conserves_parent_capacity(self):
        ds = [PlacementDomain("A", 600, 200, 100, 1000), PlacementDomain("B", 400, 100, 900, 1000)]
        p = DynamicAuthorityPlacement.plan(1000, ds)
        self.assertLessEqual(sum(p.allocation_map().values()), 1000)

    def test_161_placement_preserves_occupied_authority(self):
        ds = [PlacementDomain("A", 600, 500, 100, 1000), PlacementDomain("B", 400, 100, 900, 1000)]
        p = DynamicAuthorityPlacement.plan(1000, ds)
        self.assertGreaterEqual(p.allocation_map()["A"], 500)
        self.assertGreaterEqual(p.allocation_map()["B"], 100)

    def test_162_rebalance_marks_release_proof_domains(self):
        ds = [PlacementDomain("A", 900, 100, 50, 1000), PlacementDomain("B", 100, 50, 900, 1000)]
        p = DynamicAuthorityPlacement.plan(1000, ds)
        self.assertIn("A", p.requires_release_proof)

    def test_163_observation_lag_contracts_offline_horizon(self):
        env = SafetyEnvelope(10_000_000, 1_000_000, 1_000_000, 1, 10_000, 100_000)
        p = AdaptiveAuthorityController.plan(self.samples(), env, 10)
        a = [i for i in p.instructions if i.domain_id == "A"][0]
        self.assertLessEqual(a.new_offline_horizon_seq, 1)

    def test_164_empty_field_metrics_are_zero(self):
        m = AuthorityPhysicsV11.metrics([], 10)
        self.assertEqual(m, FieldMetrics(0,0,0,0,0,0,0,0,0))


# Re-register unittest execution after v1.1 tests defined.
if __name__ == '__main__':
    unittest.main()
