import json
import unittest
from pathlib import Path

from core_satellite_policy import load_preset, plan_core_satellite, validate_preset


class CoreSatellitePolicyTests(unittest.TestCase):
    def test_shared_golden_fixtures(self):
        fixtures = json.loads((Path(__file__).parent / "fixtures" / "core_satellite_cases.json").read_text(encoding="utf-8"))
        preset = load_preset()
        for fixture in fixtures:
            with self.subTest(fixture=fixture["name"]):
                if fixture["case"] == "validate":
                    self.assertEqual(fixture["expected"], validate_preset(preset))
                    continue
                result = plan_core_satellite(preset=preset, **fixture["input"])
                for key, expected in fixture["expected"].items():
                    if key == "items":
                        self.assertEqual(expected, next(row["finalAmount"] for row in result["items"] if row["symbol"] == "NVDA"))
                    else:
                        self.assertEqual(expected, result[key])

    def test_enhancement_and_concentration_guards(self):
        result = plan_core_satellite(base_budget=1000, crash_fund_remaining=500, spy_crash_enhancement=500, actual_allocations={"NVDA": 12, "AAPL": 12, "ASML": 12})
        self.assertLessEqual(result["items"][0]["crashFundEnhancement"], 150)
        self.assertEqual(0, result["items"][1]["finalAmount"])

    def test_qqq_is_signal_only(self):
        result = plan_core_satellite(base_budget=100, crash_fund_remaining=10, actual_allocations={"QQQ": 99})
        self.assertNotIn("QQQ", [row["symbol"] for row in result["items"]])
        self.assertFalse(result["summary"]["qqqGeneratesBuyAmount"])


if __name__ == "__main__":
    unittest.main()
