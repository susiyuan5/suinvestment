import unittest

from research.v2_validation import (
    benjamini_hochberg,
    category_neutral_spearman,
    moving_block_bootstrap_mean,
    one_way_turnover,
    portfolio_periods,
)


class V2ValidationTests(unittest.TestCase):
    def test_block_bootstrap_is_reproducible(self):
        values = [0.01, 0.03, -0.01, 0.04, 0.02] * 5
        first = moving_block_bootstrap_mean(values, block_size=4, resamples=200, seed=42)
        second = moving_block_bootstrap_mean(values, block_size=4, resamples=200, seed=42)
        self.assertEqual(first, second)

    def test_bh_controls_all_hypotheses(self):
        adjusted = benjamini_hochberg({"a": 0.001, "b": 0.02, "c": 0.2})
        self.assertTrue(adjusted["a"]["fdr_significant"])
        self.assertLessEqual(adjusted["a"]["q_value"], adjusted["b"]["q_value"])
        self.assertFalse(adjusted["c"]["fdr_significant"])

    def test_category_neutral_ic_removes_category_level_effect(self):
        rows = []
        for category, offset in (("tech", 10), ("health", -10)):
            for index in range(4):
                rows.append({"category": category, "factor": offset + index, "target": offset - index})
        value = category_neutral_spearman(rows, "factor", "target")
        self.assertLess(value, 0)

    def test_turnover_and_cost_reduce_gross_return(self):
        self.assertEqual(one_way_turnover({"A": 1}, {"B": 1}), 1)
        records = []
        for date, reverse in (("2026-01-02", False), ("2026-01-09", True)):
            for index in range(10):
                records.append({"date": date, "ticker": f"S{index}", "factor": 9 - index if reverse else index, "forward_1w_return": index / 100})
        periods = portfolio_periods(records, "factor", "forward_1w_return")
        self.assertEqual(len(periods), 2)
        self.assertTrue(all(row["net_return"] < row["gross_return"] for row in periods))
