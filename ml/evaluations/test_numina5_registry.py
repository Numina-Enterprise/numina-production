import copy
import json
import unittest
from pathlib import Path
from validate_numina5_registry import validate

ROOT = Path(__file__).resolve().parents[2]
class RegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = json.loads((ROOT / "ml/model-registry/numina-5-candidates.json").read_text(encoding="utf-8"))
    def test_current_registry(self):
        self.assertEqual(validate(self.original), [])
    def test_duplicate_candidate_rejected(self):
        d = copy.deepcopy(self.original)
        d["candidates"].append(copy.deepcopy(d["candidates"][0]))
        self.assertTrue(validate(d))
    def test_unverified_pass_rejected(self):
        d = copy.deepcopy(self.original)
        d["candidates"][1]["admission"] = "PASS"
        self.assertTrue(validate(d))
    def test_treasury_authorization_rejected(self):
        d = copy.deepcopy(self.original)
        d["treasury_change_authorized"] = True
        self.assertTrue(validate(d))
    def test_provisional_score_must_remain_provisional(self):
        d = copy.deepcopy(self.original)
        d["candidates"][0]["verified_score"] = 100
        self.assertTrue(validate(d))
if __name__ == "__main__":
    unittest.main()
