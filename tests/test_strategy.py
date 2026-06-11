import unittest
from datetime import date

from backtest import run_backtest
from config import BacktestConfig, StrategyConfig
from data_loader import PricePoint
from strategy import calculate_buy_amount, calculate_buy_multiplier, calculate_risk_adjusted_buy_amount


class StrategyTests(unittest.TestCase):
    def test_dip_buy_positive_return_reduces_buy_amount(self):
        config = StrategyConfig(strategy_mode="dip_buy")
        amount, _ = calculate_buy_amount(0.10, config)
        self.assertLess(amount, config.base_buy_amount)

    def test_dip_buy_negative_return_increases_buy_amount(self):
        config = StrategyConfig(strategy_mode="dip_buy")
        amount, _ = calculate_buy_amount(-0.10, config)
        self.assertGreater(amount, config.base_buy_amount)

    def test_momentum_positive_return_increases_buy_amount(self):
        config = StrategyConfig(strategy_mode="momentum")
        amount, _ = calculate_buy_amount(0.10, config)
        self.assertGreater(amount, config.base_buy_amount)

    def test_multiplier_cannot_exceed_max_multiplier(self):
        config = StrategyConfig(strategy_mode="dip_buy", max_multiplier=1.2)
        self.assertEqual(calculate_buy_multiplier(-1.0, config), 1.2)

    def test_multiplier_cannot_go_below_min_multiplier(self):
        config = StrategyConfig(strategy_mode="dip_buy", min_multiplier=0.4)
        self.assertEqual(calculate_buy_multiplier(1.0, config), 0.4)

    def test_strategy_cannot_buy_more_than_available_cash_allows(self):
        config = BacktestConfig(
            strategy=StrategyConfig(initial_cash=50, base_buy_amount=1000, commission_rate=0.001),
        )
        prices = [
            PricePoint(date(2024, 1, 5), 100),
            PricePoint(date(2024, 1, 12), 90),
        ]
        result = run_backtest("TEST", prices, config, save_results=False)
        self.assertLessEqual(result.trades[0].total_cost, 50)

    def test_backtest_cash_should_not_be_negative(self):
        config = BacktestConfig(
            strategy=StrategyConfig(initial_cash=50, base_buy_amount=1000, commission_rate=0.001),
        )
        prices = [
            PricePoint(date(2024, 1, 5), 100),
            PricePoint(date(2024, 1, 12), 90),
            PricePoint(date(2024, 1, 19), 80),
        ]
        result = run_backtest("TEST", prices, config, save_results=False)
        self.assertTrue(all(trade.cash >= 0 for trade in result.trades))

    def test_risk_adjusted_buy_amount_respects_momentum_mode(self):
        config = StrategyConfig(strategy_mode="momentum", base_buy_amount=100)
        amount, multiplier = calculate_risk_adjusted_buy_amount(0.08, config)
        self.assertGreater(multiplier, 1.0)
        self.assertGreater(amount, config.base_buy_amount)


if __name__ == "__main__":
    unittest.main()
