import unittest
from datetime import date

from config import StrategyConfig
from data_loader import WeeklyBar
from research.run_v2_causal_baseline import simulate


class CausalBaselineTests(unittest.TestCase):
    def test_signal_is_executed_on_next_bar_open(self):
        bars = [
            WeeklyBar(date(2026, 1, 2), 100, 101, 99, 100, 100, 101, 99, 100),
            WeeklyBar(date(2026, 1, 9), 90, 91, 89, 90, 90, 91, 89, 90),
            WeeklyBar(date(2026, 1, 16), 80, 81, 79, 82, 80, 81, 79, 82),
        ]
        result = simulate("TEST", bars, StrategyConfig(initial_cash=1000, commission_rate=0, slippage_rate=0))
        trade = result["trades"][0]
        self.assertEqual(trade["signal_date"], "2026-01-09")
        self.assertEqual(trade["execution_date"], "2026-01-16")
        self.assertEqual(trade["execution_price"], 80)


if __name__ == "__main__":
    unittest.main()
