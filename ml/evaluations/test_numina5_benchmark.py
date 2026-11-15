import unittest
from numina5_benchmark import evaluate

CASES = [{"id": "a", "expected": "4"}, {"id": "b", "expected": "blue"}]
class BenchmarkTests(unittest.TestCase):
    def test_complete_pass_is_fixture_only(self):
        r = evaluate(CASES, {"a": "4", "b": "blue"}, "fixture", "sha256:fixture")
        self.assertEqual((r["disposition"], r["score"]), ("PASS", 1.0))
        self.assertIn("Offline fixture", r["note"])
    def test_missing_is_not_run(self):
        r = evaluate(CASES, {"a": "4"}, "fixture", "sha256:fixture")
        self.assertEqual(r["disposition"], "INCONCLUSIVE")
        self.assertEqual(r["results"][1]["status"], "NOT_RUN")
    def test_wrong_is_fail(self):
        r = evaluate(CASES, {"a": "5", "b": "blue"}, "fixture", "sha256:fixture")
        self.assertEqual(r["disposition"], "FAIL")
    def test_duplicate_case_rejected(self):
        with self.assertRaises(ValueError):
            evaluate(CASES + [CASES[0]], {}, "fixture", "sha256:fixture")
    def test_missing_checkpoint_rejected(self):
        with self.assertRaises(ValueError):
            evaluate(CASES, {}, "fixture", "")
if __name__ == "__main__":
    unittest.main()
