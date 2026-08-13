import json
import unittest
from datetime import date
from pathlib import Path

from research.idea_engine.v3.short_term_trade_plan import (
    calculate_position_size,
    compute_indicators,
    evaluate_plan,
    finite,
)


ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "data" / "short-term-trade-plan-v1.json").read_text(encoding="utf-8"))


def series(values, *, volume=100):
    rows = []
    for index, close in enumerate(values):
        rows.append({"date": date(2026, 1, 1).fromordinal(date(2026, 1, 1).toordinal() + index).isoformat(), "open": close, "high": close + 1, "low": close - 1, "close": close, "volume": volume})
    return rows


class ShortTermTradePlanTests(unittest.TestCase):
    def candidate(self, **overrides):
        value = {"ticker": "TEST", "status": "B_WATCH", "evidence_coverage_score": 90, "event_dates": {"earnings": "2030-01-01"}}
        value.update(overrides)
        return value

    def test_indicators_are_deterministic_and_reject_short_history(self):
        with self.assertRaises(ValueError):
            compute_indicators(series([100] * 20), series([100] * 20), CONFIG)
        indicators = compute_indicators(series([100 + i * 0.2 for i in range(80)]), series([100 + i * 0.1 for i in range(80)]), CONFIG)
        self.assertGreater(indicators["atr14"], 0)
        self.assertEqual(indicators["signal_date"], "2026-03-21")

    def test_future_and_stale_data_are_blocked(self):
        rows = series([100 + i * 0.2 for i in range(80)])
        future = evaluate_plan(self.candidate(), rows, rows, CONFIG, as_of="2026-03-20")
        self.assertIn("future_data_detected", future["reason_codes"])
        stale = evaluate_plan(self.candidate(), rows, rows, CONFIG, as_of="2026-04-10")
        self.assertIn("stale_price_data", stale["reason_codes"])
        self.assertEqual(stale["status"], "blocked")

    def test_event_unknown_is_simulation_only(self):
        rows = series([100 + i * 0.2 for i in range(80)])
        rows[-1]["close"] = 130
        rows[-1]["high"] = 131
        rows[-1]["open"] = 129
        rows[-1]["volume"] = 200
        benchmark = series([100 + i * 0.1 for i in range(80)])
        result = evaluate_plan(self.candidate(event_dates={}), rows, benchmark, CONFIG, as_of="2026-03-21")
        self.assertEqual(result["status"], "blocked")
        self.assertIn("risk_distance_out_of_bounds", result["reason_codes"])
        self.assertIn("event_date_unknown", result["reason_codes"])
        self.assertTrue(result["research_only"])
        self.assertTrue(result["no_trade"])

    def test_missing_sizing_inputs_do_not_create_shares(self):
        result = calculate_position_size(None, 1000, 100, 95, CONFIG)
        self.assertIsNone(result["shares"])
        result = calculate_position_size(100000, 10000, 100, 95, CONFIG)
        self.assertGreaterEqual(result["shares"], 0)
        self.assertLessEqual(result["notional"], 2000)

    def test_invalid_numbers_fail_safe(self):
        self.assertIsNone(finite("Infinity"))
        self.assertIsNone(finite(None))
        result = evaluate_plan(self.candidate(), [{"close": "bad"}], [], CONFIG, as_of="2026-03-21")
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["signal"], None)


if __name__ == "__main__":
    unittest.main()
