import json
import unittest
from pathlib import Path

import policy_contracts as contracts


FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "dashboard_contract_cases.json").read_text(encoding="utf-8"))


class DashboardContractTests(unittest.TestCase):
    def test_market_data_golden_fixtures(self):
        for row in FIXTURE["market_data"]:
            self.assertEqual(contracts.freshness(row["timestamp"], now_ms=row["now_ms"], default_max_age_hours=row["max_age_hours"]), row["expected"])

    def test_signal_golden_fixtures(self):
        signal = FIXTURE["signal"]
        self.assertEqual(contracts.market_signals(signal["closes"]), signal["expected_market_signals"])
        self.assertEqual(contracts.signal_score(signal["score_input"], signal["score_params"]), signal["expected_score"])

    def test_portfolio_golden_fixtures(self):
        row = FIXTURE["portfolio"]
        actual = contracts.normalize_portfolio(row["items"], row["defaults"])
        self.assertEqual([(item["symbol"], item["name"]) for item in actual], [(item["symbol"], item["name"]) for item in row["expected"]])
        for current, expected in zip(actual, row["expected"]):
            self.assertAlmostEqual(current["allocation"], expected["allocation"])

    def test_backtest_golden_fixtures(self):
        row, expected = FIXTURE["backtest"], FIXTURE["backtest"]["expected"]
        self.assertAlmostEqual(contracts.cagr(row["final_value"], row["total_invested"], row["weeks"]), expected["cagr"])
        self.assertAlmostEqual(contracts.annualized_volatility(row["returns"]), expected["annualized_volatility"])
        self.assertAlmostEqual(contracts.downside_deviation(row["downside_returns"]), expected["downside_deviation"])
        self.assertAlmostEqual(contracts.return_volatility(row["returns"]), expected["return_volatility"])
        dca = row["dca_case"]
        self.assertEqual(contracts.simulate_fixed_dca(dca["prices"], dca["weekly_amount"], dca["friction_rate"]), dca["expected"])
