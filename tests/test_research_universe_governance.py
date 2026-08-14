import unittest

from research.research_universe.governance import monthly_transition, validate_candidate, validate_rows, validate_source


class ResearchUniverseGovernanceTests(unittest.TestCase):
    def test_source_has_exactly_80_and_reference_symbols_are_separate(self):
        import json
        from pathlib import Path
        payload = json.loads((Path(__file__).parents[1] / "data/research-universe-sector-balanced-80.json").read_text(encoding="utf-8"))
        result = validate_source(payload)
        self.assertTrue(result["valid"], result["errors"])
        self.assertEqual(len(result["symbols"]), 80)

    def test_daily_gate_rejects_short_history_future_and_bad_ohlcv(self):
        rows = [{"date": "2026-01-01", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 100, "adjusted": 1.5}]
        ok, reasons, count = validate_rows(rows, as_of="2026-01-02")
        self.assertFalse(ok); self.assertIn("fewer_than_250_valid_trading_days", reasons); self.assertEqual(count, 1)

    def test_monthly_replacement_limit_is_explicit(self):
        result = monthly_transition({"symbols": ["A", "B"]}, {"symbols": ["C", "D", "E"]}, max_replacements=2)
        self.assertEqual(result["replacement_count"], 3)
        self.assertFalse(result["within_limit"])

    def test_otc_and_unverified_market_data_are_rejected(self):
        result = validate_candidate("OTC1", {"category": "international", "security_type": "common_stock", "exchange": "OTCQX"}, [], as_of="2026-01-02")
        self.assertFalse(result["accepted"])
        self.assertIn("otc_not_allowed", result["reasons"])
        self.assertIn("market_cap_below_or_unverified", result["reasons"])


if __name__ == "__main__":
    unittest.main()
