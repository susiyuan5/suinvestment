import unittest
from risk_adjuster import calculate_risk_adjusted_multiplier


class RiskAdjusterTests(unittest.TestCase):

    def test_negative_return_increases_multiplier(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=-0.10)
        self.assertGreater(m, 1.0)

    def test_positive_return_decreases_multiplier(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=0.05)
        self.assertLess(m, 1.0)

    def test_zero_return_gives_about_1x(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=0.0)
        self.assertAlmostEqual(m, 1.0, delta=0.01)

    def test_negative_15_pct_gives_about_1_6x(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=-0.15)
        self.assertAlmostEqual(m, 1.6, delta=0.05)

    def test_multiplier_clamped_to_min(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=0.50, min_multiplier=0.3, max_multiplier=2.0)
        self.assertAlmostEqual(m, 0.3, delta=0.01)

    def test_multiplier_clamped_to_max(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=-1.0, min_multiplier=0.3, max_multiplier=2.0)
        self.assertAlmostEqual(m, 2.0, delta=0.01)

    def test_volatility_reduces_multiplier(self):
        low_vol = calculate_risk_adjusted_multiplier(weekly_return=-0.10, recent_returns=[-0.10, -0.08, -0.12, -0.09, -0.11])
        high_vol = calculate_risk_adjusted_multiplier(weekly_return=-0.10, recent_returns=[-0.25, 0.20, -0.30, 0.15, -0.20])
        self.assertLess(high_vol, low_vol)

    def test_drawdown_20_caps_multiplier(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=-0.10, drawdown=0.25)
        self.assertLessEqual(m, 1.3)

    def test_drawdown_35_caps_multiplier(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=-0.10, drawdown=0.40)
        self.assertLessEqual(m, 1.1)

    def test_consecutive_declines_4_caps_multiplier(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=-0.10, consecutive_declines=6)
        self.assertLessEqual(m, 1.5)

    def test_consecutive_declines_8_lower_cap(self):
        m = calculate_risk_adjusted_multiplier(weekly_return=-0.15, consecutive_declines=10)
        self.assertLessEqual(m, 1.2)

    def test_all_factors_together(self):
        m = calculate_risk_adjusted_multiplier(
            weekly_return=-0.08,
            recent_returns=[-0.05, -0.06, -0.07, -0.08],
            consecutive_declines=5,
            drawdown=0.22,
        )
        self.assertGreaterEqual(m, 0.3)
        self.assertLessEqual(m, 2.0)

    def test_strong_drop_capped_by_drawdown(self):
        # big drop = strong buy signal, but drawdown caps it
        m = calculate_risk_adjusted_multiplier(weekly_return=-0.20, drawdown=0.30)
        self.assertAlmostEqual(m, 1.3, delta=0.05)


if __name__ == "__main__":
    unittest.main()
