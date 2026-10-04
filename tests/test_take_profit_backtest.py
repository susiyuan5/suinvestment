"""Check execution/accounting using independent, explicitly priced cohorts."""
import copy
import unittest
from datetime import date, timedelta

from research.take_profit_backtest import (
    STRATEGIES,
    entry_indices,
    simulate,
    split_for,
)


def market_rows(closes, opens=None, dates=None):
    opens = closes if opens is None else opens
    if dates is None:
        dates = []
        cursor = date(2026, 1, 2)
        while len(dates) < len(closes):
            if cursor.weekday() < 5:
                dates.append(cursor.isoformat())
            cursor += timedelta(days=1)
    return [
        {
            "date": day,
            "open": float(open_price),
            "high": float(max(open_price, close) + 1),
            "low": float(min(open_price, close) - 1),
            "close": float(close),
        }
        for day, open_price, close in zip(dates, opens, closes)
    ]


class TakeProfitBacktestTests(unittest.TestCase):
    def gap_fixture(self):
        # Highest completed close is 111, so the 50% floor is 105.5.
        # The close of 105 triggers, and the next observed open gaps to 90.
        return market_rows(
            [100, 108, 111, 105, 130, 140, 140, 140],
            [100, 100, 110, 110, 90, 130, 140, 140],
            ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-09",
             "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15"],
        )

    def test_take_profit_uses_next_observed_open_and_can_gap_to_a_loss(self):
        rows = self.gap_fixture()
        trade = simulate(rows, [2] * len(rows), 0, horizon=6, cost_bps_per_side=0)
        self.assertEqual(trade["entry_date"], "2026-01-05")
        self.assertEqual(trade["entry_price"], 100)
        self.assertEqual(trade["exit_signal_date"], "2026-01-09")
        self.assertEqual(trade["exit_date"], "2026-01-12")
        self.assertEqual(trade["exit_price"], 90)
        self.assertEqual(trade["exit_reason"], "take_profit_line")
        self.assertEqual(trade["held_sessions"], 3)
        self.assertAlmostEqual(trade["net_return"], -.10)
        self.assertTrue(trade["profit_to_loss"])

    def test_early_exit_leaves_cash_to_shared_end_without_reentry(self):
        rows = self.gap_fixture()
        atr_values = [2] * len(rows)
        trade = simulate(rows, atr_values, 0, horizon=6, cost_bps_per_side=0)
        baseline = simulate(rows, atr_values, 0, "no_take_profit", horizon=6, cost_bps_per_side=0)
        self.assertEqual(trade["time_end_date"], "2026-01-15")
        self.assertEqual(trade["time_end_date"], baseline["time_end_date"])
        cash = [point for point in trade["path"] if point["phase"] == "cash"]
        self.assertEqual([point["index"] for point in cash], [4, 5, 6, 7])
        for point in cash:
            self.assertAlmostEqual(point["wealth"], .90)
        self.assertAlmostEqual(baseline["net_return"], .40)
        self.assertEqual(baseline["held_sessions"], 6)

    def test_common_initial_risk_stop_is_identical_across_all_exit_rules(self):
        rows = market_rows([100, 93, 120, 125, 130], [100, 100, 88, 120, 125])
        for strategy in STRATEGIES:
            with self.subTest(strategy=strategy):
                trade = simulate(rows, [2] * len(rows), 0, strategy, horizon=3, cost_bps_per_side=0)
                self.assertEqual(trade["risk_line"], 94)
                self.assertEqual(trade["exit_signal_date"], rows[1]["date"])
                self.assertEqual(trade["exit_date"], rows[2]["date"])
                self.assertEqual(trade["exit_price"], 88)
                self.assertEqual(trade["exit_reason"], "common_risk_stop")
                self.assertAlmostEqual(trade["net_return"], -.12)

    def test_initial_stop_uses_prior_bar_atr_not_entry_day_atr(self):
        rows = market_rows([100, 96, 100, 105, 110], [100, 100, 90, 100, 105])
        trade = simulate(rows, [1, 100, 2, 2, 2], 0, horizon=3, cost_bps_per_side=0)
        self.assertEqual(trade["entry_atr"], 1)
        self.assertEqual(trade["risk_line"], 97)
        self.assertEqual(trade["exit_reason"], "common_risk_stop")
        self.assertEqual(trade["exit_price"], 90)

    def test_two_side_costs_charge_entry_and_exit_once(self):
        rows = market_rows([100] * 5)
        fee = .0025
        trade = simulate(rows, [2] * len(rows), 0, "no_take_profit", horizon=3, cost_bps_per_side=25)
        # Start with $1; the entry cost leaves 0.9975 invested. At an unchanged
        # sale price the exit cost leaves 0.9975 * 0.9975, then cash is constant.
        self.assertAlmostEqual(trade["path"][0]["wealth"], 1 - fee)
        held = [point for point in trade["path"] if point["phase"] == "held_close"]
        for point in held:
            self.assertAlmostEqual(point["wealth"], 1 - fee)
        expected_cash = .9975 * .9975
        self.assertAlmostEqual(trade["net_return"], expected_cash - 1)
        self.assertAlmostEqual(trade["path"][-1]["wealth"], expected_cash)
        self.assertAlmostEqual(trade["max_drawdown"], 1 - expected_cash)

    def test_cost_changes_return_but_not_price_signal_or_fill(self):
        rows = self.gap_fixture()
        without_cost = simulate(rows, [2] * len(rows), 0, horizon=6, cost_bps_per_side=0)
        with_cost = simulate(rows, [2] * len(rows), 0, horizon=6, cost_bps_per_side=30)
        for key in ("entry_date", "entry_price", "exit_signal_date", "exit_date", "exit_price", "exit_reason"):
            self.assertEqual(without_cost[key], with_cost[key])
        self.assertAlmostEqual(with_cost["net_return"], .90 * .997 * .997 - 1)
        self.assertLess(with_cost["net_return"], without_cost["net_return"])

    def test_intraday_extremes_do_not_trigger_completed_close_rules(self):
        rows = market_rows([100] * 6)
        extreme = copy.deepcopy(rows)
        for row in extreme[1:]:
            row["high"] = 1000
            row["low"] = 1
        # ATR is passed independently; the only permitted high/low influence
        # is through that already calculated completed-bar ATR series.
        for strategy in STRATEGIES:
            with self.subTest(strategy=strategy):
                ordinary = simulate(rows, [2] * len(rows), 0, strategy, horizon=4, cost_bps_per_side=0)
                altered = simulate(extreme, [2] * len(rows), 0, strategy, horizon=4, cost_bps_per_side=0)
                self.assertEqual(ordinary, altered)
                self.assertEqual(altered["exit_date"], rows[5]["date"])

    def test_fixed_target_observed_at_close_executes_next_open_not_target(self):
        rows = market_rows([100, 121, 130, 130, 130], [100, 100, 114, 130, 130])
        trade = simulate(rows, [2] * len(rows), 0, "fixed_20", horizon=3, cost_bps_per_side=0)
        self.assertEqual(trade["exit_reason"], "fixed_target")
        self.assertEqual(trade["exit_signal_date"], rows[1]["date"])
        self.assertEqual(trade["exit_date"], rows[2]["date"])
        self.assertEqual(trade["exit_price"], 114)
        self.assertAlmostEqual(trade["net_return"], .14)

    def test_horizon_requires_last_next_open_execution_bar(self):
        rows = market_rows([100] * 5)
        with self.assertRaisesRegex(ValueError, "insufficient_history_or_horizon"):
            simulate(rows, [2] * len(rows), 0, horizon=4)
        trade = simulate(rows, [2] * len(rows), 0, "no_take_profit", horizon=3)
        self.assertEqual(trade["exit_date"], rows[4]["date"])
        self.assertEqual(trade["time_end_date"], rows[4]["date"])
        self.assertEqual(trade["exit_signal_date"], rows[3]["date"])
        self.assertEqual(trade["held_sessions"], 3)

    def test_missing_known_entry_atr_cannot_create_a_trade(self):
        rows = market_rows([100] * 5)
        with self.assertRaisesRegex(ValueError, "entry_atr_unavailable"):
            simulate(rows, [None, 2, 2, 2, 2], 0, horizon=3)

    def test_entry_filter_uses_only_prices_before_that_entry(self):
        rows = market_rows([100 + .1 * index for index in range(360)])
        atr_values = [2] * len(rows)
        first_signal = next(entry_indices(rows, atr_values))
        first_entry = first_signal + 1
        changed = copy.deepcopy(rows)
        for row in changed[first_entry:]:
            row.update(open=2, high=3, low=1, close=2)
        self.assertIn(first_signal, list(entry_indices(changed, atr_values)))
        self.assertGreaterEqual(first_entry, 200)
        self.assertNotEqual(rows[first_entry]["date"][:7], rows[first_signal]["date"][:7])

    def test_cross_boundary_cohort_is_not_placed_in_either_period(self):
        self.assertIsNone(split_for("2020-12-01", "2021-03-01"))
        self.assertEqual(split_for("2020-01-02", "2020-04-02"), "development")
        self.assertEqual(split_for("2021-01-04", "2021-04-05"), "test")


if __name__ == "__main__":
    unittest.main()
