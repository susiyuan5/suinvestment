import json
import unittest
from pathlib import Path

from core_satellite_policy import allocations_for_core, allocation_metrics, load_preset, plan_core_satellite, validate_allocations, validate_preset


class CoreSatellitePolicyTests(unittest.TestCase):
    def test_v5_default_and_constraints(self):
        preset = load_preset()
        self.assertEqual("core-satellite-v5", preset["version"])
        self.assertEqual({"SPY": .4, "QQQ": .1, "NVDA": .125, "AAPL": .125, "ASML": .125, "KO": .125}, allocations_for_core(40))
        self.assertTrue(validate_preset(preset))
        self.assertTrue(validate_allocations({"SPY": .4, "QQQ": .1, "NVDA": .125, "AAPL": .125, "ASML": .125, "KO": .125})["valid"])
        self.assertFalse(validate_allocations({"SPY": .4, "QQQ": .1, "NVDA": .1501, "AAPL": .125, "ASML": .125, "KO": .0999})["valid"])
        self.assertEqual(100, allocation_metrics(allocations_for_core(40))["allocated"])

    def test_shortcuts(self):
        self.assertEqual({"SPY": .5, "QQQ": .1, "NVDA": .1, "AAPL": .1, "ASML": .1, "KO": .1}, allocations_for_core(50))
        self.assertEqual({"SPY": .6, "QQQ": .1, "NVDA": .075, "AAPL": .075, "ASML": .075, "KO": .075}, allocations_for_core(60))
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
        self.assertEqual(125, next(row["finalAmount"] for row in below["items"] if row["symbol"] == "NVDA"))
        self.assertEqual(0, next(row["finalAmount"] for row in at["items"] if row["symbol"] == "NVDA"))
        result = plan_core_satellite(base_budget=69.23, crash_fund_remaining=100, actual_allocations={})
        self.assertAlmostEqual(result["conservation"]["source"], sum(row["finalAmount"] for row in result["items"]) + result["cashRetained"], places=2)

    def test_optional_qqq_preserves_custom_satellite_funding(self):
        preset = load_preset()
        preset["growth_etfs"] = []
        allocations = {"SPY": .50, "NVDA": .10, "AAPL": .15, "ASML": .05, "KO": .20}
        for row in [preset["core"], *preset["satellites"]]: row["target_allocation"] = allocations[row["symbol"]]
        self.assertTrue(validate_preset(preset))
        result = plan_core_satellite(base_budget=100, crash_fund_remaining=0, preset=preset)
        self.assertEqual([["SPY", 50], ["NVDA", 10], ["AAPL", 15], ["ASML", 5], ["KO", 20]], [[row["symbol"], row["baseAmount"]] for row in result["items"]])
        self.assertEqual(100, result["totalPlanned"])

    def test_spy_base_is_not_reclassified_as_unexecuted_extra(self):
        result = plan_core_satellite(base_budget=100, crash_fund_remaining=0, satellite_decisions={"SPY": {"baseAmount": 40, "extraAmount": 8, "finalAmount": 48}})
        self.assertEqual(40, result["items"][0]["baseAmount"])
        self.assertEqual(0, result["items"][0]["extraAmount"])

    def test_subcent_cash_caps_are_rounded_down(self):
        for cash in [0.006, 0.016, 1.006]:
            result = plan_core_satellite(base_budget=100, crash_fund_remaining=0, portfolio_cash_cap=cash)
            self.assertLessEqual(result["totalPlanned"], cash)


if __name__ == "__main__":
    unittest.main()
