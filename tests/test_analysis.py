import unittest
from datetime import date
from unittest.mock import patch

from analysis import MANUAL_TRADE_NOTE, analyze_ticker
from config import AnalysisConfig, StrategyConfig
from data_loader import PricePoint


class AnalysisTests(unittest.TestCase):
    def test_disallowed_ticker_is_do_not_buy(self):
        result = analyze_ticker(
            "XYZ",
            StrategyConfig(),
            AnalysisConfig(allowed_tickers=("SPY",)),
            portfolio={},
        )
        self.assertEqual(result.suggested_action, "DO_NOT_BUY")
        self.assertIn("allowed_tickers", result.warning)

    @patch("analysis.load_yahoo_daily_prices")
    def test_analysis_output_is_manual_suggestion_only(self, mocked_loader):
        mocked_loader.return_value = [
            PricePoint(date(2026, 5, 1), 100),
            PricePoint(date(2026, 5, 8), 98),
            PricePoint(date(2026, 5, 15), 96),
            PricePoint(date(2026, 5, 22), 94),
            PricePoint(date(2026, 5, 29), 92),
            PricePoint(date(2026, 6, 5), 90),
        ]
        result = analyze_ticker(
            "SPY",
            StrategyConfig(strategy_mode="dip_buy"),
            AnalysisConfig(allowed_tickers=("SPY",), available_cash=10000),
            portfolio={},
        )
        self.assertIn(result.suggested_action, {"BUY", "REDUCE_BUY", "HOLD", "CONSIDER_SELL", "DO_NOT_BUY"})
        self.assertEqual(result.manual_trade_note, MANUAL_TRADE_NOTE)
        self.assertGreaterEqual(result.suggested_buy_amount, 0)

    @patch("analysis.load_yahoo_daily_prices")
    def test_analysis_computes_risk_level_after_market_data_checks(self, mocked_loader):
        mocked_loader.return_value = [
            PricePoint(date(2026, 5, 1), 100),
            PricePoint(date(2026, 5, 8), 102),
            PricePoint(date(2026, 5, 15), 104),
            PricePoint(date(2026, 5, 22), 106),
            PricePoint(date(2026, 5, 29), 108),
            PricePoint(date(2026, 6, 5), 110),
        ]
        result = analyze_ticker(
            "SPY",
            StrategyConfig(strategy_mode="momentum"),
            AnalysisConfig(
                allowed_tickers=("SPY",),
                available_cash=10000,
                stale_data_limit_hours=24 * 30,
            ),
            portfolio={},
        )
        self.assertIn(result.risk_level, {"Low", "Medium", "High"})
        self.assertGreater(result.buy_multiplier, 1.0)


if __name__ == "__main__":
    unittest.main()
