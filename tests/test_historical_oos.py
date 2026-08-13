import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from research.idea_engine.v3.historical_oos import (
    ROUND_TRIP_COST_BPS,
    block_bootstrap_rate,
    generate,
    outcome_at,
    permanent_oos_split,
    timing_score,
)


ROOT = Path(__file__).resolve().parents[1]


def market_row(day, price, *, adjusted=None):
    return {
        "date": day.isoformat() if hasattr(day, "isoformat") else day,
        "open": price,
        "high": price * 1.02,
        "low": price * 0.98,
        "close": price,
        "adjusted": price if adjusted is None else adjusted,
        "volume": 1_000_000,
    }


class HistoricalOosTests(unittest.TestCase):
    def test_outcome_uses_next_adjusted_open_and_cost(self):
        rows = [market_row(f"2026-01-{index + 1:02d}", 100 + index) for index in range(22)]
        benchmark = [market_row(f"2026-01-{index + 1:02d}", 200 + index) for index in range(22)]
        result = outcome_at(rows, benchmark, 0, forward_days=20)
        expected = (120 / 101 - 1) - (220 / 201 - 1)
        self.assertEqual(result["entry_date"], "2026-01-02")
        self.assertEqual(result["exit_date"], "2026-01-21")
        self.assertAlmostEqual(result["net_relative_return"], expected - ROUND_TRIP_COST_BPS / 10_000)

    def test_permanent_oos_split_purges_future_outcomes(self):
        start = date(2024, 1, 5)
        records = []
        for index in range(30):
            signal = start + timedelta(days=index * 7)
            records.append({
                "signal_date": signal.isoformat(),
                "exit_date": (signal + timedelta(days=28)).isoformat(),
            })
        train, test, split = permanent_oos_split(records)
        self.assertTrue(split["permanent_oos"])
        self.assertLess(max(row["exit_date"] for row in train), min(row["signal_date"] for row in test))
        self.assertGreaterEqual(split["embargo_trading_days"], 5)

    def test_frozen_boundary_never_recycles_oos_into_training(self):
        records = [
            {"signal_date": (date(2024, 10, 1) + timedelta(days=index * 14)).isoformat(), "exit_date": (date(2024, 10, 1) + timedelta(days=index * 14 + 28)).isoformat()}
            for index in range(12)
        ] + [
            {"signal_date": "2025-04-16", "exit_date": "2025-05-14"},
            {"signal_date": "2026-01-07", "exit_date": "2026-02-04"},
        ]
        train, test, split = permanent_oos_split(records, split_boundary="2025-04-09", test_start="2025-04-16")
        self.assertTrue(all(row["signal_date"] < "2025-04-09" for row in train))
        self.assertEqual([row["signal_date"] for row in test], ["2025-04-16", "2026-01-07"])
        self.assertEqual(split["split_boundary"], "2025-04-09")

    def test_block_bootstrap_is_reproducible(self):
        rows = [
            {"signal_date": f"2026-01-{index + 1:02d}", "net_relative_return": 0.01 if index % 3 else -0.01}
            for index in range(20)
        ]
        first = block_bootstrap_rate(rows, resamples=200, seed=42)
        second = block_bootstrap_rate(rows, resamples=200, seed=42)
        self.assertEqual(first, second)

    def test_generated_report_keeps_price_timing_separate_from_composite_score(self):
        start = date(2023, 1, 2)
        days = []
        cursor = start
        while len(days) < 180:
            if cursor.weekday() < 5:
                days.append(cursor)
            cursor += timedelta(days=1)
        symbols = {}
        for symbol_index, ticker in enumerate(["QQQ", "TSM", "AAPL", "NVDA"]):
            rows = []
            for index, day in enumerate(days):
                drift = 0.10 + symbol_index * 0.015
                cycle = ((index % 11) - 5) * 0.03
                price = 100 + index * drift + cycle
                rows.append(market_row(day, price))
            symbols[ticker] = rows
        payload = {
            "schema_version": "short-term-daily-bars-v1",
            "as_of": days[-1].isoformat(),
            "source": "synthetic-test",
            "frequency": "1d",
            "adjustment": "adjusted_ohlcv",
            "symbols": symbols,
        }
        with tempfile.TemporaryDirectory() as directory:
            prices_path = Path(directory) / "prices.json"
            prices_path.write_text(json.dumps(payload), encoding="utf-8")
            report = generate(prices_path, ROOT / "data" / "short-term-trade-plan-v1.json", split_boundary=None, test_start=None)
        self.assertEqual(report["schema_version"], "historical-oos-price-timing-v1")
        self.assertEqual(report["scope"], "price_timing_layer_only")
        self.assertFalse(report["composite_score_calibrated"])
        self.assertTrue(report["split"]["permanent_oos"])
        self.assertIn("TSM", report["current_mappings"])
        self.assertGreater(report["sample_counts"]["permanent_oos"], 0)

    def test_timing_score_is_bounded(self):
        self.assertGreaterEqual(timing_score({}), 0)
        self.assertLessEqual(timing_score({}), 100)
        self.assertGreaterEqual(timing_score({"relative_return_20": 99, "relative_return_5": 99}), 0)
        self.assertLessEqual(timing_score({"relative_return_20": 99, "relative_return_5": 99}), 100)


if __name__ == "__main__":
    unittest.main()
