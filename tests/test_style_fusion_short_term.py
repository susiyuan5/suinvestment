import json
import unittest
from datetime import date, timedelta
from pathlib import Path

from research.idea_engine.v3.short_term_trade_plan import (
    build_strategy_rows,
    calculate_position_size,
    market_regime,
    style_signals,
)
from research.idea_engine.v3.style_fusion_oos import simulate_trade, summarize


ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "data" / "short-term-trade-plan-v1.2.json").read_text(encoding="utf-8"))
CONFIG_V13 = json.loads((ROOT / "data" / "short-term-trade-plan-v1.3.json").read_text(encoding="utf-8"))


def indicator_fixture(**overrides):
    value = {
        "signal_date": "2026-08-13",
        "current_close": 120.0, "current_low": 117.0, "previous_high": 119.0,
        "sma20": 115.0, "sma50": 110.0, "sma200": 100.0, "sma200_slope_20": 2.0,
        "relative_return_5": 0.03, "relative_return_20": 0.08, "atr14": 2.0,
        "prior20_high": 118.0, "recent10_low": 113.0, "volume_ratio": 1.5,
        "contraction_volume_ratio": 0.7, "recent_contraction_range_pct": 0.04,
        "prior_contraction_range_pct": 0.08, "distance_prior_high_atr": -1.0,
        "qqq_close": 120.0, "qqq_sma50": 110.0, "qqq_sma200": 100.0,
        "qqq_sma200_slope_20": 1.0,
    }
    value.update(overrides)
    return value


def market_row(day, *, open_price=100.0, high=101.0, low=99.0, close=100.0):
    return {"date": day.isoformat(), "open": open_price, "high": high, "low": low,
            "close": close, "adjusted": close, "volume": 1_000_000}


class StyleFusionShortTermTests(unittest.TestCase):
    def test_market_regime_controls_risk_instead_of_adding_points(self):
        self.assertEqual(market_regime(indicator_fixture(), CONFIG)["state"], "green")
        yellow = market_regime(indicator_fixture(qqq_close=105, qqq_sma50=110), CONFIG)
        self.assertEqual((yellow["state"], yellow["risk_scale"]), ("yellow", 0.5))
        red = market_regime(indicator_fixture(qqq_close=95), CONFIG)
        self.assertEqual((red["state"], red["risk_scale"], red["passed"]), ("red", 0.0, False))

    def test_volume_breakout_and_vcp_must_pass_independently(self):
        signals = style_signals(indicator_fixture(), CONFIG)
        self.assertTrue(signals["trend_template"])
        self.assertTrue(signals["vcp_contraction"])
        self.assertTrue(signals["volume_breakout"])
        self.assertEqual(signals["triggered_model"], "vcp_darvas_breakout")
        no_volume = style_signals(indicator_fixture(volume_ratio=1.0, current_low=119.0), CONFIG)
        self.assertIsNone(no_volume["triggered_model"])

    def test_v13_outputs_three_independent_strategy_choices(self):
        signals = style_signals(indicator_fixture(), CONFIG_V13)
        self.assertEqual(set(signals["triggered_models"]), {"oneil_volume_breakout", "vcp_darvas_breakout"})
        evidence = {
            "oneil_volume_breakout": {"samples": 120, "passed": True},
            "trend_pullback": {"samples": 90, "passed": False},
            "vcp_darvas_breakout": {"samples": 11, "passed": False},
        }
        strategies = build_strategy_rows(indicator_fixture(), signals, CONFIG_V13, evidence, {"preliminary_review_eligible": True}, [])
        self.assertEqual([row["strategy_id"] for row in strategies], CONFIG_V13["strategy_order"])
        self.assertEqual(strategies[0]["status"], "preliminary_review")
        self.assertEqual(strategies[1]["status"], "waiting")
        self.assertEqual(strategies[2]["status"], "historical_edge_failed")
        self.assertTrue(all(row["prediction_calibrated"] is False and row["execution_ready"] is False for row in strategies))

    def test_yellow_regime_halves_position_risk_budget(self):
        full = calculate_position_size(100_000, 10_000, 100, 95, CONFIG, risk_scale=1.0)
        half = calculate_position_size(100_000, 10_000, 100, 95, CONFIG, risk_scale=0.5)
        self.assertEqual(half["risk_budget"], full["risk_budget"] / 2)
        self.assertLessEqual(half["shares"], full["shares"])

    def test_oos_execution_uses_next_open_and_conservative_stop(self):
        start = date(2026, 1, 2)
        rows = [market_row(start + timedelta(days=index)) for index in range(21)]
        benchmark = [market_row(start + timedelta(days=index), open_price=200, high=201, low=199, close=200) for index in range(21)]
        rows[1] = market_row(start + timedelta(days=1), open_price=100, high=104, low=94, close=99)
        signal = {"entry_reference": 100, "chase_limit": 102, "stop": 95,
                  "risk_per_share": 5, "atr14": 2, "breakout_level": 100}
        result = simulate_trade(rows, benchmark, 0, signal, "oneil_volume_breakout", CONFIG)
        self.assertEqual(result["entry_date"], rows[1]["date"])
        self.assertEqual(result["exit_reasons"], ["stop"])
        self.assertLess(result["net_relative_return"], 0)

    def test_chase_rejection_and_bootstrap_summary_are_deterministic(self):
        start = date(2026, 1, 2)
        rows = [market_row(start + timedelta(days=index)) for index in range(21)]
        benchmark = list(rows)
        rows[1] = market_row(start + timedelta(days=1), open_price=103, high=104, low=102, close=103)
        signal = {"entry_reference": 100, "chase_limit": 102, "stop": 95,
                  "risk_per_share": 5, "atr14": 2, "breakout_level": 100}
        self.assertIsNone(simulate_trade(rows, benchmark, 0, signal, "oneil_volume_breakout", CONFIG))
        records = [{"signal_date": (start + timedelta(days=index * 7)).isoformat(),
                    "net_relative_return": 0.01 if index % 2 else -0.01,
                    "max_adverse_move": -0.02} for index in range(30)]
        self.assertEqual(summarize(records, seed=42), summarize(records, seed=42))
        self.assertFalse(summarize(records, seed=42)["passed"])


if __name__ == "__main__":
    unittest.main()
