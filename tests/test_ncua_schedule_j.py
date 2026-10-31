import unittest
from dataclasses import replace
from compliance.ncua_schedule_j import empty_registry, validate_registry, reporting_ready

class ScheduleJGateTests(unittest.TestCase):
    def test_empty_registry_is_complete_but_not_reporting_ready(self):
        slots = empty_registry()
        self.assertEqual(len(slots), 26)
        self.assertTrue(validate_registry(slots))
        self.assertFalse(reporting_ready(slots))
    def test_duplicate_slot_rejected(self):
        slots = list(empty_registry())
        slots[-1] = slots[0]
        with self.assertRaises(ValueError):
            validate_registry(slots)
    def test_unverified_implementation_rejected(self):
        slots = list(empty_registry())
        slots[0] = replace(slots[0], state="IMPLEMENTED_UNVERIFIED")
        with self.assertRaises(ValueError):
            validate_registry(slots)
    def test_unverified_independence_rejected(self):
        slots = list(empty_registry())
        slots[0] = replace(slots[0], state="INDEPENDENTLY_VERIFIED",
                           design_ref="design", implementation_ref="source")
        with self.assertRaises(ValueError):
            validate_registry(slots)
    def test_partial_official_definition_rejected(self):
        slots = list(empty_registry())
        slots[0] = replace(slots[0], official_code="UNVERIFIED")
        with self.assertRaises(ValueError):
            validate_registry(slots)

if __name__ == "__main__":
    unittest.main()
