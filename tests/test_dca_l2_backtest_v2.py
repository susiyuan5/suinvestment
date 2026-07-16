from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from dca_l2_backtest_v2 import run_backtest


SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO", "QQQ")


class DcaL2BacktestV2Tests(unittest.TestCase):
    def write_prices(self, rows_by_symbol):
        directory = tempfile.TemporaryDirectory()
        path = Path(directory.name) / "prices.json"
        path.write_text(json.dumps({"symbols": rows_by_symbol}), encoding="utf-8")
        self.addCleanup(directory.cleanup)
        return path, Path(directory.name) / "out"

    def test_signal_uses_prior_close_and_tuesday_or_first_available_open(self):
        dates = ["2026-01-05", "2026-01-07", "2026-01-13"]  # Tuesday 2026-01-06 is a holiday in this fixture.
        rows = {symbol: [{"date": value, "adjusted_close": 100, "adjusted_open": 101} for value in dates] for symbol in SYMBOLS}
        prices, output = self.write_prices(rows)
        result = run_backtest(prices, output, as_of="2026-01-13")
        trades = [row for row in json.loads((output / "summary.json").read_text(encoding="utf-8"))["data_issues"] if row["kind"] == "skipped_no_adjusted_open_after_tuesday"]
        self.assertFalse(trades)
        trade_lines = (output / "trades.csv").read_text(encoding="utf-8").splitlines()
        self.assertIn("2026-01-05", trade_lines[1])
        self.assertIn("2026-01-07", trade_lines[1])
        self.assertTrue(result["research_only"])

    def test_missing_adjusted_open_is_recorded_and_never_replaced_by_close(self):
        dates = ["2026-01-05", "2026-01-06"]
        rows = {symbol: [{"date": value, "adjusted_close": 100, **({} if value == "2026-01-06" else {"adjusted_open": 101}), "close": 99} for value in dates] for symbol in SYMBOLS}
        prices, output = self.write_prices(rows)
        result = run_backtest(prices, output)
        self.assertTrue(any(item["kind"] == "skipped_no_adjusted_open_after_tuesday" for item in result["data_issues"]))
        self.assertEqual(0, result["strategies"]["dca_l2_v2"]["total_investment"])

    def test_external_deposits_are_equal_and_friction_is_applied(self):
        dates = ["2026-01-05", "2026-01-06", "2026-01-13"]
        rows = {symbol: [{"date": value, "adjusted_close": 100, "adjusted_open": 101} for value in dates] for symbol in SYMBOLS}
        prices, output = self.write_prices(rows)
        result = run_backtest(prices, output, commission_bps=10, slippage_bps=5)
        summaries = result["strategies"]
        self.assertEqual(summaries["budget_matched_fixed_dca"]["external_deposits"], summaries["dca_l2_v2"]["external_deposits"])
        self.assertGreater(summaries["budget_matched_fixed_dca"]["total_friction_cost"], 0)
        self.assertEqual("dca-l2-v2", result["config_version"])


if __name__ == "__main__":
    unittest.main()
