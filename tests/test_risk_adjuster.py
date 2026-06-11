import unittest
from risk_adjuster import calculate_risk_adjusted_multiplier_v2

def _v1_multiplier(wr, rr=None, cd=0, dd=0.0, sens=4.0, mn=0.3, mx=2.0, tv=0.04):
    import math
    m = 1.0 - sens * wr * 100 / 100.0
    if rr and len(rr) >= 4:
        rv = math.sqrt(sum((x - sum(rr)/len(rr))**2 for x in rr)/(len(rr)-1))
        if rv > 0 and tv > 0:
            a = max(0.7, min(1.1, tv / rv))
            m *= a
    if cd >= 8:
        m = min(m, 1.2)
    elif cd >= 4:
        m = min(m, 1.5)
    if dd > 0.35:
        m = min(m, 1.1)
    elif dd > 0.20:
        m = min(m, 1.3)
    return max(mn, min(mx, round(m + 1e-9, 2)))


class RiskAdjusterV2Tests(unittest.TestCase):

    def test_negative_return_increases_multiplier(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=-0.10)
        self.assertGreater(m, 1.0)

    def test_positive_return_decreases_multiplier(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=0.05)
        self.assertLess(m, 1.0)

    def test_zero_return_gives_about_1x(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=0.0)
        self.assertAlmostEqual(m, 1.0, delta=0.01)

    def test_multiplier_clamped_to_min(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=0.50, min_multiplier=0.3, max_multiplier=2.0)
        self.assertAlmostEqual(m, 0.3, delta=0.01)

    def test_multiplier_clamped_to_max(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=-1.0, min_multiplier=0.3, max_multiplier=2.0)
        self.assertAlmostEqual(m, 2.0, delta=0.01)

    def test_high_vol_alone_does_not_overly_suppress(self):
        rr_high = [-0.25, 0.20, -0.30, 0.15, -0.20]
        v2 = calculate_risk_adjusted_multiplier_v2(weekly_return=-0.10, recent_returns=rr_high)
        v1 = _v1_multiplier(-0.10, rr_high)
        self.assertGreater(v2, v1, f"v2={v2} should be > v1={v1}")

    def test_20pct_drawdown_alone_does_not_cap(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=-0.15, drawdown=0.25)
        # Baseline for -15%: 1 - 4*(-15)/100 = 1.6
        # v2 should NOT be capped below 1.6 just by 25% drawdown
        self.assertGreater(m, 1.3, f"v2={m} should be > 1.3")

    def test_35pct_drawdown_still_caps(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=-0.15, drawdown=0.40)
        self.assertLessEqual(m, 1.1)

    def test_4_decline_alone_does_not_cap(self):
        # Baseline for -15%: 1.6; v2 should NOT cap at 1.5
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=-0.15, consecutive_declines=5)
        self.assertGreater(m, 1.5, f"v2={m} should be > 1.5")

    def test_8_decline_still_caps(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=-0.15, consecutive_declines=10)
        self.assertLessEqual(m, 1.2)

    def test_combined_stress_reduces_multiplier(self):
        # High vol data to trigger combined stress
        rr_spiky = [-0.25, 0.22, -0.28, 0.18, -0.20, -0.15]
        m = calculate_risk_adjusted_multiplier_v2(
            weekly_return=-0.15,
            recent_returns=rr_spiky,
            consecutive_declines=6,
            drawdown=0.25,
        )
        # Combined stress should cap at 1.3
        self.assertLessEqual(m, 1.3, f"v2={m} should be <= 1.3")

    def test_v2_closer_to_baseline_than_v1_for_moderate_stress(self):
        rr_mod = [-0.08, -0.06, -0.10, -0.07, -0.09]
        old = 1.32
        v2 = calculate_risk_adjusted_multiplier_v2(weekly_return=-0.08, recent_returns=rr_mod, drawdown=0.15)
        v1 = _v1_multiplier(-0.08, rr_mod, dd=0.15)
        self.assertLess(abs(v2 - old), abs(v1 - old),
            f"v2={v2}, v1={v1}, old={old}")

    def test_baseline_same_as_old_with_no_stress(self):
        """With no stress signals, v2 should match the simple formula."""
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=-0.08)
        self.assertAlmostEqual(m, 1.32, delta=0.01)

    def test_momentum_positive_return_increases_multiplier(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=0.08, strategy_mode="momentum")
        self.assertAlmostEqual(m, 1.32, delta=0.01)

    def test_momentum_negative_return_decreases_multiplier(self):
        m = calculate_risk_adjusted_multiplier_v2(weekly_return=-0.08, strategy_mode="momentum")
        self.assertAlmostEqual(m, 0.68, delta=0.01)

    def test_unsupported_strategy_mode_raises(self):
        with self.assertRaises(ValueError):
            calculate_risk_adjusted_multiplier_v2(weekly_return=0.01, strategy_mode="mean_reversion")


if __name__ == "__main__":
    unittest.main()
