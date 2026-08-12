import json
import unittest
from pathlib import Path

from core_satellite_policy import allocations_for_core, allocation_metrics, load_preset, plan_core_satellite, validate_allocations, validate_preset


class CoreSatellitePolicyTests(unittest.TestCase):
    def test_v3_default_and_constraints(self):
        preset = load_preset()
        self.assertEqual("core-satellite-v3", preset["version"])
        self.assertEqual({"SPY": .4, "NVDA": .14, "AAPL": .14, "ASML": .12, "KO": .1, "BYDDY": .1}, allocations_for_core(40))
        self.assertTrue(validate_preset(preset))
        self.assertTrue(validate_allocations({"SPY": .4, "NVDA": .15, "AAPL": .14, "ASML": .11, "KO": .1, "BYDDY": .1})["valid"])
        self.assertFalse(validate_allocations({"SPY": .4, "NVDA": .1501, "AAPL": .14, "ASML": .11, "KO": .1, "BYDDY": .0999})["valid"])
        self.assertFalse(validate_allocations({"SPY": .4, "NVDA": .14, "AAPL": .14, "ASML": .1201, "KO": .1, "BYDDY": .0999})["valid"])
        self.assertEqual(100, allocation_metrics(allocations_for_core(40))["allocated"])

    def test_shortcuts(self):
        self.assertEqual({"SPY": .5, "NVDA": .1, "AAPL": .1, "ASML": .1, "KO": .1, "BYDDY": .1}, allocations_for_core(50))
        self.assertEqual({"SPY": .6, "NVDA": .08, "AAPL": .08, "ASML": .08, "KO": .08, "BYDDY": .08}, allocations_for_core(60))
        self.assertIsNone(allocations_for_core(39))

    def test_shared_golden_fixtures(self):
        fixtures = json.loads((Path(__file__).parent / "fixtures" / "core_satellite_cases.json").read_text(encoding="utf-8"))
        preset = load_preset()
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                if fixture["case"] == "validate":
                    self.assertEqual(fixture["expected"], validate_preset(preset))
                else:
                    result = plan_core_satellite(preset=preset, **fixture["input"])
                    for key, expected in fixture["expected"].items():
                        self.assertEqual(expected, next(row["finalAmount"] for row in result["items"] if row["symbol"] == "NVDA") if key == "items" else result[key])

    def test_actual_concentration_boundary_and_conservation(self):
        below = plan_core_satellite(base_budget=1000, crash_fund_remaining=0, actual_allocations={"NVDA": 17.99})
        at = plan_core_satellite(base_budget=1000, crash_fund_remaining=0, actual_allocations={"NVDA": 18})
        self.assertEqual(140, below["items"][1]["finalAmount"])
        self.assertEqual(0, at["items"][1]["finalAmount"])
        result = plan_core_satellite(base_budget=69.23, crash_fund_remaining=100, actual_allocations={})
        self.assertAlmostEqual(result["conservation"]["source"], sum(row["finalAmount"] for row in result["items"]) + result["cashRetained"], places=2)


if __name__ == "__main__":
    unittest.main()
